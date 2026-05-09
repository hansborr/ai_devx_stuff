#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CallExpression,
  Node,
  ObjectLiteralExpression,
  Project,
  SourceFile,
  SyntaxKind,
} from "ts-morph";

import { CodemodError, createProject, fail as failWithName } from "./lib/trpc-shared-schema.js";

const CODEMOD_NAME = "concurrency-guard";
const SERVER_SRC_ROOT = path.join("packages", "server", "src");
const UTILS_ROOT = path.join(SERVER_SRC_ROOT, "utils");
const PRISMA_TYPES_RELATIVE = path.join(UTILS_ROOT, "prisma-types.ts");
const GATED_DELEGATES = new Set([
  "characterStats",
  "encounterParticipant",
  "encounter",
  "characterSpellSlot",
  "characterClass",
]);
// Prisma also exposes create/delete variants on these delegates. They are
// outside the current concurrency gate; this checker mirrors the restricted
// update/upsert surface in packages/server/src/utils/prisma-types.ts.
const GATED_MUTATORS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);
const HANDLED_HELPER_MUTATOR = "handled-helper-mutator";

type CliArgs = { mode: "check" } | { mode: "all" } | { mode: "single"; file: string };
type Verdict = "ERROR" | "WARN";

type Finding = {
  category: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
  target: string;
  verdict: Verdict;
};

type DelegateCall = {
  call: CallExpression;
  delegate: string;
  method: string;
};

type PatternAConfig = {
  delegate: string;
  rowKey: string;
  checkedFunctions: Set<string>;
};

type PatternBConfig = {
  delegate: string;
  countersByFunction: Map<string, string>;
};

type EncounterShape = {
  fields: string[];
};

type NonCasHelperShape = {
  dataFields?: string[];
  dataPropertyRequired?: boolean;
  delegate: string;
  functionName: string;
  method: string;
  updateFields?: string[];
  upsertCreateFields?: string[];
  whereFields: string[];
};

type PatternClassification = Finding | typeof HANDLED_HELPER_MUTATOR | undefined;

export type ConcurrencyGuardCodemodArgs = string[];

const PATTERN_A_BY_FILE = new Map<string, PatternAConfig>([
  [
    "character-stats-mutations.ts",
    {
      checkedFunctions: new Set([
        "updateCharacterStatsLocked",
        "updateCharacterStatsLockedWithExpectedVersion",
      ]),
      delegate: "characterStats",
      rowKey: "characterId",
    },
  ],
  [
    "participant-stats-mutations.ts",
    {
      checkedFunctions: new Set([
        "updateParticipantStatsLocked",
        "updateParticipantStatsLockedWithExpectedVersion",
      ]),
      delegate: "encounterParticipant",
      rowKey: "id",
    },
  ],
]);

const PATTERN_B_BY_FILE = new Map<string, PatternBConfig>([
  [
    "spell-slot-mutations.ts",
    {
      countersByFunction: new Map([
        ["consumeSpellSlot", "used"],
        ["recoverSpellSlot", "used"],
      ]),
      delegate: "characterSpellSlot",
    },
  ],
  [
    "character-class-mutations.ts",
    {
      countersByFunction: new Map([
        ["spendHitDice", "hitDiceUsed"],
        ["advanceClassLevel", "level"],
        ["setSubclass", "subclassId"],
      ]),
      delegate: "characterClass",
    },
  ],
]);

const ENCOUNTER_STATE_FILE = "encounter-state-mutations.ts";

const NON_CAS_HELPER_SHAPES: NonCasHelperShape[] = [
  {
    dataPropertyRequired: true,
    delegate: "encounterParticipant",
    functionName: "blindUpdateParticipant",
    method: "updateMany",
    whereFields: ["id"],
  },
  {
    dataFields: ["used"],
    delegate: "characterSpellSlot",
    functionName: "resetAllSpellSlots",
    method: "updateMany",
    whereFields: ["characterId"],
  },
  {
    delegate: "characterSpellSlot",
    functionName: "setSpellSlotTotal",
    method: "upsert",
    updateFields: ["total"],
    upsertCreateFields: ["characterId", "spellLevel", "total", "used"],
    whereFields: ["characterId_spellLevel"],
  },
  {
    delegate: "characterSpellSlot",
    functionName: "grantTemporarySlot",
    method: "upsert",
    updateFields: ["total"],
    upsertCreateFields: ["characterId", "spellLevel", "total", "used"],
    whereFields: ["characterId_spellLevel"],
  },
  {
    dataFields: ["hitDiceUsed"],
    delegate: "characterClass",
    functionName: "resetAllHitDice",
    method: "updateMany",
    whereFields: ["characterId"],
  },
];

const DIRECT_WRITE_SUGGESTIONS = new Map<string, string>([
  [
    "characterStats",
    "Use updateCharacterStatsLocked/updateCharacterStatsLockedWithExpectedVersion; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounterParticipant",
    "Use updateParticipantStatsLocked/updateParticipantStatsLockedWithExpectedVersion or blindUpdateParticipant for documented metadata; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounter",
    "Use the encounter-state helpers in packages/server/src/utils/encounter-state-mutations.ts; see docs/CONCURRENCY.md#pattern-c--compound-updatemany-for-encounter-state.",
  ],
  [
    "characterSpellSlot",
    "Use consumeSpellSlot/recoverSpellSlot or documented slot sync helpers; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
  [
    "characterClass",
    "Use spendHitDice/advanceClassLevel/setSubclass or documented rest helpers; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
]);

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function parseArgs(args: string[]): CliArgs {
  const positional: string[] = [];
  let all = false;
  let check = false;
  for (const arg of args) {
    if (!arg) fail("Empty arguments are not supported.");
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown argument: ${arg}`);
    positional.push(arg);
  }

  if (check) {
    if (all || positional.length !== 0) {
      fail("Usage: bun run codemod:concurrency-guard -- --check");
    }
    return { mode: "check" };
  }
  if (all) {
    if (positional.length !== 0) {
      fail("Usage: bun run codemod:concurrency-guard -- --all");
    }
    return { mode: "all" };
  }
  if (positional.length !== 1) {
    fail("Usage: bun run codemod:concurrency-guard -- --check | --all | <file>");
  }
  const file = positional[0];
  if (!file) fail("File argument is required.");
  return { mode: "single", file };
}

function normalizeRelativePath(root: string, filePath: string): string {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("File must be inside the current repository.");
  }
  if (!relative.endsWith(".ts")) fail("File must be a .ts file.");
  return relative;
}

function isGeneratedPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("generated");
}

function isTypeTestPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("__type-tests__");
}

function isTestPath(relativePath: string): boolean {
  return /\.test\.tsx?$/u.test(relativePath);
}

function isExcludedPath(relativePath: string): boolean {
  return isTypeTestPath(relativePath) || isGeneratedPath(relativePath) || isTestPath(relativePath);
}

function discoverFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile() || !currentPath.endsWith(".ts")) continue;
      const relative = path.relative(root, currentPath);
      if (isExcludedPath(relative)) continue;
      files.push(relative);
    }
  };
  visit(path.join(root, SERVER_SRC_ROOT));
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function isMutationHelperPath(relativePath: string): boolean {
  return (
    path.dirname(relativePath) === UTILS_ROOT &&
    path.basename(relativePath).endsWith("-mutations.ts")
  );
}

function rawTxClientAllowed(relativePath: string): boolean {
  return relativePath === PRISMA_TYPES_RELATIVE || isMutationHelperPath(relativePath);
}

function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function delegateName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) {
    const name = node.getText();
    return GATED_DELEGATES.has(name) ? name : undefined;
  }
  if (Node.isPropertyAccessExpression(node)) {
    const name = node.getName();
    return GATED_DELEGATES.has(name) ? name : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const name = staticString(node.getArgumentExpression());
    return name && GATED_DELEGATES.has(name) ? name : undefined;
  }
  return undefined;
}

function delegateCall(call: CallExpression): DelegateCall | undefined {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const method = expression.getName();
  if (!GATED_MUTATORS.has(method)) return undefined;
  const delegate = delegateName(expression.getExpression());
  if (!delegate) return undefined;
  return { call, delegate, method };
}

function objectPropertyValue(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
): Node | undefined {
  for (const property of objectLiteral.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === propertyName) {
      return property.getInitializer();
    }
  }
  return undefined;
}

function objectHasProperty(objectLiteral: ObjectLiteralExpression, propertyName: string): boolean {
  for (const property of objectLiteral.getProperties()) {
    if (
      (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) &&
      property.getName() === propertyName
    ) {
      return true;
    }
  }
  return false;
}

function objectPropertyObject(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  const value = objectPropertyValue(objectLiteral, propertyName);
  return value && Node.isObjectLiteralExpression(value) ? value : undefined;
}

function callOptions(call: CallExpression): ObjectLiteralExpression | undefined {
  const first = call.getArguments()[0];
  return first && Node.isObjectLiteralExpression(first) ? first : undefined;
}

function hasWhereFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const where = objectPropertyObject(options, "where");
  if (!where) return false;
  return fields.every((field) => objectHasProperty(where, field));
}

function hasVersionIncrement(call: CallExpression): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const data = objectPropertyObject(options, "data");
  if (!data) return false;
  const version = objectPropertyObject(data, "version");
  return version ? objectHasProperty(version, "increment") : false;
}

function hasDataFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const data = objectPropertyObject(options, "data");
  if (!data) return false;
  return fields.every((field) => objectHasProperty(data, field));
}

function hasDataProperty(call: CallExpression): boolean {
  const options = callOptions(call);
  return options ? objectHasProperty(options, "data") : false;
}

function hasUpsertCreateFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const create = objectPropertyObject(options, "create");
  if (!create) return false;
  return fields.every((field) => objectHasProperty(create, field));
}

function hasUpsertUpdateFields(call: CallExpression, fields: string[]): boolean {
  const options = callOptions(call);
  if (!options) return false;
  const update = objectPropertyObject(options, "update");
  if (!update) return false;
  return fields.every((field) => objectHasProperty(update, field));
}

function enclosingFunctionName(node: Node): string | undefined {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) return ancestor.getName();
    if (Node.isVariableDeclaration(ancestor)) {
      const initializer = ancestor.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return ancestor.getName();
      }
    }
    if (Node.isMethodDeclaration(ancestor)) return ancestor.getName();
  }
  return undefined;
}

function unwrapAwait(node: Node): Node {
  if (Node.isAwaitExpression(node)) return node.getExpression();
  return node;
}

function assignedVariableName(call: CallExpression): string | undefined {
  const parent = call.getParent();
  const initializer = parent && Node.isAwaitExpression(parent) ? parent : call;
  const container = initializer.getParent();
  if (!container || !Node.isVariableDeclaration(container)) return undefined;
  const variableInitializer = container.getInitializer();
  if (!variableInitializer) return undefined;
  if (unwrapAwait(variableInitializer) !== call) return undefined;
  return container.getName();
}

function nearestStatement(node: Node): Node | undefined {
  for (const ancestor of node.getAncestors()) {
    if (Node.isStatement(ancestor)) return ancestor;
  }
  return undefined;
}

function siblingStatementsAfter(node: Node): Node[] {
  const statement = nearestStatement(node);
  if (!statement) return [];
  const parent = statement.getParent();
  const statements =
    parent && (Node.isBlock(parent) || Node.isSourceFile(parent)) ? parent.getStatements() : [];
  const index = statements.findIndex((candidate) => candidate === statement);
  return index === -1 ? [] : statements.slice(index + 1);
}

function isZeroLiteral(node: Node): boolean {
  return Node.isNumericLiteral(node) && node.getLiteralText() === "0";
}

function isCountAccess(node: Node, resultName: string): boolean {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== "count") return false;
  return node.getExpression().getText() === resultName;
}

function isZeroCountCondition(node: Node, resultName: string): boolean {
  if (!Node.isBinaryExpression(node)) return false;
  const operatorKind = node.getOperatorToken().getKind();
  if (
    operatorKind !== SyntaxKind.EqualsEqualsEqualsToken &&
    operatorKind !== SyntaxKind.EqualsEqualsToken
  ) {
    return false;
  }
  const left = node.getLeft();
  const right = node.getRight();
  return (
    (isCountAccess(left, resultName) && isZeroLiteral(right)) ||
    (isZeroLiteral(left) && isCountAccess(right, resultName))
  );
}

function objectStringPropertyEquals(
  objectLiteral: ObjectLiteralExpression,
  propertyName: string,
  expectedValue: string,
): boolean {
  const value = objectPropertyValue(objectLiteral, propertyName);
  return staticString(value) === expectedValue;
}

function hasTrpcErrorThrow(node: Node, codes: string[]): boolean {
  for (const newExpression of node.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (newExpression.getExpression().getText() !== "TRPCError") continue;
    const firstArg = newExpression.getArguments()[0];
    if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) continue;
    for (const code of codes) {
      if (objectStringPropertyEquals(firstArg, "code", code)) return true;
    }
  }
  return false;
}

function hasZeroCountTrpcErrorHandling(call: CallExpression, codes: string[]): boolean {
  const resultName = assignedVariableName(call);
  if (!resultName) return false;
  for (const statement of siblingStatementsAfter(call)) {
    if (!Node.isIfStatement(statement)) continue;
    if (!isZeroCountCondition(statement.getExpression(), resultName)) continue;
    if (hasTrpcErrorThrow(statement.getThenStatement(), codes)) return true;
  }
  return false;
}

function hasZeroCountConflictHandling(call: CallExpression): boolean {
  return hasZeroCountTrpcErrorHandling(call, ["CONFLICT"]);
}

function hasZeroCountAnyHandling(call: CallExpression): boolean {
  return hasZeroCountTrpcErrorHandling(call, ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND"]);
}

function hasReturnedCount(call: CallExpression): boolean {
  const resultName = assignedVariableName(call);
  if (!resultName) return false;
  for (const statement of siblingStatementsAfter(call)) {
    if (!Node.isReturnStatement(statement)) continue;
    const expression = statement.getExpression();
    if (expression && isCountAccess(expression, resultName)) return true;
  }
  return false;
}

function rawImportFindings(sourceFile: SourceFile, relativePath: string): Finding[] {
  if (rawTxClientAllowed(relativePath)) return [];
  const findings: Finding[] = [];
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (!importDeclaration.getModuleSpecifierValue().endsWith("/prisma-types.js")) continue;
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (namedImport.getName() !== "RawTxClient") continue;
      findings.push({
        category: "raw-tx-boundary",
        file: relativePath,
        line: namedImport.getStartLineNumber(),
        message: "RawTxClient import is outside the restricted mutation-helper boundary.",
        suggestion:
          "Move raw gated writes behind packages/server/src/utils/*-mutations.ts; see docs/guides/add-race-sensitive-mutation.md#add-a-race-sensitive-mutation.",
        target: "RawTxClient",
        verdict: "ERROR",
      });
    }
  }
  return findings;
}

function directWriteFindings(sourceFile: SourceFile, relativePath: string): Finding[] {
  if (isMutationHelperPath(relativePath)) return [];
  const findings: Finding[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = delegateCall(call);
    if (!target) continue;
    findings.push({
      category: "direct-gated-write",
      file: relativePath,
      line: call.getStartLineNumber(),
      message:
        "Direct gated delegate write found. This checker uses receiver-name matching, so aliases/destructuring may need manual review.",
      suggestion:
        DIRECT_WRITE_SUGGESTIONS.get(target.delegate) ??
        "Route race-sensitive writes through the documented helper boundary; see docs/CONCURRENCY.md.",
      target: `${target.delegate}.${target.method}`,
      verdict: "ERROR",
    });
  }
  return findings;
}

function patternFinding(
  relativePath: string,
  call: CallExpression,
  target: string,
  category: string,
  missing: string[],
  suggestion: string,
): PatternClassification {
  if (missing.length === 0) return HANDLED_HELPER_MUTATOR;
  return {
    category,
    file: relativePath,
    line: call.getStartLineNumber(),
    message: `Helper raw updateMany is missing ${missing.join(", ")}.`,
    suggestion,
    target,
    verdict: "ERROR",
  };
}

function nonCasShapeMissing(shape: NonCasHelperShape, call: CallExpression): string[] {
  const missing: string[] = [];
  if (!hasWhereFields(call, shape.whereFields)) {
    missing.push(`WHERE ${shape.whereFields.join("+")}`);
  }
  if (shape.dataPropertyRequired && !hasDataProperty(call)) missing.push("data payload");
  if (shape.dataFields && !hasDataFields(call, shape.dataFields)) {
    missing.push(`data.${shape.dataFields.join("+")}`);
  }
  if (shape.upsertCreateFields && !hasUpsertCreateFields(call, shape.upsertCreateFields)) {
    missing.push(`create.${shape.upsertCreateFields.join("+")}`);
  }
  if (shape.updateFields && !hasUpsertUpdateFields(call, shape.updateFields)) {
    missing.push(`update.${shape.updateFields.join("+")}`);
  }
  return missing;
}

function nonCasHelperFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const functionName = enclosingFunctionName(target.call);
  if (!functionName) return undefined;
  const shape = NON_CAS_HELPER_SHAPES.find(
    (candidate) =>
      candidate.functionName === functionName &&
      candidate.delegate === target.delegate &&
      candidate.method === target.method,
  );
  if (!shape) return undefined;
  const missing = nonCasShapeMissing(shape, target.call);
  if (missing.length === 0) return HANDLED_HELPER_MUTATOR;
  return {
    category: "non-cas-helper-shape",
    file: relativePath,
    line: target.call.getStartLineNumber(),
    message: `Documented non-CAS helper raw ${target.method} is missing ${missing.join(", ")}.`,
    suggestion:
      "Keep intentional non-CAS helper writes on their documented exact shape, or update docs/CONCURRENCY.md before changing the allowlist.",
    target: `${target.delegate}.${target.method}`,
    verdict: "ERROR",
  };
}

function patternAFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const config = PATTERN_A_BY_FILE.get(path.basename(relativePath));
  if (!config || target.delegate !== config.delegate) return undefined;
  const functionName = enclosingFunctionName(target.call);
  if (target.method !== "updateMany") return undefined;
  if (!functionName || !config.checkedFunctions.has(functionName)) {
    return {
      category: "pattern-a-helper-shape",
      file: relativePath,
      line: target.call.getStartLineNumber(),
      message: "Unclassified Pattern A helper raw updateMany found.",
      suggestion:
        "Keep raw Pattern A writes in the documented locked helpers or update docs/CONCURRENCY.md before adding a new helper.",
      target: `${target.delegate}.updateMany`,
      verdict: "ERROR",
    };
  }

  const missing: string[] = [];
  if (!hasWhereFields(target.call, [config.rowKey, "version"])) {
    missing.push(`WHERE ${config.rowKey}+version`);
  }
  if (!hasVersionIncrement(target.call)) missing.push("data.version increment");
  if (!hasZeroCountConflictHandling(target.call)) missing.push("zero-count CONFLICT handling");
  return patternFinding(
    relativePath,
    target.call,
    `${target.delegate}.updateMany`,
    "pattern-a-helper-shape",
    missing,
    "Preserve Pattern A row-id+version CAS; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  );
}

function patternBFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const config = PATTERN_B_BY_FILE.get(path.basename(relativePath));
  if (!config || target.delegate !== config.delegate) return undefined;
  const functionName = enclosingFunctionName(target.call);
  if (target.method !== "updateMany") return undefined;
  const counter = functionName ? config.countersByFunction.get(functionName) : undefined;
  if (!counter) {
    return {
      category: "pattern-b-helper-shape",
      file: relativePath,
      line: target.call.getStartLineNumber(),
      message: "Unclassified Pattern B helper raw updateMany found.",
      suggestion:
        "Classify the helper as counter-CAS or documented non-racing before adding raw updateMany; see docs/guides/add-race-sensitive-mutation.md#add-a-race-sensitive-mutation.",
      target: `${target.delegate}.updateMany`,
      verdict: "ERROR",
    };
  }

  const missing: string[] = [];
  if (!hasWhereFields(target.call, ["id", counter])) missing.push(`WHERE id+${counter}`);
  if (!hasZeroCountConflictHandling(target.call)) missing.push("zero-count CONFLICT handling");
  return patternFinding(
    relativePath,
    target.call,
    `${target.delegate}.updateMany`,
    "pattern-b-helper-shape",
    missing,
    "Preserve Pattern B counter-as-CAS; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  );
}

function encounterShape(target: DelegateCall): EncounterShape | undefined {
  const functionName = enclosingFunctionName(target.call);
  if (functionName === "setEncounterState") {
    return { fields: ["id", "state"] };
  }
  if (functionName === "advanceTurnCompound") {
    return { fields: ["id", "state", "currentTurnIndex", "round"] };
  }
  if (functionName === "setCurrentTurnIndex") {
    return { fields: ["id", "currentTurnIndex"] };
  }
  if (functionName === "assertTurnLock") {
    const fields = hasWhereFields(target.call, ["currentTurnIndex"])
      ? ["id", "state", "currentTurnIndex", "round"]
      : ["id", "state", "round"];
    return { fields };
  }
  if (functionName === "updateEncounterMeta") return { fields: ["id"] };
  return undefined;
}

function patternCFinding(relativePath: string, target: DelegateCall): PatternClassification {
  if (
    path.basename(relativePath) !== ENCOUNTER_STATE_FILE ||
    target.delegate !== "encounter" ||
    target.method !== "updateMany"
  ) {
    return undefined;
  }
  const shape = encounterShape(target);
  if (!shape) {
    return {
      category: "pattern-c-helper-shape",
      file: relativePath,
      line: target.call.getStartLineNumber(),
      message: "Unclassified Pattern C helper raw updateMany found.",
      suggestion:
        "Document the compound WHERE fields in docs/CONCURRENCY.md before adding a new encounter-state helper.",
      target: "encounter.updateMany",
      verdict: "ERROR",
    };
  }
  const functionName = enclosingFunctionName(target.call);

  const missing: string[] = [];
  if (!hasWhereFields(target.call, shape.fields)) missing.push(`WHERE ${shape.fields.join("+")}`);
  if (functionName === "advanceTurnCompound" && !hasReturnedCount(target.call)) {
    missing.push("return result.count");
  }
  if (
    (functionName === "setEncounterState" || functionName === "setCurrentTurnIndex") &&
    !hasZeroCountConflictHandling(target.call)
  ) {
    missing.push("zero-count CONFLICT handling");
  }
  if (
    functionName === "updateEncounterMeta" &&
    !hasZeroCountTrpcErrorHandling(target.call, ["NOT_FOUND"])
  ) {
    missing.push("zero-count NOT_FOUND handling");
  }
  if (functionName === "assertTurnLock" && !hasZeroCountAnyHandling(target.call)) {
    missing.push("zero-count documented error handling");
  }
  return patternFinding(
    relativePath,
    target.call,
    "encounter.updateMany",
    "pattern-c-helper-shape",
    missing,
    "Preserve Pattern C compound WHERE checks; see docs/CONCURRENCY.md#pattern-c--compound-updatemany-for-encounter-state.",
  );
}

function isPatternFinding(classification: PatternClassification): classification is Finding {
  return classification !== undefined && classification !== HANDLED_HELPER_MUTATOR;
}

function unclassifiedHelperMutatorFinding(relativePath: string, target: DelegateCall): Finding {
  return {
    category: "unclassified-helper-mutator",
    file: relativePath,
    line: target.call.getStartLineNumber(),
    message: "Unclassified raw gated mutator found inside a mutation helper.",
    suggestion:
      "Make this call match an existing Pattern A/B/C shape, or review it and add it to the recognizer set or an explicit allowlist.",
    target: `${target.delegate}.${target.method}`,
    verdict: "ERROR",
  };
}

function helperShapeFindings(sourceFile: SourceFile, relativePath: string): Finding[] {
  if (!isMutationHelperPath(relativePath)) return [];
  const findings: Finding[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = delegateCall(call);
    if (!target) continue;
    const nonCasClassification = nonCasHelperFinding(relativePath, target);
    if (isPatternFinding(nonCasClassification)) {
      findings.push(nonCasClassification);
      continue;
    }
    if (nonCasClassification === HANDLED_HELPER_MUTATOR) continue;

    const classifications = [
      patternAFinding(relativePath, target),
      patternBFinding(relativePath, target),
      patternCFinding(relativePath, target),
    ];
    const finding = classifications.find(isPatternFinding);
    if (finding) {
      findings.push(finding);
      continue;
    }
    if (classifications.includes(HANDLED_HELPER_MUTATOR)) continue;
    findings.push(unclassifiedHelperMutatorFinding(relativePath, target));
  }
  return findings;
}

function scanFile(project: Project, root: string, relativePath: string): Finding[] {
  if (isExcludedPath(relativePath)) return [];
  const sourceFile = project.addSourceFileAtPath(path.join(root, relativePath));
  return [
    ...rawImportFindings(sourceFile, relativePath),
    ...directWriteFindings(sourceFile, relativePath),
    ...helperShapeFindings(sourceFile, relativePath),
  ];
}

function printFindings(findings: Finding[]): void {
  for (const finding of findings) {
    console.log(
      `${finding.file}:${String(finding.line)} ${finding.target}/${finding.category} ${finding.verdict} ${finding.message} Suggestion: ${finding.suggestion}`,
    );
  }
}

function runScan(args: CliArgs, root: string): Finding[] {
  const targets =
    args.mode === "single" ? [normalizeRelativePath(root, args.file)] : discoverFiles(root);
  const project = createProject();
  const findings: Finding[] = [];
  for (const relativePath of targets) findings.push(...scanFile(project, root, relativePath));
  return findings.sort((left, right) => {
    const fileOrder = left.file.localeCompare(right.file, "en");
    if (fileOrder !== 0) return fileOrder;
    return left.line - right.line;
  });
}

export function runConcurrencyGuardCodemod(
  args: ConcurrencyGuardCodemodArgs,
  root = process.cwd(),
): void {
  const parsed = parseArgs(args);
  const findings = runScan(parsed, root);
  if (findings.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no name-based concurrency guard findings; aliases/destructuring still need manual review.`,
    );
    return;
  }
  printFindings(findings);
  const errorCount = findings.filter((finding) => finding.verdict === "ERROR").length;
  if (errorCount > 0) {
    throw new CodemodError(CODEMOD_NAME, `found ${String(errorCount)} concurrency guard error(s).`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runConcurrencyGuardCodemod(process.argv.slice(2));
}
