import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SourceFile, TypeNode } from "ts-morph";
import { Node, Project, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";

import runtimeRelationGraph from "../../../packages/server/src/prisma/concurrency-relation-graph.generated.js";
import { delegateCall } from "./ast.js";
import {
  DIRECT_WRITE_REPAIR_SUGGESTIONS,
  GATED_DELEGATES,
  GATED_MUTATORS,
  PRISMA_TYPES_RELATIVE,
} from "./constants.js";
import {
  assertRepairSuggestionReferences,
  buildRelationGraph,
} from "./relation-graph-generator.js";

// The hand-chosen delegate/mutator policy remains canonical in constants.ts and
// is checked against prisma-types. The reachable relation subgraph is generated
// from that policy and schema.prisma, then consumed by lint and the runtime
// guard. These tests fail if either policy or generated topology drifts.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ESLINT_RULE_PATH = path.join(REPO_ROOT, "eslint-rules", "concurrency-guard.js");
const ESLINT_NESTED_ANALYZER_PATH = path.join(
  REPO_ROOT,
  "eslint-rules",
  "concurrency-guard-nested.js",
);
const ESLINT_GRAPH_PATH = path.join(REPO_ROOT, "eslint-rules", "concurrency-guard-graph.js");
const SCANNER_PATH = path.join(REPO_ROOT, "scripts", "codemods", "concurrency-guard", "scanner.ts");
const PRISMA_TYPES_PATH = path.join(REPO_ROOT, PRISMA_TYPES_RELATIVE);
const PRISMA_SCHEMA_PATH = path.join(REPO_ROOT, "packages", "server", "prisma", "schema.prisma");
const CONCURRENCY_GUIDE_PATH = path.join(REPO_ROOT, "docs", "CONCURRENCY.md");
const RELATION_GRAPH_PATH = path.join(
  REPO_ROOT,
  "packages",
  "server",
  "src",
  "prisma",
  "concurrency-relation-graph.generated.json",
);
const DIRECT_CORPUS_PATH = path.join(
  REPO_ROOT,
  "eslint-rules",
  "concurrency-guard-direct-corpus.json",
);

interface DirectWriteCorpusCase {
  name: string;
  filename: string;
  code: string;
  expected: { method: string; delegate: string }[];
}

interface DirectWriteCorpus {
  cases: DirectWriteCorpusCase[];
}

interface GeneratedRelationGraph {
  dataScalarModels: string[];
  generatedBy: string;
  gatedModels: string[];
  gatedOperations: string[];
  payloadEnvelopeKeys: string[];
  repairSuggestions: Record<string, string>;
  models: Record<string, Record<string, string>>;
}

interface RuntimeDataModel {
  models: Record<string, { fields: { kind: string; name: string; type: string }[] }>;
}

const generatedRelationGraph = JSON.parse(
  readFileSync(RELATION_GRAPH_PATH, "utf8"),
) as GeneratedRelationGraph;

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true },
});
const ruleSource = project.addSourceFileAtPath(ESLINT_RULE_PATH);
const nestedAnalyzerSource = project.addSourceFileAtPath(ESLINT_NESTED_ANALYZER_PATH);
const lintGraphSource = project.addSourceFileAtPath(ESLINT_GRAPH_PATH);
const scannerSource = project.addSourceFileAtPath(SCANNER_PATH);
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

function prismaRuntimeDataModel(): RuntimeDataModel {
  const source = readFileSync(
    path.join(REPO_ROOT, "packages/server/src/generated/prisma/internal/class.ts"),
    "utf8",
  );
  const match = source.match(/config\.runtimeDataModel = JSON\.parse\(("(?:\\.|[^"\\])*")\)/u);
  if (match?.[1] === undefined) throw new Error("generated Prisma runtime datamodel is absent");
  const encoded: unknown = JSON.parse(match[1]);
  if (typeof encoded !== "string") throw new Error("Prisma runtime datamodel is not encoded JSON");
  return JSON.parse(encoded) as RuntimeDataModel;
}

/** Prisma delegate name for a model: `CharacterStats` -> `characterStats`. */
function delegateNameForModel(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function stringLiteralText(node: Node | undefined, context: string): string {
  if (!node || !Node.isStringLiteral(node)) {
    throw new Error(`expected a string literal for ${context}`);
  }
  return node.getLiteralText();
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
  it("keeps the runtime and lint relation-graph payloads identical", () => {
    const { generatedBy: _generatedBy, ...lintRelationGraph } = generatedRelationGraph;

    expect(runtimeRelationGraph).toEqual(lintRelationGraph);
  });

  it("keeps the gated-delegate set in lockstep across graph, codemod, and prisma-types", () => {
    const prismaDelegates = restrictedDelegateTypes(prismaSource);

    expect(sorted(generatedRelationGraph.gatedModels.map(delegateNameForModel))).toEqual(
      sorted(GATED_DELEGATES),
    );
    expect(sorted(prismaDelegates.keys())).toEqual(sorted(GATED_DELEGATES));
    for (const [delegate, restrictedTypeName] of prismaDelegates) {
      expect(
        rawDelegateForRestrictedType(prismaSource, restrictedTypeName),
        `${restrictedTypeName} raw delegate drifted`,
      ).toBe(delegate);
    }
  });

  it("keeps the gated-mutator set in lockstep across graph, codemod, and prisma-types", () => {
    expect(sorted(generatedRelationGraph.gatedOperations)).toEqual(sorted(GATED_MUTATORS));
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

  it("keeps the generated descriptor fresh against schema, policy, and live docs anchors", () => {
    assertRepairSuggestionReferences(
      readFileSync(CONCURRENCY_GUIDE_PATH, "utf8"),
      DIRECT_WRITE_REPAIR_SUGGESTIONS,
      REPO_ROOT,
    );
    const expected = buildRelationGraph(
      readFileSync(PRISMA_SCHEMA_PATH, "utf8"),
      [...GATED_DELEGATES],
      [...GATED_MUTATORS],
      DIRECT_WRITE_REPAIR_SUGGESTIONS,
    );

    expect(generatedRelationGraph).toEqual({
      generatedBy: "scripts/codemods/concurrency-guard/generate-relation-graph.ts",
      ...expected,
    });
    expect(Object.keys(generatedRelationGraph.models).length).toBeGreaterThan(0);
    expect(
      Object.values(generatedRelationGraph.models).reduce(
        (count, relations) => count + Object.keys(relations).length,
        0,
      ),
    ).toBeGreaterThan(0);
  });

  it("rejects a renamed live repair heading in the always-on drift gate", () => {
    const concurrencyGuide = readFileSync(CONCURRENCY_GUIDE_PATH, "utf8").replace(
      "## Pattern C — compound `updateMany` with the precondition in `where`",
      "## Pattern C — renamed encounter-state heading",
    );

    expect(() => {
      assertRepairSuggestionReferences(
        concurrencyGuide,
        DIRECT_WRITE_REPAIR_SUGGESTIONS,
        REPO_ROOT,
      );
    }).toThrow(
      "repair suggestion anchor for encounter does not resolve to a docs/CONCURRENCY.md heading: " +
        "docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where",
    );
  });

  it("matches Prisma's independently generated runtime datamodel", () => {
    const runtime = prismaRuntimeDataModel();
    const gated = new Set(generatedRelationGraph.gatedModels);
    function reachesGated(model: string, seen = new Set<string>()): boolean {
      if (gated.has(model)) return true;
      if (seen.has(model)) return false;
      seen.add(model);
      return (
        runtime.models[model]?.fields.some(
          (field) => field.kind === "object" && reachesGated(field.type, seen),
        ) ?? false
      );
    }
    const reachable = new Set(Object.keys(runtime.models).filter((model) => reachesGated(model)));

    expect(generatedRelationGraph.models).toEqual(
      Object.fromEntries(
        sorted(reachable).map((model) => [
          model,
          Object.fromEntries(
            runtime.models[model]?.fields
              .filter((field) => field.kind === "object" && reachable.has(field.type))
              .map((field) => [field.name, field.type]) ?? [],
          ),
        ]),
      ),
    );
    expect(generatedRelationGraph.dataScalarModels).toEqual(
      sorted(reachable).filter((model) =>
        runtime.models[model]?.fields.some(
          (field) => field.name === "data" && field.kind !== "object",
        ),
      ),
    );
  });

  it("makes the generated graph the lint rule's sole relation source", () => {
    const ruleImportPaths = ruleSource
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue());
    const analyzerImportPaths = nestedAnalyzerSource
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue());
    expect(ruleImportPaths).toContain("./concurrency-guard-graph.js");
    expect(analyzerImportPaths).toContain("./concurrency-guard-graph.js");
    const graphImportPaths = lintGraphSource
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue());
    expect(graphImportPaths).toContain(
      "../packages/server/src/prisma/concurrency-relation-graph.generated.json",
    );
    expect(ruleSource.getVariableDeclaration("GATED_RELATION_FIELDS")).toBeUndefined();
    expect(nestedAnalyzerSource.getVariableDeclaration("GATED_RELATION_FIELDS")).toBeUndefined();
  });

  it("sources direct-write suggestions from the generated descriptor", () => {
    expect(ruleSource.getVariableDeclaration("DIRECT_WRITE_SUGGESTIONS")).toBeUndefined();
    expect(scannerSource.getVariableDeclaration("DIRECT_WRITE_SUGGESTIONS")).toBeUndefined();
    expect(sorted(Object.keys(generatedRelationGraph.repairSuggestions))).toEqual(
      sorted(GATED_DELEGATES),
    );
    const directWriteFindings = scannerSource.getFunctionOrThrow("directWriteFindings");
    const suggestion = directWriteFindings
      .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
      .find((property) => property.getName() === "suggestion");
    if (suggestion === undefined) throw new Error("directWriteFindings has no suggestion property");
    const initializer = suggestion.getInitializerOrThrow();
    if (
      !Node.isBinaryExpression(initializer) ||
      initializer.getOperatorToken().getKind() !== SyntaxKind.QuestionQuestionToken
    ) {
      throw new Error("directWriteFindings suggestion does not use the generated fallback path");
    }
    expect(initializer.getLeft().getText()).toBe("REPAIR_SUGGESTIONS.get(target.delegate)");
    expect(stringLiteralText(initializer.getRight(), "direct-write fallback suggestion")).toBe(
      "Route race-sensitive writes through the documented helper boundary; see docs/CONCURRENCY.md.",
    );
  });

  it("keeps every suggested helper exported by its suggested module", () => {
    for (const [delegate, suggestion] of DIRECT_WRITE_REPAIR_SUGGESTIONS) {
      const helperClause = suggestion.match(
        /^(?:Route \w+ writes through|Use) (.+?) (?:in|from) (packages\/server\/src\/utils\/[\w-]+-mutations\.ts)\b/u,
      );
      const helperNames = helperClause?.[1]?.split(/,\s+(?:or\s+)?|\s+or\s+/u);
      const modulePath = helperClause?.[2];
      if (helperNames === undefined || modulePath === undefined) {
        throw new Error(`cannot parse repair helpers for ${delegate}`);
      }
      const helperSource = project.addSourceFileAtPath(path.join(REPO_ROOT, modulePath));

      for (const helperName of helperNames) {
        expect(
          helperSource.getFunction(helperName)?.isExported(),
          `${modulePath} does not export ${helperName}`,
        ).toBe(true);
      }
    }
  });

  it("matches the ESLint rule for every declared direct corpus case", () => {
    const corpus = JSON.parse(readFileSync(DIRECT_CORPUS_PATH, "utf8")) as DirectWriteCorpus;
    expect(corpus.cases.length).toBeGreaterThan(0);

    const directProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { allowJs: true },
    });

    for (const entry of corpus.cases) {
      const sourceFile = directProject.createSourceFile(entry.filename, entry.code, {
        overwrite: true,
      });
      const found = sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .map(delegateCall)
        .filter((call) => call !== undefined)
        .map(({ delegate, method }) => ({ delegate, method }));

      expect(found, entry.name).toEqual(entry.expected);
    }
  });
});
