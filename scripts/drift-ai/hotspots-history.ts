// Shared windowed git-history collector for the `hotspots` subcommand. Every
// hotspot lens (41/42: churn, co-change, thrash, fragmentation, suppression
// churn) is a different reduction over the SAME windowed commit walk — so we walk
// once here and reduce many. No lens math lives in this file.

import { execFileSync } from "node:child_process";

import { DEFAULT_DRIFT_AI_CONFIG, type DriftAiIgnoreConfig } from "./config.js";
import { type GitRunner, isIgnoredPath } from "./git-changed-scope.js";

// --- git-log format ---------------------------------------------------------
//
// These are git format ESCAPES (literal `%x..` text passed to `--format`); git
// expands them to control bytes in its OUTPUT. They must NOT be raw control
// bytes here — a raw NUL inside an argv string would truncate the argument in
// execFile. The parser below works on the expanded OUTPUT bytes (OUT_* below).
const FMT_RECORD = "%x00"; // NUL — commit-boundary marker (cannot occur in a path)
const FMT_FIELD = "%x1f"; // unit separator — between metadata fields
const FMT_COAUTHOR = "%x1d"; // group separator — joins multiple Co-authored-by values

// `git log` emits, per commit: the metadata line (NUL-prefixed), a blank line,
// then `added \t deleted \t path` numstat rows. --no-merges keeps merge commits
// from double-counting every churn signal. --no-renames is LOAD-BEARING FOR
// PARSER CORRECTNESS: with rename detection on, git emits arrow-form paths
// (`a/{old => new}/f.ts`, `{old => new}`) in the path column that corrupt the
// tab-split below. A future "follow renames across history" feature needs a real
// arrow-form parser, NOT a flag flip — do not remove --no-renames to get it.
export const GIT_LOG_FORMAT = `${FMT_RECORD}%H${FMT_FIELD}%an${FMT_FIELD}%ae${FMT_FIELD}%ad${FMT_FIELD}%cd${FMT_FIELD}%s${FMT_FIELD}%(trailers:key=Co-authored-by,valueonly,separator=${FMT_COAUTHOR})`;

// Expanded OUTPUT bytes the escapes above produce — used to PARSE git's output.
const OUT_RECORD = "\u0000"; // NUL
const OUT_FIELD = "\u001f"; // unit separator
const OUT_COAUTHOR = "\u001d"; // group separator

// The windowed numstat walk over a high-velocity repo easily exceeds execFile's
// 1 MB default buffer (OpenClaw's 14d numstat is several MB), so the default
// history runner raises maxBuffer. cwd = repoRoot keeps the walk anchored when
// drift:ai is invoked from a subdirectory of the target. Tests inject their own
// GitRunner fake and never hit this.
const HISTORY_MAX_BUFFER_BYTES = 512 * 1024 * 1024;

export function defaultHistoryGitRunner(repoRoot: string): GitRunner {
  return (args) =>
    execFileSync("git", [...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: HISTORY_MAX_BUFFER_BYTES,
    });
}

export const DEFAULT_WINDOW_DAYS = 14; // AI cadence: agents compress weeks of churn into days.
export const DEFAULT_MAX_WINDOW_DAYS = 180; // classic human-team hotspot horizon; widen cap.
export const DEFAULT_MIN_COMMITS = 30; // sparse-history widen floor.

// Squash detection: when almost every touched file appears once in-window, the
// `revisions` metric is lying (a squash-merge collapses a whole branch into one
// commit). Thresholds are conservative so a near-linear / merge-workflow repo
// (e.g. OpenClaw: 19 merges / 15,858 non-merge commits in 30d) does NOT trip it.
const SQUASH_SINGLE_REVISION_RATIO = 0.95;
const SQUASH_MIN_DISTINCT_FILES = 20;
const SQUASH_MIN_COMMITS = 20;

const WIDEN_LADDER_DAYS: readonly number[] = [30, 60, 90, 180];

export type ChurnMetric = "revisions" | "lines";

export type CommitFileChange = {
  readonly path: string;
  readonly added: number; // 0 for binary files (line counts unknown), still a real touch
  readonly deleted: number;
  readonly binary: boolean;
};

export type CommitRecord = {
  readonly hash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string; // ISO-strict (e.g. 2026-05-29T09:46:48-07:00)
  readonly committerDate: string;
  readonly subject: string;
  readonly coAuthors: readonly string[]; // Co-authored-by trailer values
  readonly files: readonly CommitFileChange[]; // already filtered through isIgnoredPath
};

export type CollectHistoryOptions = {
  readonly git: GitRunner;
  readonly windowDays?: number;
  readonly maxWindowDays?: number;
  readonly minCommits?: number;
  readonly ignore?: DriftAiIgnoreConfig;
};

export type CollectedHistory = {
  readonly records: readonly CommitRecord[];
  readonly commitCount: number; // non-merge commits in the effective window
  readonly requestedWindowDays: number;
  readonly effectiveWindowDays: number;
  readonly widened: boolean;
  readonly widenReason: string | null;
  readonly metric: ChurnMetric;
  readonly metricAutoSwitched: boolean;
  readonly squashReason: string | null;
  readonly singleRevisionRatio: number;
  // False on a blobless partial clone: `--numstat` needs blob content to count
  // lines (git would lazily fetch every blob and hang), so the walk falls back to
  // `--name-only` — revisions stay exact, but per-file line counts are unknown.
  readonly linesAvailable: boolean;
};

// Parse a `git log` walk (format = GIT_LOG_FORMAT) into typed records. Parse
// LINE-WISE, never by positional split of the whole blob: a NUL-prefixed line is
// a commit boundary, blank lines are skipped, everything else is a file row. In
// `--numstat` mode each row is `added \t deleted \t path`; in `--name-only` mode
// (blobless fallback) each row is a bare path with unknown line counts.
export function parseGitLog(output: string, options: { numstat?: boolean } = {}): CommitRecord[] {
  const parseRow = (options.numstat ?? true) ? parseNumstatRow : parseNameOnlyRow;
  const state: ParseState = { records: [], current: undefined };
  for (const rawLine of output.split("\n")) {
    applyLogLine(state, rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, parseRow);
  }
  if (state.current !== undefined) state.records.push(finalizeRecord(state.current));
  return state.records;
}

type ParseState = { records: CommitRecord[]; current: MutableRecord | undefined };
type RowParser = (line: string) => CommitFileChange | undefined;

function applyLogLine(state: ParseState, line: string, parseRow: RowParser): void {
  if (line.startsWith(OUT_RECORD)) {
    if (state.current !== undefined) state.records.push(finalizeRecord(state.current));
    state.current = startRecord(line.slice(OUT_RECORD.length));
    return;
  }
  // Blank lines and file rows before any commit boundary are skipped defensively.
  if (line.length === 0 || state.current === undefined) return;
  const change = parseRow(line);
  if (change !== undefined) state.current.files.push(change);
}

function parseNameOnlyRow(line: string): CommitFileChange {
  return { path: line, added: 0, deleted: 0, binary: false };
}

type MutableRecord = Omit<CommitRecord, "files"> & { files: CommitFileChange[] };

function startRecord(meta: string): MutableRecord {
  const [
    hash = "",
    authorName = "",
    authorEmail = "",
    authorDate = "",
    committerDate = "",
    subject = "",
    coAuthorField = "",
  ] = meta.split(OUT_FIELD);
  const coAuthors =
    coAuthorField.length === 0
      ? []
      : coAuthorField.split(OUT_COAUTHOR).filter((value) => value.length > 0);
  return {
    hash,
    authorName,
    authorEmail,
    authorDate,
    committerDate,
    subject,
    coAuthors,
    files: [],
  };
}

function finalizeRecord(record: MutableRecord): CommitRecord {
  return { ...record, files: record.files };
}

function parseNumstatRow(line: string): CommitFileChange | undefined {
  const firstTab = line.indexOf("\t");
  if (firstTab < 0) return undefined;
  const secondTab = line.indexOf("\t", firstTab + 1);
  if (secondTab < 0) return undefined;
  const addedRaw = line.slice(0, firstTab);
  const deletedRaw = line.slice(firstTab + 1, secondTab);
  const filePath = line.slice(secondTab + 1);
  if (filePath.length === 0) return undefined;
  // Binary files emit `-\t-\tpath`: line counts are unknown (treated as 0) but the
  // file still changed, so it is a real revision and stays in `files`.
  const binary = addedRaw === "-" || deletedRaw === "-";
  return {
    path: filePath,
    added: binary ? 0 : toCount(addedRaw),
    deleted: binary ? 0 : toCount(deletedRaw),
    binary,
  };
}

function toCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function collectHistory(options: CollectHistoryOptions): CollectedHistory {
  const requestedWindowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const maxWindowDays = options.maxWindowDays ?? DEFAULT_MAX_WINDOW_DAYS;
  const minCommits = options.minCommits ?? DEFAULT_MIN_COMMITS;
  const linesAvailable = !isPartialClone(options.git);
  const widened = widenIfSparse(
    options,
    requestedWindowDays,
    maxWindowDays,
    minCommits,
    linesAvailable,
  );
  const stats = revisionStats(widened.walk.records);
  const squash = detectSquash(stats, widened.walk.commitCount);
  // Only auto-switch to `lines` when squash is suspected AND line counts exist.
  // On a blobless clone we keep revisions and disclose the limitation instead of
  // switching to a metric we cannot compute.
  const switchToLines = squash.detected && linesAvailable;
  return {
    records: widened.walk.records,
    commitCount: widened.walk.commitCount,
    requestedWindowDays,
    effectiveWindowDays: widened.effectiveWindowDays,
    widened: widened.widened,
    widenReason: widened.widenReason,
    metric: switchToLines ? "lines" : "revisions",
    metricAutoSwitched: switchToLines,
    squashReason: squash.reason,
    singleRevisionRatio: stats.singleRevisionRatio,
    linesAvailable,
  };
}

// A blobless partial clone (e.g. `git clone --filter=blob:none`) has trees but no
// blob content, so `--numstat` would lazily fetch every blob and hang. Detect it
// up front and fall back to `--name-only` (trees only). Probes fail closed: if
// git errors on the config query, assume a full clone (numstat).
function isPartialClone(git: GitRunner): boolean {
  return (
    configValuePresent(git, ["config", "--get", "extensions.partialclone"]) ||
    configValuePresent(git, ["config", "--get-regexp", "remote\\..*\\.partialclonefilter"])
  );
}

function configValuePresent(git: GitRunner, args: readonly string[]): boolean {
  try {
    return git(args).trim().length > 0;
  } catch {
    return false;
  }
}

type WindowWalk = { readonly records: readonly CommitRecord[]; readonly commitCount: number };

type WidenResult = {
  readonly walk: WindowWalk;
  readonly effectiveWindowDays: number;
  readonly widened: boolean;
  readonly widenReason: string | null;
};

// Sparse-history widen-with-note guard: start at the requested window; if it
// holds fewer than `minCommits`, widen along the ladder up to maxWindow. Always
// report the EFFECTIVE window (never silently) so the header stays honest.
function widenIfSparse(
  options: CollectHistoryOptions,
  requestedWindowDays: number,
  maxWindowDays: number,
  minCommits: number,
  numstat: boolean,
): WidenResult {
  let walk = walkWindow(options, requestedWindowDays, numstat);
  let effectiveWindowDays = requestedWindowDays;
  if (walk.commitCount >= minCommits) {
    return { walk, effectiveWindowDays, widened: false, widenReason: null };
  }
  const initialCount = walk.commitCount;
  for (const windowDays of windowLadder(requestedWindowDays, maxWindowDays)) {
    walk = walkWindow(options, windowDays, numstat);
    effectiveWindowDays = windowDays;
    if (walk.commitCount >= minCommits) break;
  }
  // When the requested window is already at/above the widen cap the ladder is
  // empty and the window never changed — report it as not-widened rather than
  // claiming a no-op "widened from Nd to Nd".
  const widened = effectiveWindowDays !== requestedWindowDays;
  return {
    walk,
    effectiveWindowDays,
    widened,
    widenReason: widened ? `sparse history, ${initialCount} commit(s) < floor ${minCommits}` : null,
  };
}

function windowLadder(startDays: number, maxDays: number): number[] {
  const candidates = [...WIDEN_LADDER_DAYS, maxDays].filter(
    (days) => days > startDays && days <= maxDays,
  );
  return [...new Set(candidates)].sort((left, right) => left - right);
}

function walkWindow(
  options: CollectHistoryOptions,
  windowDays: number,
  numstat: boolean,
): WindowWalk {
  const output = options.git([
    "log",
    "--no-merges",
    "--no-renames",
    `--since=${windowDays}.days.ago`,
    "--date=iso-strict",
    numstat ? "--numstat" : "--name-only",
    `--format=${GIT_LOG_FORMAT}`,
  ]);
  const parsed = parseGitLog(output, { numstat });
  const ignore = options.ignore ?? DEFAULT_DRIFT_AI_CONFIG.ignore;
  const records = parsed.map((record) => filterRecordFiles(record, ignore));
  return { records, commitCount: parsed.length };
}

// Path filtering is `isIgnoredPath` and NOTHING more — the universal ignore
// defaults plus the user's `ignore` config. No generated/codegen/i18n detection
// (evidence, not verdicts): auto-classifying "ignorable" files on an arbitrary
// target is an unwinnable, unportable calibration treadmill.
function filterRecordFiles(record: CommitRecord, ignore: DriftAiIgnoreConfig): CommitRecord {
  return { ...record, files: record.files.filter((file) => !isIgnoredPath(file.path, ignore)) };
}

type RevisionStats = { readonly singleRevisionRatio: number; readonly distinctFiles: number };

function revisionStats(records: readonly CommitRecord[]): RevisionStats {
  const revisions = new Map<string, number>();
  for (const record of records) {
    for (const path of new Set(record.files.map((file) => file.path))) {
      revisions.set(path, (revisions.get(path) ?? 0) + 1);
    }
  }
  const distinctFiles = revisions.size;
  if (distinctFiles === 0) return { singleRevisionRatio: 0, distinctFiles: 0 };
  let single = 0;
  for (const count of revisions.values()) if (count === 1) single += 1;
  return { singleRevisionRatio: single / distinctFiles, distinctFiles };
}

function detectSquash(
  stats: RevisionStats,
  commitCount: number,
): { detected: boolean; reason: string | null } {
  if (
    stats.distinctFiles < SQUASH_MIN_DISTINCT_FILES ||
    commitCount < SQUASH_MIN_COMMITS ||
    stats.singleRevisionRatio < SQUASH_SINGLE_REVISION_RATIO
  ) {
    return { detected: false, reason: null };
  }
  const pct = Math.round(stats.singleRevisionRatio * 100);
  return {
    detected: true,
    reason: `${pct}% of touched files have a single revision in-window, which suggests a squash-merge workflow`,
  };
}
