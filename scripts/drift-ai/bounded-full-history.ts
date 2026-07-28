// Bounded full-history collector for prototype archaeology lenses. Windowed
// hotspots/coldspots history stays in hotspots-history.ts; this helper is for
// lenses that need old-history evidence but must disclose caps and truncation.

import { execFileSync } from "node:child_process";

import { errorMessage } from "../lib/error-message.js";
import {
  type BoundedHistoryUnexaminedCount,
  FULL_HISTORY_RENAME_CAVEAT,
  prototypeCaps,
  unexaminedCounts,
} from "./bounded-full-history-disclosure.js";
import { outputCapErrorMessage, timeoutErrorMessage } from "./command-error-classification.js";
import { DEFAULT_DRIFT_AI_CONFIG, type DriftAiIgnoreConfig } from "./config.js";
import type { GitRunner } from "./git-changed-scope.js";
import { buildGitLogWalkArgs } from "./hotspots-git-log.js";
import {
  type CommitRecord,
  filterGitLogRecords,
  isPartialClone,
  parseGitLog,
} from "./hotspots-history.js";
import type { PrototypeCap } from "./prototype-advisory.js";

const FULL_HISTORY_MAX_BUFFER_BYTES = 512 * 1024 * 1024;

const DEFAULT_FULL_HISTORY_MAX_COMMITS = 5_000;
const DEFAULT_FULL_HISTORY_MAX_FILES = 20_000;
const DEFAULT_FULL_HISTORY_TIMEOUT_MS = 30_000;

export type BoundedHistoryGitRunner = (
  args: readonly string[],
  options?: { readonly maxOutputBytes?: number; readonly timeoutMs?: number },
) => string;

export function defaultBoundedHistoryGitRunner(repoRoot: string): BoundedHistoryGitRunner {
  return (args, options) =>
    execFileSync("git", [...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: options?.maxOutputBytes ?? FULL_HISTORY_MAX_BUFFER_BYTES,
      timeout: options?.timeoutMs,
    });
}

export type BoundedHistoryStopReason =
  | "completed"
  | "max-commits"
  | "max-files"
  | "max-output"
  | "since"
  | "timeout"
  | "git-error";

export type BoundedFullHistoryOptions = {
  readonly git: BoundedHistoryGitRunner;
  readonly since?: string;
  readonly maxCommits?: number;
  readonly maxFiles?: number;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
  readonly ignore?: DriftAiIgnoreConfig;
  readonly nowMs?: () => number;
};

export type BoundedHistoryRequestedCaps = {
  readonly since: string | null;
  readonly maxCommits: number;
  readonly maxFiles: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
};

type BoundedHistoryScannedRange = {
  readonly since: string | null;
  readonly newestCommitHash: string | null;
  readonly newestCommitDate: string | null;
  readonly oldestCommitHash: string | null;
  readonly oldestCommitDate: string | null;
};

export type BoundedFullHistory = {
  readonly records: readonly CommitRecord[];
  readonly commitCount: number;
  readonly distinctFileCount: number;
  readonly requestedCaps: BoundedHistoryRequestedCaps;
  readonly scannedRange: BoundedHistoryScannedRange;
  readonly partial: boolean;
  readonly stoppedReason: BoundedHistoryStopReason;
  readonly moreCommitsObserved: boolean;
  readonly moreHistoryMayExist: boolean;
  readonly unexamined: {
    readonly commits: BoundedHistoryUnexaminedCount;
    readonly files: BoundedHistoryUnexaminedCount;
  };
  readonly linesAvailable: boolean;
  readonly elapsedMs: number;
  readonly renameCaveat: string;
  readonly degradations: readonly string[];
  readonly prototypeCaps: readonly PrototypeCap[];
  readonly gitError: string | null;
};

export function collectBoundedFullHistory(options: BoundedFullHistoryOptions): BoundedFullHistory {
  const requestedCaps = normalizeCaps(options);
  const nowMs = options.nowMs ?? Date.now;
  const lineMode = resolveLineMode(options.git);
  const gitLog = runHistoryGitLog(options.git, requestedCaps, lineMode.linesAvailable, nowMs);

  const parsed =
    gitLog.output.length === 0
      ? []
      : parseGitLog(gitLog.output, { numstat: lineMode.linesAvailable });
  const recordsForCaps = filterGitLogRecords(
    parsed,
    options.ignore ?? DEFAULT_DRIFT_AI_CONFIG.ignore,
  );
  const limited = applyCountCaps(recordsForCaps, requestedCaps);
  const stoppedReason = resolveStoppedReason(
    gitLog.stoppedReason,
    limited.stoppedReason,
    requestedCaps,
  );

  const partial = stoppedReason !== "completed";
  const resultCore = {
    records: limited.records,
    commitCount: limited.records.length,
    distinctFileCount: limited.distinctFileCount,
    requestedCaps,
    scannedRange: scannedRange(requestedCaps.since, limited.records),
    partial,
    stoppedReason,
    moreCommitsObserved: limited.moreCommitsObserved,
    moreHistoryMayExist: partial,
    unexamined: unexaminedCounts(stoppedReason, requestedCaps, gitLog.elapsedMs),
    linesAvailable: lineMode.linesAvailable,
    elapsedMs: gitLog.elapsedMs,
    renameCaveat: FULL_HISTORY_RENAME_CAVEAT,
    degradations: collectDegradations(lineMode.degradations, gitLog.gitError),
    gitError: gitLog.gitError,
  };
  return { ...resultCore, prototypeCaps: prototypeCaps(resultCore) };
}

function normalizeCaps(options: BoundedFullHistoryOptions): BoundedHistoryRequestedCaps {
  return {
    since: options.since ?? null,
    maxCommits: positiveInteger(options.maxCommits, DEFAULT_FULL_HISTORY_MAX_COMMITS),
    maxFiles: positiveInteger(options.maxFiles, DEFAULT_FULL_HISTORY_MAX_FILES),
    maxOutputBytes: positiveInteger(options.maxOutputBytes, FULL_HISTORY_MAX_BUFFER_BYTES),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_FULL_HISTORY_TIMEOUT_MS),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

type LineMode = {
  readonly linesAvailable: boolean;
  readonly degradations: readonly string[];
};

function resolveLineMode(git: BoundedHistoryGitRunner): LineMode {
  const configGit: GitRunner = (args) => git(args);
  const linesAvailable = !isPartialClone(configGit);
  if (linesAvailable) return { linesAvailable, degradations: [] };
  return {
    linesAvailable,
    degradations: [
      "line metrics unavailable on a blobless partial clone; used git log --name-only to avoid fetching blobs",
    ],
  };
}

type GitLogRun = {
  readonly output: string;
  readonly elapsedMs: number;
  readonly stoppedReason: "completed" | "max-output" | "timeout" | "git-error";
  readonly gitError: string | null;
};

function runHistoryGitLog(
  git: BoundedHistoryGitRunner,
  caps: BoundedHistoryRequestedCaps,
  linesAvailable: boolean,
  nowMs: () => number,
): GitLogRun {
  const startedMs = nowMs();
  let output = "";
  let gitError: string | null = null;
  let stoppedReason: GitLogRun["stoppedReason"] = "completed";
  try {
    output = git(buildFullHistoryArgs(caps, linesAvailable), {
      maxOutputBytes: caps.maxOutputBytes,
      timeoutMs: caps.timeoutMs,
    });
  } catch (error) {
    gitError = errorMessage(error);
    stoppedReason = stoppedReasonForGitError(gitError);
  }
  const elapsedMs = Math.max(0, nowMs() - startedMs);
  if (gitError === null && elapsedMs > caps.timeoutMs) stoppedReason = "timeout";
  return { output, elapsedMs, stoppedReason, gitError };
}

function resolveStoppedReason(
  gitReason: GitLogRun["stoppedReason"],
  countReason: CountCapResult["stoppedReason"],
  caps: BoundedHistoryRequestedCaps,
): BoundedHistoryStopReason {
  if (gitReason !== "completed") return gitReason;
  if (countReason !== "completed") return countReason;
  return caps.since === null ? "completed" : "since";
}

function collectDegradations(base: readonly string[], gitError: string | null): readonly string[] {
  if (gitError === null) return base;
  return [...base, `git log failed: ${gitError}`];
}

function buildFullHistoryArgs(
  caps: BoundedHistoryRequestedCaps,
  numstat: boolean,
): readonly string[] {
  return buildGitLogWalkArgs({
    since: caps.since,
    maxCount: caps.maxCommits + 1,
    numstat,
  });
}

type CountCapResult = {
  readonly records: readonly CommitRecord[];
  readonly distinctFileCount: number;
  readonly stoppedReason: "completed" | "max-commits" | "max-files";
  readonly moreCommitsObserved: boolean;
};

function applyCountCaps(
  records: readonly CommitRecord[],
  caps: BoundedHistoryRequestedCaps,
): CountCapResult {
  const taken: CommitRecord[] = [];
  const seenPaths = new Set<string>();

  for (const record of records) {
    if (taken.length >= caps.maxCommits) {
      return {
        records: taken,
        distinctFileCount: seenPaths.size,
        stoppedReason: "max-commits",
        moreCommitsObserved: true,
      };
    }

    const newPaths = distinctNewPaths(record, seenPaths);
    if (seenPaths.size + newPaths.length > caps.maxFiles) {
      return {
        records: taken,
        distinctFileCount: seenPaths.size,
        stoppedReason: "max-files",
        moreCommitsObserved: true,
      };
    }

    taken.push(record);
    for (const path of newPaths) seenPaths.add(path);
  }

  return {
    records: taken,
    distinctFileCount: seenPaths.size,
    stoppedReason: "completed",
    moreCommitsObserved: false,
  };
}

function distinctNewPaths(record: CommitRecord, seenPaths: ReadonlySet<string>): string[] {
  const newPaths: string[] = [];
  const local = new Set<string>();
  for (const file of record.files) {
    if (seenPaths.has(file.path) || local.has(file.path)) continue;
    local.add(file.path);
    newPaths.push(file.path);
  }
  return newPaths;
}

function scannedRange(
  since: string | null,
  records: readonly CommitRecord[],
): BoundedHistoryScannedRange {
  const newest = firstRecord(records);
  const oldest = lastRecord(records);
  return {
    since,
    newestCommitHash: newest?.hash ?? null,
    newestCommitDate: newest?.authorDate ?? null,
    oldestCommitHash: oldest?.hash ?? null,
    oldestCommitDate: oldest?.authorDate ?? null,
  };
}

function firstRecord(records: readonly CommitRecord[]): CommitRecord | null {
  return records[0] ?? null;
}

function lastRecord(records: readonly CommitRecord[]): CommitRecord | null {
  if (records.length === 0) return null;
  return records[records.length - 1] ?? null;
}

function stoppedReasonForGitError(message: string): GitLogRun["stoppedReason"] {
  if (timeoutErrorMessage(message)) return "timeout";
  if (outputCapErrorMessage(message)) return "max-output";
  return "git-error";
}
