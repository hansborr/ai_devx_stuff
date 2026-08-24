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

import { errorMessage } from "../lib/error-message.js";
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
import { isExactCloneFileEligible } from "./near-duplicates-exact-config.js";
import { toPosix } from "./path-util.js";
import { walkSourceFiles } from "./source-walk.js";

const SIMILARITY_TS_SUPPORTED_RELEASE = "0.5.0";
const SIMILARITY_TS_OUTPUT_DIAGNOSTIC_LIMIT = 160;
const SIMILARITY_TS_RESULT_RULE = "-".repeat(60);
const SIMILARITY_TS_NO_SOURCE_FILES_SENTINEL =
  "No TypeScript/JavaScript files found in the specified paths.";

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

type NearDuplicateRunnerInput = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
  readonly excludeGlobs: readonly string[];
  readonly engine: NearDuplicateEngine;
  readonly minLines: number;
  readonly minTokens: number;
  readonly similarityThreshold: number;
  readonly includeExactTokens: boolean;
};

export type NearDuplicateSourceInventoryInput = Pick<
  NearDuplicateRunnerInput,
  "excludeGlobs" | "ignore" | "repoRoot" | "roots" | "sourceExtensions"
>;

type NearDuplicateRunnerResult =
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
    const functions = collectNearDuplicateSourceFiles(input).flatMap((filePath) => {
      const includeExactTokens = input.includeExactTokens && isExactCloneFileEligible(filePath);
      return extractNearDuplicateFunctions(
        filePath,
        readFileSync(path.join(input.repoRoot, filePath), "utf8"),
        { includeExactTokens },
      );
    });
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
  const parsed = parseSimilarityTsOutput(result.stdout);
  if (parsed.kind === "pairs") {
    return { ok: true, engine: SIMILARITY_TS_TOOL, pairs: parsed.pairs };
  }
  if (result.status === 0 && parsed.kind === "zero-pairs") {
    return { ok: true, engine: SIMILARITY_TS_TOOL, pairs: [] };
  }
  if (result.status === 0) {
    return {
      ok: false,
      reason: "run-failed",
      error: unsupportedSimilarityTsOutput(result.stdout),
    };
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
    "--min-tokens",
    String(input.minTokens),
    "--no-types",
  ];
}

type SimilarityTsOutput =
  | { readonly kind: "pairs"; readonly pairs: readonly NearDuplicatePair[] }
  | { readonly kind: "zero-pairs" }
  | { readonly kind: "unsupported" };

// similarity-ts 0.5.0 prints fixed run/function headers followed by either a
// no-source-files sentinel, or a checking header and its zero-pair sentinel or
// declared count and score-first three-line records.
// Blank separator lines are presentation-only; every non-blank line must be
// consumed so output drift cannot certify a clean scan merely because the
// process still exits zero.
function parseSimilarityTsOutput(output: string): SimilarityTsOutput {
  const lines = output.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (isSimilarityTsNoSourceFilesOutput(lines)) return { kind: "zero-pairs" };
  const body = similarityTsProtocolBody(lines);
  if (body === null) return { kind: "unsupported" };
  if (isSimilarityTsZeroPairSentinel(body[0] ?? "")) {
    return body.length === 1 ? { kind: "zero-pairs" } : { kind: "unsupported" };
  }
  return parseSimilarityTsPairOutput(body);
}

function similarityTsProtocolBody(lines: readonly string[]): readonly string[] | null {
  if (
    lines[0] !== "Analyzing code similarity..." ||
    lines[1] !== "=== Function Similarity ===" ||
    !/^Checking [1-9]\d* files for duplicates\.\.\.$/u.test(lines[2] ?? "")
  ) {
    return null;
  }
  return lines.slice(3);
}

function isSimilarityTsNoSourceFilesOutput(lines: readonly string[]): boolean {
  return (
    lines.length === 3 &&
    lines[0] === "Analyzing code similarity..." &&
    lines[1] === "=== Function Similarity ===" &&
    lines[2] === SIMILARITY_TS_NO_SOURCE_FILES_SENTINEL
  );
}

function parseSimilarityTsPairOutput(body: readonly string[]): SimilarityTsOutput {
  const expectedPairCount = parseSimilarityTsPairCount(body[0]);
  if (expectedPairCount === null) return { kind: "unsupported" };
  if (body[1] !== SIMILARITY_TS_RESULT_RULE) return { kind: "unsupported" };
  const pairs: NearDuplicatePair[] = [];
  for (let index = 2; index < body.length; index += 3) {
    const pair = parseSimilarityTsPairRecord(body, index);
    if (pair === null) return { kind: "unsupported" };
    pairs.push(pair);
  }
  if (pairs.length !== expectedPairCount) return { kind: "unsupported" };
  return { kind: "pairs", pairs: sortNearDuplicatePairs(pairs) };
}

function parseSimilarityTsPairCount(line: string | undefined): number | null {
  if (line === undefined) return null;
  const match = line.match(/^Found ([1-9]\d*) duplicate pairs:$/u);
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

function parseSimilarityTsPairRecord(
  lines: readonly string[],
  index: number,
): NearDuplicatePair | null {
  const similarity = parseSimilarityScoreLine(lines[index]);
  const left = parseSimilarityFunctionLine(lines[index + 1]);
  const right = parseSimilarityFunctionLine(lines[index + 2]);
  if (similarity === null || left === null || right === null) return null;
  return buildNearDuplicatePair(left, right, similarity);
}

function isSimilarityTsZeroPairSentinel(line: string): boolean {
  return line === "No duplicate functions found!";
}

function parseSimilarityFunctionLine(line: string | undefined): NearDuplicateFunctionRef | null {
  if (line === undefined || !line.startsWith("  ") || line.startsWith("   ")) return null;
  return parseSimilaritySide(line.slice(2));
}

function parseSimilaritySide(raw: string): NearDuplicateFunctionRef | null {
  const colon = raw.lastIndexOf(":");
  if (colon < 0) return null;
  const filePath = raw.slice(0, colon);
  const afterColon = raw.slice(colon + 1).trim();
  const match = afterColon.match(/^(\d+)-(\d+) (.+)$/u);
  if (match === null) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
  return similarityRef(filePath, startLine, endLine, match[3] ?? "");
}

function parseSimilarityScoreLine(line: string | undefined): number | null {
  if (line === undefined) return null;
  const match = line.match(
    /^Similarity: (\d+(?:\.\d+)?)%, Score: \d+(?:\.\d+)? points \(lines \d+~\d+, avg: \d+(?:\.\d+)?\)$/u,
  );
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value / 100;
}

function unsupportedSimilarityTsOutput(output: string): string {
  const singleLine = output.replace(/\s+/gu, " ").trim();
  const excerpt =
    singleLine.length > SIMILARITY_TS_OUTPUT_DIAGNOSTIC_LIMIT
      ? `${singleLine.slice(0, SIMILARITY_TS_OUTPUT_DIAGNOSTIC_LIMIT)}…`
      : singleLine;
  return `similarity-ts stdout did not match the similarity-ts ${SIMILARITY_TS_SUPPORTED_RELEASE} text protocol; expected complete score/function records or the zero-pair sentinel, received ${JSON.stringify(excerpt)}`;
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
    enclosingContext: "",
    startOffset: null,
    endOffset: null,
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
