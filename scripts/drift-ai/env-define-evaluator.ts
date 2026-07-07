import { ts } from "ts-morph";

import type { DriftAiIgnoreConfig } from "./config.js";
import { predictedBranchFor } from "./env-define-evaluation.js";
import { collectReadsInExpression, rangeFor, readEvidenceFromNode } from "./env-define-reads.js";
import type {
  EnvDefineConditionEvidence,
  EnvDefineInventory,
  EnvDefineMatrix,
  EnvDefineReadEvidence,
  EnvDefineSourceInput,
} from "./env-define-types.js";
import {
  collectParsedSourceFiles,
  type ParsedSourceFile,
  type ParsedSourceFileCache,
} from "./parsed-source-cache.js";
import { toPosix } from "./path-util.js";
import { scriptKindFor } from "./ts-source-util.js";

export type CollectEnvDefineInventoryInput = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
  readonly matrix: EnvDefineMatrix;
  readonly parsedSourceCache?: ParsedSourceFileCache;
};

export function collectEnvDefineInventory(
  input: CollectEnvDefineInventoryInput,
): EnvDefineInventory {
  const parsedSources =
    input.parsedSourceCache?.collect({
      repoRoot: input.repoRoot,
      roots: input.roots,
      sourceExtensions: input.sourceExtensions,
      ignore: input.ignore,
    }) ??
    collectParsedSourceFiles({
      repoRoot: input.repoRoot,
      roots: input.roots,
      sourceExtensions: input.sourceExtensions,
      ignore: input.ignore,
    });
  return analyzeParsedEnvDefineSources(parsedSources, input.matrix);
}

export function analyzeEnvDefineSource(
  filePath: string,
  source: string,
  matrix: EnvDefineMatrix,
): EnvDefineInventory {
  return analyzeParsedEnvDefineSource(
    {
      filePath: toPosix(filePath),
      source,
      sourceFile: ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(filePath),
      ),
    },
    matrix,
  );
}

export function analyzeEnvDefineSources(
  sources: readonly EnvDefineSourceInput[],
  matrix: EnvDefineMatrix,
): EnvDefineInventory {
  const inventories = sources.map((source) =>
    analyzeEnvDefineSource(source.filePath, source.source, matrix),
  );
  return sortInventory(combineInventories(inventories));
}

function analyzeParsedEnvDefineSources(
  sources: readonly ParsedSourceFile[],
  matrix: EnvDefineMatrix,
): EnvDefineInventory {
  const inventories = sources.map((source) =>
    analyzeParsedEnvDefineSource({ ...source, filePath: toPosix(source.filePath) }, matrix),
  );
  return sortInventory(combineInventories(inventories));
}

function analyzeParsedEnvDefineSource(
  source: ParsedSourceFile,
  matrix: EnvDefineMatrix,
): EnvDefineInventory {
  const reads: EnvDefineReadEvidence[] = [];
  const conditions: EnvDefineConditionEvidence[] = [];
  const visit = (node: ts.Node): void => {
    const read = readEvidenceFromNode(source.filePath, source.sourceFile, node, matrix);
    if (read !== null) reads.push(read);

    const condition = conditionExpression(node);
    if (condition !== null) {
      const conditionReads = collectReadsInExpression(condition, source.sourceFile, matrix);
      if (conditionReads.length > 0) {
        conditions.push({
          filePath: source.filePath,
          text: condition.getText(source.sourceFile),
          ...rangeFor(condition, source.sourceFile),
          reads: conditionReads,
          predictedBranch: predictedBranchFor(condition, source.sourceFile, matrix),
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source.sourceFile);
  return { reads, conditions };
}

function conditionExpression(node: ts.Node): ts.Expression | null {
  if (ts.isIfStatement(node)) return node.expression;
  if (ts.isConditionalExpression(node)) return node.condition;
  if (ts.isWhileStatement(node)) return node.expression;
  if (ts.isDoStatement(node)) return node.expression;
  if (ts.isForStatement(node)) return node.condition ?? null;
  return null;
}

function combineInventories(inventories: readonly EnvDefineInventory[]): EnvDefineInventory {
  return {
    reads: inventories.flatMap((inventory) => inventory.reads),
    conditions: inventories.flatMap((inventory) => inventory.conditions),
  };
}

function sortInventory(inventory: EnvDefineInventory): EnvDefineInventory {
  return {
    reads: [...inventory.reads].sort(compareEvidence),
    conditions: [...inventory.conditions].sort(compareEvidence),
  };
}

function compareEvidence(
  left: EnvDefineReadEvidence | EnvDefineConditionEvidence,
  right: EnvDefineReadEvidence | EnvDefineConditionEvidence,
): number {
  return (
    left.filePath.localeCompare(right.filePath, "en") ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    left.text.localeCompare(right.text, "en")
  );
}
