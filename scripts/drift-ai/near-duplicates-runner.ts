// I/O seam for near-duplicate analysis. The default path uses ts-morph's bundled
// TypeScript parser directly; the optional similarity-ts path shells out only
// when the operator selects that Rust binary and it is present on PATH.

import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { DriftAiIgnoreConfig } from "./config.js";
import { matchesAnyGlob } from "./config-match.js";
import {
  buildNearDuplicatePair,
  extractNearDuplicateFunctions,
  NEAR_DUPLICATE_TOOL,
  type NearDuplicateEngine,
  type NearDuplicateFunction,
  type NearDuplicateFunctionRef,
  type NearDuplicatePair,
  SIMILARITY_TS_TOOL,
  sortNearDuplicatePairs,
} from "./near-duplicates.js";
import { toPosix } from "./path-util.js";
import { walkSourceFiles } from "./source-walk.js";

// The subprocess seam for the optional similarity-ts engine. The return is
// narrowed to the fields runSimilarityTs reads so a test fake need not construct
// a full SpawnSyncReturns; node's real spawnSync stays directly assignable.
export type SimilarityTsSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "error" | "status" | "stdout" | "stderr"
>;

export type SimilarityTsSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SimilarityTsSpawnResult;

export type NearDuplicateRunnerInput = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
  readonly excludeGlobs: readonly string[];
  readonly engine: NearDuplicateEngine;
  readonly minLines: number;
  readonly minTokens: number;
  readonly similarityThreshold: number;
};

export type NearDuplicateSourceInventoryInput = Pick<
  NearDuplicateRunnerInput,
  "excludeGlobs" | "ignore" | "repoRoot" | "roots" | "sourceExtensions"
>;

export type NearDuplicateRunnerResult =
  | {
      readonly ok: true;
      readonly engine: typeof NEAR_DUPLICATE_TOOL;
      readonly functions: readonly NearDuplicateFunction[];
    }
  | {
      readonly ok: true;
      readonly engine: typeof SIMILARITY_TS_TOOL;
      readonly pairs: readonly NearDuplicatePair[];
    }
  | {
      readonly ok: false;
      readonly reason: "tool-unavailable" | "run-failed";
      readonly error: string;
    };

export type NearDuplicateRunner = (input: NearDuplicateRunnerInput) => NearDuplicateRunnerResult;

export type DefaultNearDuplicateRunnerOptions = {
  // Injectable subprocess seam (defaults to node's spawnSync) so tests can assert
  // exactly which files reach similarity-ts without installing the Rust binary.
  readonly spawn?: SimilarityTsSpawn;
};

export function defaultNearDuplicateRunner(
  options: DefaultNearDuplicateRunnerOptions = {},
): NearDuplicateRunner {
  const spawn = options.spawn ?? spawnSync;
  return (input) =>
    input.engine === SIMILARITY_TS_TOOL
      ? runSimilarityTs(input, SIMILARITY_TS_TOOL, spawn)
      : runTsMorph(input);
}

// The single source-file inventory both engines analyze. Sharing this walk keeps
// similarity-ts and ts-morph from silently scanning different file sets: the
// drift ignore config, excludeGlobs, sourceExtensions, and .d.ts exclusion are
// all applied here once.
export function collectNearDuplicateSourceFiles(
  input: NearDuplicateSourceInventoryInput,
): string[] {
  return walkSourceFiles({
    repoRoot: input.repoRoot,
    roots: input.roots,
    sourceExtensions: input.sourceExtensions,
    ignore: input.ignore,
    accept: (repoRelativePath) => !matchesAnyGlob(repoRelativePath, input.excludeGlobs),
  });
}

function runTsMorph(input: NearDuplicateRunnerInput): NearDuplicateRunnerResult {
  try {
    const functions = collectNearDuplicateSourceFiles(input).flatMap((filePath) =>
      extractNearDuplicateFunctions(
        filePath,
        readFileSync(path.join(input.repoRoot, filePath), "utf8"),
      ),
    );
    return { ok: true, engine: NEAR_DUPLICATE_TOOL, functions };
  } catch (err) {
    return { ok: false, reason: "run-failed", error: errorMessage(err) };
  }
}

function runSimilarityTs(
  input: NearDuplicateRunnerInput,
  binPath: string,
  spawn: SimilarityTsSpawn,
): NearDuplicateRunnerResult {
  // Pass the same filtered inventory the ts-morph engine sees as explicit
  // positional paths, rather than the raw roots: similarity-ts then never reaches
  // ignored, excluded, unsupported-extension, or .d.ts files. With no eligible
  // files there is nothing to compare — short-circuit instead of spawning, which
  // would let similarity-ts fall back to scanning the whole cwd.
  const files = collectNearDuplicateSourceFiles(input);
  if (files.length === 0) return { ok: true, engine: SIMILARITY_TS_TOOL, pairs: [] };
  const result = spawn(binPath, similarityTsArgs(input, files), {
    cwd: input.repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    const message = result.error.message;
    return {
      ok: false,
      reason: message.includes("ENOENT") ? "tool-unavailable" : "run-failed",
      error: message,
    };
  }
  const pairs = parseSimilarityTsOutput(result.stdout);
  if (result.status === 0 || pairs.length > 0) {
    return { ok: true, engine: SIMILARITY_TS_TOOL, pairs };
  }
  return {
    ok: false,
    reason: "run-failed",
    error: stderrMessage(result.status, result.stderr),
  };
}

function similarityTsArgs(input: NearDuplicateRunnerInput, files: readonly string[]): string[] {
  return [
    ...files,
    "--threshold",
    String(input.similarityThreshold),
    "--min-lines",
    String(input.minLines),
    "--min-tokens",
    String(input.minTokens),
    "--cross-file",
  ];
}

function parseSimilarityTsOutput(output: string): NearDuplicatePair[] {
  const pairs: NearDuplicatePair[] = [];
  let pending: {
    readonly left: NearDuplicateFunctionRef;
    readonly right: NearDuplicateFunctionRef;
  } | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const parsedPair = parseSimilarityPairLine(line);
    if (parsedPair !== null) {
      pending = parsedPair;
      continue;
    }
    const similarity = parseSimilarityScoreLine(line);
    if (similarity !== null && pending !== null) {
      pairs.push(buildNearDuplicatePair(pending.left, pending.right, similarity));
      pending = null;
    }
  }
  return sortNearDuplicatePairs(pairs);
}

function parseSimilarityPairLine(
  line: string,
): { readonly left: NearDuplicateFunctionRef; readonly right: NearDuplicateFunctionRef } | null {
  const [leftRaw, rightRaw] = splitPairLine(line);
  if (leftRaw === undefined || rightRaw === undefined) return null;
  const left = parseSimilaritySide(leftRaw);
  const right = parseSimilaritySide(rightRaw);
  if (left === null || right === null) return null;
  return {
    left,
    right,
  };
}

function splitPairLine(line: string): readonly [string | undefined, string | undefined] {
  const marker = " <-> ";
  const index = line.indexOf(marker);
  if (index < 0) return [undefined, undefined];
  return [line.slice(0, index).trim(), line.slice(index + marker.length).trim()];
}

function parseSimilaritySide(raw: string): NearDuplicateFunctionRef | null {
  const colon = raw.lastIndexOf(":");
  if (colon < 0) return null;
  const filePath = raw.slice(0, colon);
  const afterColon = raw.slice(colon + 1).trim();
  const firstSpace = afterColon.indexOf(" ");
  if (firstSpace < 0) return null;
  const range = afterColon.slice(0, firstSpace);
  const dash = range.indexOf("-");
  if (dash < 0) return null;
  const startLine = Number.parseInt(range.slice(0, dash), 10);
  const endLine = Number.parseInt(range.slice(dash + 1), 10);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
  return similarityRef(filePath, startLine, endLine, afterColon.slice(firstSpace + 1));
}

function parseSimilarityScoreLine(line: string): number | null {
  const prefix = "Similarity:";
  const trimmed = line.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const percentIndex = trimmed.indexOf("%", prefix.length);
  if (percentIndex < 0) return null;
  const value = Number.parseFloat(trimmed.slice(prefix.length, percentIndex).trim());
  if (!Number.isFinite(value)) return null;
  return value / 100;
}

function similarityRef(
  filePath: string,
  startLine: number,
  endLine: number,
  name: string,
): NearDuplicateFunctionRef {
  return {
    filePath: toPosix(filePath),
    name: name.trim(),
    startLine,
    endLine,
    lineCount: endLine - startLine + 1,
    tokenCount: 0,
  };
}

function stderrMessage(status: number | null, stderr: string): string {
  const code = status === null ? "unknown" : String(status);
  const detail = stderr.trim();
  return detail.length > 0
    ? `similarity-ts exited ${code}: ${detail}`
    : `similarity-ts exited ${code}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
