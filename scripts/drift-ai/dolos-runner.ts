// Dolos subprocess harness for prototype clone-candidate work. This module keeps
// Dolos optional and tempdir-bound: missing binaries are a clean absence, target
// repos are not written to, and no CLI/report surface is registered here.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isRecord } from "../lib/records.js";
import { parseDolosCsvReport, parseDolosVersionOutput } from "./dolos-output.js";
import {
  type DefaultDolosRunnerOptions,
  type DolosCommandSource,
  type DolosRunner,
  type DolosRunnerCaps,
  type DolosRunnerInput,
  type DolosRunnerResult,
  type DolosRunnerTruncation,
  type DolosSpawn,
  type DolosSpawnResult,
  type DolosToolInfo,
} from "./dolos-runner-types.js";
import { DOLOS_TOOL, type DolosReportFiles } from "./dolos-types.js";
import { collectNearDuplicateSourceFiles } from "./near-duplicates-runner.js";
import { toPosix } from "./path-util.js";
import { sourceLineCount } from "./ts-source-util.js";

export const DEFAULT_DOLOS_TIMEOUT_MS = 10 * 60 * 1000;

// Timeout kills arrive with this signal (spawnSync killSignal below); the
// errorMessage fallback in isTimeoutResult checks the same signal so the two cannot
// drift apart and leave the fallback dead.
const TIMEOUT_KILL_SIGNAL = "SIGKILL";
export type {
  DefaultDolosRunnerOptions,
  DolosRunner,
  DolosRunnerCaps,
  DolosRunnerInput,
  DolosRunnerResult,
  DolosSpawn,
  DolosSpawnResult,
} from "./dolos-runner-types.js";
import { errorMessage } from "../lib/error-message.js";

export function defaultDolosRunner(options: DefaultDolosRunnerOptions = {}): DolosRunner {
  const command = options.command ?? DOLOS_TOOL;
  const source: DolosCommandSource = options.command === undefined ? "path" : "override";
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOLOS_TIMEOUT_MS;
  const spawn = options.spawn ?? spawnSync;
  const readReportFiles = options.readReportFiles ?? readDolosReportFiles;
  return (input) => runDolos(input, { command, readReportFiles, source, spawn, timeoutMs });
}

function runDolos(
  input: DolosRunnerInput,
  options: {
    readonly command: string;
    readonly source: DolosCommandSource;
    readonly timeoutMs: number;
    readonly spawn: DolosSpawn;
    readonly readReportFiles: (outputDir: string) => DolosReportFiles;
  },
): DolosRunnerResult {
  const caps = runnerCaps(input, options.timeoutMs);
  const inventory = collectNearDuplicateSourceFiles(input);
  const consideredFiles = inventory.slice(0, input.maxFiles);
  const truncation = fileTruncation(inventory.length, consideredFiles.length);
  const detected = detectDolosTool(options, input.repoRoot);
  if (!detected.ok) return { ...detected, caps, truncation };
  const tool = detected.tool;
  if (consideredFiles.length < 2) {
    return emptySuccess(input, caps, truncation, tool);
  }
  const outputRoot = mkdtempSync(path.join(tmpdir(), "drift-ai-dolos-"));
  const outputDir = path.join(outputRoot, "report");
  try {
    const result = options.spawn(
      options.command,
      dolosRunArgs(input, outputDir, consideredFiles),
      spawnOptions(input.repoRoot, options.timeoutMs),
    );
    const failed = failedRun(result, options.timeoutMs, tool);
    if (failed !== null) return { ...failed, caps, truncation };
    const parsed = parseDolosCsvReport(options.readReportFiles(outputDir), {
      engineVersion: tool.version,
      fileLineCounts: lineCounts(input.repoRoot, consideredFiles),
      languageMode: input.languageMode,
      maxCandidatePairs: input.maxCandidatePairs,
      maxReportedPairs: input.maxReportedPairs,
      threshold: input.threshold,
    });
    return {
      ok: true,
      tool,
      metadata: parsed.metadata,
      candidates: parsed.candidates,
      caps,
      truncation: { ...truncation, ...parsed.truncation },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "run-failed",
      error: `dolos report could not be read: ${errorMessage(err)}`,
      tool,
      caps,
      truncation,
    };
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

function detectDolosTool(
  options: {
    readonly command: string;
    readonly source: DolosCommandSource;
    readonly timeoutMs: number;
    readonly spawn: DolosSpawn;
  },
  repoRoot: string,
):
  | { readonly ok: true; readonly tool: DolosToolInfo }
  | {
      readonly ok: false;
      readonly reason: "timeout" | "tool-unavailable";
      readonly error: string;
      readonly tool: DolosToolInfo;
    } {
  const tool = { command: options.command, source: options.source };
  const result = options.spawn(
    options.command,
    ["--version"],
    spawnOptions(repoRoot, options.timeoutMs),
  );
  if (result.error) {
    if (isTimeoutResult(result)) {
      return { ok: false, reason: "timeout", error: `timeout of ${options.timeoutMs}ms`, tool };
    }
    return { ok: false, reason: "tool-unavailable", error: result.error.message, tool };
  }
  const version = parseDolosVersionOutput(`${result.stdout}\n${result.stderr}`);
  return {
    ok: true,
    tool: {
      command: options.command,
      source: options.source,
      ...(version === undefined ? {} : { version }),
    },
  };
}

function failedRun(
  result: DolosSpawnResult,
  timeoutMs: number,
  tool: DolosToolInfo,
): {
  readonly ok: false;
  readonly reason: "run-failed" | "timeout" | "tool-unavailable";
  readonly error: string;
  readonly tool: DolosToolInfo;
} | null {
  if (result.error) {
    if (isTimeoutResult(result)) {
      return { ok: false, reason: "timeout", error: `timeout of ${timeoutMs}ms`, tool };
    }
    if (isUnavailableResult(result)) {
      return { ok: false, reason: "tool-unavailable", error: result.error.message, tool };
    }
    return { ok: false, reason: "run-failed", error: result.error.message, tool };
  }
  if (result.status === 0) return null;
  const status = result.status === null ? "unknown" : String(result.status);
  const stderr = result.stderr.trim();
  return {
    ok: false,
    reason: "run-failed",
    error: stderr.length > 0 ? `dolos exited ${status}: ${stderr}` : `dolos exited ${status}`,
    tool,
  };
}

function dolosRunArgs(
  input: DolosRunnerInput,
  outputDir: string,
  files: readonly string[],
): string[] {
  return [
    "run",
    "-f",
    "csv",
    "-o",
    outputDir,
    "-l",
    input.languageMode,
    "-S",
    String(input.threshold),
    "-L",
    String(input.maxCandidatePairs),
    "--sort-by",
    "similarity",
    ...files,
  ];
}

function spawnOptions(cwd: string, timeoutMs: number): SpawnSyncOptionsWithStringEncoding {
  return {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    killSignal: TIMEOUT_KILL_SIGNAL,
  };
}

function readDolosReportFiles(outputDir: string): DolosReportFiles {
  return {
    pairsCsv: readFileSync(path.join(outputDir, "pairs.csv"), "utf8"),
    ...readOptionalCsv(outputDir, "files.csv", "filesCsv"),
    ...readOptionalCsv(outputDir, "metadata.csv", "metadataCsv"),
  };
}

function readOptionalCsv(
  outputDir: string,
  filename: string,
  key: "filesCsv" | "metadataCsv",
): Pick<DolosReportFiles, "filesCsv" | "metadataCsv"> {
  const filePath = path.join(outputDir, filename);
  if (!existsSync(filePath)) return {};
  return { [key]: readFileSync(filePath, "utf8") };
}

function lineCounts(repoRoot: string, files: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    try {
      counts.set(toPosix(file), sourceLineCount(readFileSync(path.join(repoRoot, file), "utf8")));
    } catch {
      // files.csv usually carries content; missing source fallback stays disclosed
      // by the parser as a one-line full-file range.
    }
  }
  return counts;
}

function emptySuccess(
  input: DolosRunnerInput,
  caps: DolosRunnerCaps,
  truncation: Pick<DolosRunnerTruncation, "consideredFiles" | "eligibleFiles" | "filesTruncated">,
  tool: DolosToolInfo,
): DolosRunnerResult {
  return {
    ok: true,
    tool,
    metadata: { engine: DOLOS_TOOL, languageMode: input.languageMode, threshold: input.threshold },
    candidates: [],
    caps,
    truncation: {
      ...truncation,
      parsedPairs: 0,
      candidatePairsTruncated: false,
      reportedPairsTruncated: false,
      missingFileRanges: [],
    },
  };
}

function runnerCaps(input: DolosRunnerInput, timeoutMs: number): DolosRunnerCaps {
  return {
    timeoutMs,
    maxFiles: input.maxFiles,
    maxCandidatePairs: input.maxCandidatePairs,
    maxReportedPairs: input.maxReportedPairs,
  };
}

function fileTruncation(
  eligibleFiles: number,
  consideredFiles: number,
): Pick<DolosRunnerTruncation, "consideredFiles" | "eligibleFiles" | "filesTruncated"> {
  return {
    eligibleFiles,
    consideredFiles,
    filesTruncated: eligibleFiles > consideredFiles,
  };
}

function isTimeoutResult(result: DolosSpawnResult): boolean {
  if (hasErrorCode(result.error, "ETIMEDOUT")) return true;
  if (result.signal !== TIMEOUT_KILL_SIGNAL || result.error === undefined) return false;
  return /\b(?:ETIMEDOUT|timed out|timeout)\b/iu.test(result.error.message);
}

function isUnavailableResult(result: DolosSpawnResult): boolean {
  return hasErrorCode(result.error, "ENOENT") || result.error?.message.includes("ENOENT") === true;
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return isRecord(error) && error["code"] === expectedCode;
}
