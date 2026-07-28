import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ArrayLiteralExpression, SourceFile, TypeNode } from "ts-morph";
import { Node, Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";

import {
  DIRECT_WRITE_SUGGESTIONS,
  GATED_DELEGATES,
  GATED_MUTATORS,
  GATED_RELATION_FIELDS,
  PRISMA_TYPES_RELATIVE,
} from "./constants.js";
import { nestedRelationWrites } from "./nested-writes.js";

// The concurrency gate's delegate/mutator vocabulary is declared three times,
// once per enforcement surface, and is intentionally NOT shared at runtime:
//   1. eslint-rules/concurrency-guard.js — plain ESLint-loadable JS.
//   2. this directory's constants.ts — the scripts-project codemod.
//   3. packages/server/src/utils/prisma-types.ts — the gate encoded in the
//      type system (restricted delegates that brand banned methods as
//      non-callable `ConcurrencyGatedWrite` properties).
// The three copies cannot import a common runtime module (they live in three
// different loader worlds), so nothing forces them to agree. A sixth gated
// delegate added to prisma-types would silently miss lint AND the codemod.
// This guard fails the moment the three copies drift, mirroring the
// `no-redundant-central-mock` drift guard in eslint-rules/. See
// docs/CONCURRENCY.md for why the surface is scoped the way it is.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ESLINT_RULE_PATH = path.join(REPO_ROOT, "eslint-rules", "concurrency-guard.js");
const PRISMA_TYPES_PATH = path.join(REPO_ROOT, PRISMA_TYPES_RELATIVE);
const PRISMA_SCHEMA_PATH = path.join(REPO_ROOT, "packages", "server", "prisma", "schema.prisma");
const CORPUS_PATH = path.join(REPO_ROOT, "eslint-rules", "concurrency-guard-nested-corpus.json");

interface NestedWriteCorpusCase {
  name: string;
  filename: string;
  code: string;
  expected: { relation: string; method: string; delegate: string }[];
}

interface NestedWriteCorpus {
  cases: NestedWriteCorpusCase[];
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true },
});
const ruleSource = project.addSourceFileAtPath(ESLINT_RULE_PATH);
const prismaSource = project.addSourceFileAtPath(PRISMA_TYPES_PATH);

// Type aliases in prisma-types.ts of the form `Restricted<Name>Delegate`: one
// per gated delegate, each Omitting the banned mutators and re-declaring them
// as branded non-callable properties.
const RESTRICTED_DELEGATE_TYPES = prismaSource
  .getTypeAliases()
  .map((alias) => alias.getName())
  .filter((name) => /^Restricted.+Delegate$/u.test(name));

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sortedEntries(map: Map<string, string>): [string, string][] {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Nested-relation surface, derived from the Prisma schema.
//
// The delegate gate is a *name* gate, and Prisma reaches every gated table as
// a relation of a non-gated one. The relation-field names are therefore a
// fourth thing the enforcement copies must agree on — but unlike the delegate
// and mutator sets they are not a hand-chosen policy: they are a fact about
// `schema.prisma`. Deriving them here means a new relation to a gated model
// fails this test instead of silently widening the escape.
// ---------------------------------------------------------------------------

/** Prisma delegate name for a model: `CharacterStats` -> `characterStats`. */
function delegateNameForModel(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

interface SchemaRelation {
  parent: string;
  field: string;
  target: string;
}

function schemaModelBodies(): Map<string, string> {
  const source = readFileSync(PRISMA_SCHEMA_PATH, "utf-8");
  const models = new Map<string, string>();
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)) {
    models.set(match[1] ?? "", match[2] ?? "");
  }
  return models;
}

function schemaModelNames(): string[] {
  return [...schemaModelBodies().keys()];
}

/** Every `<name> <Type>` field in the schema, split by whether Type is a model. */
function schemaFields(): { parent: string; field: string; target: string }[] {
  const fields: { parent: string; field: string; target: string }[] = [];
  for (const [parent, body] of schemaModelBodies()) {
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      const match = /^(\w+)\s+(\w+)/u.exec(trimmed);
      const [, name, target] = match ?? [];
      if (name === undefined || target === undefined) continue;
      fields.push({ field: name, parent, target });
    }
  }
  return fields;
}

function schemaRelations(): SchemaRelation[] {
  const models = schemaModelBodies();
  return schemaFields().filter(({ target }) => models.has(target));
}

/** Fields whose declared type is not a model — scalars, enums, `Json`. */
function schemaScalarFields(): { parent: string; field: string; target: string }[] {
  const models = schemaModelBodies();
  return schemaFields().filter(({ target }) => !models.has(target));
}

/**
 * `<parent delegate>.<relation field>` -> the gated delegate a nested write
 * through it reaches. Qualified by the declaring model because relation *names*
 * are not unique across the schema, and not even unique to relations: `classes`
 * is a `CharacterClass[]` relation on `Character` and a `Json` scalar on
 * `Spell`.
 */
function schemaGatedRelationFields(relations: SchemaRelation[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const { field, parent, target } of relations) {
    const delegate = delegateNameForModel(target);
    if (!GATED_DELEGATES.has(delegate)) continue;
    result.set(`${delegateNameForModel(parent)}.${field}`, delegate);
  }
  return result;
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

/** Entries of a `new Map([["a", "x"], ["b", "y"]])` whose values are strings. */
function mapStringEntries(source: SourceFile, name: string): Map<string, string> {
  const entries = newExpressionArgArray(source, name).getElements();
  return new Map(
    entries.map((entry): [string, string] => {
      if (!Node.isArrayLiteralExpression(entry)) {
        throw new Error(`${name} entry is not a [key, value] tuple`);
      }
      const [key, value] = entry.getElements();
      return [stringLiteralText(key, `${name} key`), stringLiteralText(value, `${name} value`)];
    }),
  );
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

function intersectionParts(typeNode: TypeNode): TypeNode[] {
  return Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
}

function typeReference(
  typeNode: TypeNode,
  expectedName: string,
  context: string,
): readonly TypeNode[] {
  if (!Node.isTypeReference(typeNode) || typeNode.getTypeName().getText() !== expectedName) {
    throw new Error(`expected ${context} to be a \`${expectedName}<...>\` type reference`);
  }
  return typeNode.getTypeArguments();
}

/**
 * Delegate property -> restricted-delegate type name from the central
 * `RestrictedDelegates` interface. Unexpected property types fail closed.
 */
function restrictedDelegateTypes(source: SourceFile): Map<string, string> {
  const result = new Map<string, string>();
  for (const property of source.getInterfaceOrThrow("RestrictedDelegates").getProperties()) {
    const propertyType = property.getTypeNode();
    if (!propertyType || !Node.isTypeReference(propertyType)) {
      throw new Error(`RestrictedDelegates.${property.getName()} is not a type reference`);
    }
    const restrictedTypeName = propertyType.getTypeName().getText();
    if (!/^Restricted.+Delegate$/u.test(restrictedTypeName)) {
      throw new Error(
        `RestrictedDelegates.${property.getName()} does not use a Restricted<Name>Delegate type`,
      );
    }
    result.set(property.getName(), restrictedTypeName);
  }
  return result;
}

/** The raw delegate selected by `BanWrites<RawTxClient["delegate"]>`. */
function rawDelegateForRestrictedType(source: SourceFile, typeAliasName: string): string {
  const aliasType = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const banWrites = intersectionParts(aliasType).find(
    (part) => Node.isTypeReference(part) && part.getTypeName().getText() === "BanWrites",
  );
  if (!banWrites) throw new Error(`${typeAliasName} has no BanWrites<...> member`);
  const [rawDelegate] = typeReference(banWrites, "BanWrites", `${typeAliasName} base`);
  if (
    !rawDelegate ||
    !Node.isIndexedAccessTypeNode(rawDelegate) ||
    rawDelegate.getObjectTypeNode().getText() !== "RawTxClient"
  ) {
    throw new Error(`${typeAliasName} does not ban writes on RawTxClient["delegate"]`);
  }
  const indexType = rawDelegate.getIndexTypeNode();
  return stringLiteralText(
    Node.isLiteralTypeNode(indexType) ? indexType.getLiteral() : undefined,
    `${typeAliasName} raw delegate`,
  );
}

/** Branded mutator properties re-declared by one restricted delegate alias. */
function brandedMutators(source: SourceFile, typeAliasName: string): Set<string> {
  const aliasType = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const typeLiteral = intersectionParts(aliasType).find((part) => Node.isTypeLiteral(part));
  if (!typeLiteral || !Node.isTypeLiteral(typeLiteral)) {
    throw new Error(`${typeAliasName} has no branded property type literal`);
  }
  const result = new Set<string>();
  for (const property of typeLiteral.getProperties()) {
    const propertyType = property.getTypeNode();
    if (
      !propertyType ||
      !Node.isTypeReference(propertyType) ||
      propertyType.getTypeName().getText() !== "ConcurrencyGatedWrite"
    ) {
      throw new Error(`${typeAliasName}.${property.getName()} is not typed ConcurrencyGatedWrite`);
    }
    result.add(property.getName());
  }
  return result;
}

function assertBanWritesDefinition(source: SourceFile): void {
  const aliasType = source.getTypeAliasOrThrow("BanWrites").getTypeNodeOrThrow();
  const [base, keys] = typeReference(aliasType, "Omit", "BanWrites");
  if (base?.getText() !== "Delegate" || keys?.getText() !== "BannedWrite") {
    throw new Error("BanWrites must remain `Omit<Delegate, BannedWrite>`");
  }
}

function typeUnionParts(typeNode: TypeNode): TypeNode[] {
  return Node.isUnionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
}

type OmitShape = {
  base: string;
  keyOfTypes: Set<string>;
  literalKeys: Set<string>;
};

function clientOmitShape(source: SourceFile, typeAliasName: string): OmitShape {
  const aliasType = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const omit = intersectionParts(aliasType).find(
    (part) => Node.isTypeReference(part) && part.getTypeName().getText() === "Omit",
  );
  if (!omit) throw new Error(`${typeAliasName} has no Omit<...> member`);
  const [base, keys] = typeReference(omit, "Omit", typeAliasName);
  if (!base || !keys) throw new Error(`${typeAliasName} Omit is missing type arguments`);

  const keyOfTypes = new Set<string>();
  const literalKeys = new Set<string>();
  for (const key of typeUnionParts(keys)) {
    if (Node.isTypeOperatorTypeNode(key) && key.getOperator() === SyntaxKind.KeyOfKeyword) {
      const operand = key.getTypeNode();
      if (Node.isTypeReference(operand)) {
        keyOfTypes.add(operand.getTypeName().getText());
        continue;
      }
    }
    if (Node.isLiteralTypeNode(key)) {
      const literal = key.getLiteral();
      if (Node.isStringLiteral(literal)) {
        literalKeys.add(literal.getLiteralText());
        continue;
      }
    }
    throw new Error(`${typeAliasName} has unsupported Omit key ${key.getText()}`);
  }
  return { base: base.getText(), keyOfTypes, literalKeys };
}

function intersectionReferenceNames(source: SourceFile, typeAliasName: string): Set<string> {
  const aliasType = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const result = new Set<string>();
  for (const part of intersectionParts(aliasType)) {
    if (Node.isTypeReference(part)) result.add(part.getTypeName().getText());
  }
  return result;
}

function typeLiteralProperties(source: SourceFile, typeAliasName: string): Map<string, string> {
  const aliasType = source.getTypeAliasOrThrow(typeAliasName).getTypeNodeOrThrow();
  const typeLiteral = intersectionParts(aliasType).find((part) => Node.isTypeLiteral(part));
  if (!typeLiteral || !Node.isTypeLiteral(typeLiteral)) {
    throw new Error(`${typeAliasName} has no type-literal member`);
  }
  return new Map(
    typeLiteral.getProperties().map((property) => {
      const propertyType = property.getTypeNode();
      if (!propertyType) throw new Error(`${typeAliasName}.${property.getName()} has no type`);
      return [property.getName(), propertyType.getText()];
    }),
  );
}

describe("concurrency-guard triple drift guard", () => {
  it("keeps the gated-delegate set in lockstep across rule, codemod, and prisma-types", () => {
    const ruleDelegates = setLiteralMembers(ruleSource, "GATED_DELEGATES");
    const prismaDelegates = restrictedDelegateTypes(prismaSource);

    expect(sorted(ruleDelegates)).toEqual(sorted(GATED_DELEGATES));
    expect(sorted(prismaDelegates.keys())).toEqual(sorted(GATED_DELEGATES));
    for (const [delegate, restrictedTypeName] of prismaDelegates) {
      expect(
        rawDelegateForRestrictedType(prismaSource, restrictedTypeName),
        `${restrictedTypeName} raw delegate drifted`,
      ).toBe(delegate);
    }
  });

  it("keeps the gated-mutator set in lockstep across rule, codemod, and prisma-types", () => {
    const ruleMutators = setLiteralMembers(ruleSource, "GATED_MUTATORS");
    expect(sorted(ruleMutators)).toEqual(sorted(GATED_MUTATORS));
    expect(
      sorted(
        stringLiteralUnionMembers(
          prismaSource.getTypeAliasOrThrow("BannedWrite").getTypeNodeOrThrow(),
        ),
      ),
    ).toEqual(sorted(GATED_MUTATORS));
    assertBanWritesDefinition(prismaSource);

    // One `Restricted<Name>Delegate` per gated delegate; a missing/extra one
    // means prisma-types and the codemod disagree on the delegate surface.
    expect(RESTRICTED_DELEGATE_TYPES).toHaveLength(GATED_DELEGATES.size);
    for (const typeName of RESTRICTED_DELEGATE_TYPES) {
      expect(
        sorted(brandedMutators(prismaSource, typeName)),
        `${typeName} branded methods drifted`,
      ).toEqual(sorted(GATED_MUTATORS));
    }
  });

  it("keeps both client shapes wired to the restricted delegates and escape gates", () => {
    const txOmit = clientOmitShape(prismaSource, "TxClient");
    expect(txOmit.base).toBe("RawTxClient");
    expect(sorted(txOmit.keyOfTypes)).toEqual(["RestrictedDelegates"]);
    expect(sorted(txOmit.literalKeys)).toEqual(["$transaction"]);
    expect(intersectionReferenceNames(prismaSource, "TxClient")).toContain("RestrictedDelegates");
    expect(typeLiteralProperties(prismaSource, "TxClient")).toEqual(
      new Map([["$transaction", "ConcurrencyGatedWrite"]]),
    );

    const dbOmit = clientOmitShape(prismaSource, "DbClient");
    expect(dbOmit.base).toBe("PrismaClient");
    expect(sorted(dbOmit.keyOfTypes)).toEqual(["RestrictedDelegates"]);
    expect(sorted(dbOmit.literalKeys)).toEqual(["$extends", "$transaction"]);
    expect(intersectionReferenceNames(prismaSource, "DbClient")).toContain("RestrictedDelegates");
    expect(typeLiteralProperties(prismaSource, "DbClient")).toEqual(
      new Map([["$transaction", "SafeTransactionFn"]]),
    );
  });

  it("keeps the nested-relation set in lockstep with the schema, the rule, and the codemod", () => {
    const expected = schemaGatedRelationFields(schemaRelations());

    // Sanity: the derivation found something, and every value is a gated
    // delegate. A silently-empty derivation would make the next two
    // assertions vacuous.
    expect(expected.size).toBeGreaterThan(0);
    expect(sorted(new Set(expected.values()))).toEqual(sorted(GATED_DELEGATES));

    expect(sortedEntries(mapStringEntries(ruleSource, "GATED_RELATION_FIELDS"))).toEqual(
      sortedEntries(expected),
    );
    expect(sortedEntries(GATED_RELATION_FIELDS)).toEqual(sortedEntries(expected));
  });

  it("keeps every nested-relation key rooted on a model that exists in the schema", () => {
    // Both enforcement copies match a nested write on `<parent>.<relation>`,
    // never on the relation key alone. Key-only matching was unsound: relation
    // names are not unique across models, and are not even unique to relations
    // — `classes` is a `CharacterClass[]` relation on `Character` and a `Json`
    // scalar on `Spell`, so `spell.update({ data: { classes: { update } } })`
    // was a hard error. This pins that every key still names a real model, so
    // a half-qualified entry cannot silently match nothing.
    const models = new Set(schemaModelNames().map(delegateNameForModel));
    const unrooted = [...GATED_RELATION_FIELDS.keys()].filter((key) => {
      const [parent, field, ...rest] = key.split(".");
      return rest.length > 0 || field === undefined || parent === undefined || !models.has(parent);
    });

    expect(unrooted).toEqual([]);
  });

  it("would mis-flag a scalar field if matching ever went back to relation keys alone", () => {
    // The live counterexample, asserted rather than described: at least one
    // non-relation field in the schema shares its name with a gated relation.
    // While this holds, dropping the parent qualification reintroduces a false
    // positive on a hard-error rule.
    const relationFields = new Set(
      schemaRelations().map(({ parent, field }) => `${parent}.${field}`),
    );
    const gatedNames = new Set(
      [...schemaGatedRelationFields(schemaRelations()).keys()].map((key) => key.split(".")[1]),
    );
    const scalarCollisions = schemaScalarFields().filter(
      ({ parent, field }) => gatedNames.has(field) && !relationFields.has(`${parent}.${field}`),
    );

    expect(scalarCollisions.length).toBeGreaterThan(0);
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
  it("recognises the same programs as the ESLint rule, over the shared corpus", () => {
    // The name maps above prove the two copies share a *vocabulary*. They do
    // not prove the two detectors share a *behaviour*: one could follow a
    // binding the other does not, or root at a different node. The corpus is
    // the behavioural half, and eslint-rules/concurrency-guard.test.js runs the
    // identical file through the rule.
    const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as NestedWriteCorpus;
    expect(corpus.cases.length).toBeGreaterThan(0);

    const corpusProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });

    for (const entry of corpus.cases) {
      const sourceFile = corpusProject.createSourceFile(entry.filename, entry.code, {
        overwrite: true,
      });
      const found = nestedRelationWrites(sourceFile).map(({ relation, method, delegate }) => ({
        relation,
        method,
        delegate,
      }));
      expect(found, entry.name).toEqual(entry.expected);
    }
  });
});
