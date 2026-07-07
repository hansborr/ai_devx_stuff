import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ArrayLiteralExpression, SourceFile, TypeNode } from "ts-morph";
import { Node, Project } from "ts-morph";
import { describe, expect, it } from "vitest";

import {
  DIRECT_WRITE_SUGGESTIONS,
  GATED_DELEGATES,
  GATED_MUTATORS,
  PRISMA_TYPES_RELATIVE,
} from "./constants.js";

// The concurrency gate's delegate/mutator vocabulary is declared three times,
// once per enforcement surface, and is intentionally NOT shared at runtime:
//   1. eslint-rules/concurrency-guard.js — plain ESLint-loadable JS.
//   2. this directory's constants.ts — the scripts-project codemod.
//   3. packages/server/src/utils/prisma-types.ts — the gate encoded in the
//      type system (restricted delegates that type the banned methods `never`).
// The three copies cannot import a common runtime module (they live in three
// different loader worlds), so nothing forces them to agree. A sixth gated
// delegate added to prisma-types would silently miss lint AND the codemod.
// This guard fails the moment the three copies drift, mirroring the
// `no-redundant-central-mock` drift guard in eslint-rules/. See
// docs/CONCURRENCY.md for why the surface is scoped the way it is.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ESLINT_RULE_PATH = path.join(REPO_ROOT, "eslint-rules", "concurrency-guard.js");
const PRISMA_TYPES_PATH = path.join(REPO_ROOT, PRISMA_TYPES_RELATIVE);

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true },
});
const ruleSource = project.addSourceFileAtPath(ESLINT_RULE_PATH);
const prismaSource = project.addSourceFileAtPath(PRISMA_TYPES_PATH);

// Type aliases in prisma-types.ts of the form `Restricted<Name>Delegate`: one
// per gated delegate, each Omitting the banned mutators and re-declaring them
// `never`.
const RESTRICTED_DELEGATE_TYPES = prismaSource
  .getTypeAliases()
  .map((alias) => alias.getName())
  .filter((name) => /^Restricted.+Delegate$/u.test(name));

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function stringLiteralText(node: Node | undefined, context: string): string {
  if (!node || !Node.isStringLiteral(node)) {
    throw new Error(`expected a string literal for ${context}`);
  }
  return node.getLiteralText();
}

/** The array-literal argument of a top-level `new Set([...])` / `new Map([...])`. */
function newExpressionArgArray(source: SourceFile, name: string): ArrayLiteralExpression {
  const initializer = source.getVariableDeclarationOrThrow(name).getInitializerOrThrow();
  if (!Node.isNewExpression(initializer)) {
    throw new Error(`${name} is not a \`new Set(...)\`/\`new Map(...)\` expression`);
  }
  const [arg] = initializer.getArguments();
  if (!arg || !Node.isArrayLiteralExpression(arg)) {
    throw new Error(`${name} is not constructed from an array literal`);
  }
  return arg;
}

/** Members of a `new Set(["a", "b", ...])`. */
function setLiteralMembers(source: SourceFile, name: string): Set<string> {
  const elements = newExpressionArgArray(source, name).getElements();
  return new Set(elements.map((element) => stringLiteralText(element, `${name} element`)));
}

/** Keys of a `new Map([["a", ...], ["b", ...]])`. */
function mapKeyLiterals(source: SourceFile, name: string): Set<string> {
  const entries = newExpressionArgArray(source, name).getElements();
  return new Set(
    entries.map((entry) => {
      if (!Node.isArrayLiteralExpression(entry)) {
        throw new Error(`${name} entry is not a [key, value] tuple`);
      }
      return stringLiteralText(entry.getElements()[0], `${name} key`);
    }),
  );
}

/** String-literal members of a `"a" | "b" | ...` union type node. */
function stringLiteralUnionMembers(node: TypeNode): string[] {
  if (Node.isUnionTypeNode(node)) {
    return node.getTypeNodes().flatMap(stringLiteralUnionMembers);
  }
  if (Node.isLiteralTypeNode(node)) {
    const literal = node.getLiteral();
    if (Node.isStringLiteral(literal)) return [literal.getLiteralText()];
  }
  throw new Error(`expected a string-literal union member, got ${node.getKindName()}`);
}

/** The `Keys` union of the first `Omit<Base, Keys>` in a (possibly intersection) type. */
function omitKeysUnion(typeNode: TypeNode): TypeNode {
  const parts = Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
  for (const part of parts) {
    if (Node.isTypeReference(part) && part.getTypeName().getText() === "Omit") {
      const [, keys] = part.getTypeArguments();
      if (keys) return keys;
    }
  }
  throw new Error("no `Omit<Base, Keys>` found in type");
}

/** The set of keys removed by the `Omit<...>` in the named type alias. */
function omittedKeys(source: SourceFile, typeAliasName: string): Set<string> {
  const alias = source.getTypeAliasOrThrow(typeAliasName);
  return new Set(stringLiteralUnionMembers(omitKeysUnion(alias.getTypeNodeOrThrow())));
}

/**
 * Property names in a client type alias (`TxClient`/`DbClient`) whose value is
 * a `Restricted<Name>Delegate` — i.e. the delegates the gate actually restricts.
 * Read from the added members rather than the `Omit<...>` union because
 * `DbClient` also Omits unrelated keys such as `$transaction`.
 */
function restrictedDelegateProperties(source: SourceFile, typeAliasName: string): Set<string> {
  const typeNode = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const parts = Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
  const names = new Set<string>();
  for (const part of parts) {
    if (!Node.isTypeLiteral(part)) continue;
    for (const member of part.getProperties()) {
      const memberType = member.getTypeNode();
      if (
        memberType &&
        Node.isTypeReference(memberType) &&
        /^Restricted.+Delegate$/u.test(memberType.getTypeName().getText())
      ) {
        names.add(member.getName());
      }
    }
  }
  return names;
}

describe("concurrency-guard triple drift guard", () => {
  it("keeps the gated-delegate set in lockstep across rule, codemod, and prisma-types", () => {
    const ruleDelegates = setLiteralMembers(ruleSource, "GATED_DELEGATES");

    expect(sorted(ruleDelegates)).toEqual(sorted(GATED_DELEGATES));
    // prisma-types restricts the delegates on both the transaction and
    // top-level client shapes; both must match the codemod set.
    expect(sorted(restrictedDelegateProperties(prismaSource, "TxClient"))).toEqual(
      sorted(GATED_DELEGATES),
    );
    expect(sorted(restrictedDelegateProperties(prismaSource, "DbClient"))).toEqual(
      sorted(GATED_DELEGATES),
    );
  });

  it("keeps the gated-mutator set in lockstep across rule, codemod, and prisma-types", () => {
    const ruleMutators = setLiteralMembers(ruleSource, "GATED_MUTATORS");
    expect(sorted(ruleMutators)).toEqual(sorted(GATED_MUTATORS));

    // One `Restricted<Name>Delegate` per gated delegate; a missing/extra one
    // means prisma-types and the codemod disagree on the delegate surface.
    expect(RESTRICTED_DELEGATE_TYPES).toHaveLength(GATED_DELEGATES.size);
    for (const typeName of RESTRICTED_DELEGATE_TYPES) {
      expect(
        sorted(omittedKeys(prismaSource, typeName)),
        `${typeName} banned methods drifted`,
      ).toEqual(sorted(GATED_MUTATORS));
    }
  });

  it("keeps the direct-write suggestion keys aligned with the gated delegates", () => {
    // DIRECT_WRITE_SUGGESTIONS lives only in the rule and the codemod (prisma
    // encodes its guidance in @deprecated JSDoc, not a keyed map). Both key sets
    // must cover exactly the gated delegates.
    expect(sorted(mapKeyLiterals(ruleSource, "DIRECT_WRITE_SUGGESTIONS"))).toEqual(
      sorted(GATED_DELEGATES),
    );
    expect(sorted(new Set(DIRECT_WRITE_SUGGESTIONS.keys()))).toEqual(sorted(GATED_DELEGATES));
  });
});
