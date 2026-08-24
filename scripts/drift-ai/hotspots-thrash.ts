// Thrash lens: files edited repeatedly without much net growth. This is one
// section with overlay columns (young-in-window, fix/revert tie-breaker, and
// test-vs-source churn ratio), not separate verdicts.

import { isBroadHistoryTestPath } from "../lib/path-taxonomy.js";
import { buildPathRowActionability } from "./hotspots-actionability.js";
import type { ThrashHotspot, ThrashSection } from "./hotspots-format.js";
import {
  type CollectedHistory,
  type CommitRecord,
  newestTimestamp,
  updateTouchDates,
} from "./hotspots-history.js";
import { DAY_MS } from "./time-constants.js";

const DEFAULT_THRASH_MIN_REVISIONS = 3;
const DEFAULT_THRASH_MAX_NET_LINES_PER_REVISION = 5;
const DEFAULT_THRASH_YOUNG_DAYS = 7;

export type ReduceThrashOptions = {
  readonly top: number;
  readonly minRevisions?: number;
  readonly maxNetLinesPerRevision?: number;
  readonly youngDays?: number;
};

type ThrashAggregate = {
  revisions: number;
  added: number;
  deleted: number;
  linesChanged: number;
  fixRevertCommits: number;
  newestTouchMs: number | null;
  oldestTouchMs: number | null;
};

type ThrashCandidate = {
  readonly path: string;
  readonly revisions: number;
  readonly linesChanged: number;
  readonly netLines: number;
  readonly netLinesPerRevision: number;
  readonly fixRevertCommits: number;
  readonly firstTouchAgeDays: number | null;
  readonly youngInWindow: boolean;
  readonly testChurnRatio: number;
  readonly score: number;
};

export function reduceThrash(
  history: CollectedHistory,
  options: ReduceThrashOptions,
): ThrashSection {
  const minRevisions = options.minRevisions ?? DEFAULT_THRASH_MIN_REVISIONS;
  const maxNetLinesPerRevision =
    options.maxNetLinesPerRevision ?? DEFAULT_THRASH_MAX_NET_LINES_PER_REVISION;
  const youngDays = options.youngDays ?? DEFAULT_THRASH_YOUNG_DAYS;
  if (!history.linesAvailable) {
    return {
      lens: "thrash",
      minRevisions,
      maxNetLinesPerRevision,
      youngDays,
      emptyReason:
        "line counts unavailable on this checkout, so net-growth thrash cannot be computed.",
      entries: [],
    };
  }

  const referenceMs = newestTimestamp(history.records);
  const candidates = [...aggregateThrash(history.records).entries()]
    .map(([path, aggregate]) =>
      toCandidate(path, aggregate, history.records, referenceMs, youngDays),
    )
    .filter(
      (candidate) =>
        candidate.linesChanged > 0 &&
        candidate.revisions >= minRevisions &&
        Math.abs(candidate.netLinesPerRevision) <= maxNetLinesPerRevision,
    )
    .sort(compareCandidates)
    .slice(0, options.top);

  return {
    lens: "thrash",
    minRevisions,
    maxNetLinesPerRevision,
    youngDays,
    emptyReason:
      candidates.length === 0
        ? `no thrash hotspots this window (no file has at least ${minRevisions} revisions with net growth <= ${maxNetLinesPerRevision} lines/revision).`
        : null,
    entries: candidates.map((candidate) => withContext(candidate, history.records)),
  };
}

function aggregateThrash(records: readonly CommitRecord[]): Map<string, ThrashAggregate> {
  const byPath = new Map<string, ThrashAggregate>();
  for (const record of records) {
    const seen = new Set<string>();
    for (const file of record.files) {
      const aggregate = byPath.get(file.path) ?? {
        revisions: 0,
        added: 0,
        deleted: 0,
        linesChanged: 0,
        fixRevertCommits: 0,
        newestTouchMs: null,
        oldestTouchMs: null,
      };
      if (!seen.has(file.path)) {
        aggregate.revisions += 1;
        if (isFixOrRevert(record.subject)) aggregate.fixRevertCommits += 1;
        updateTouchDates(aggregate, record);
        seen.add(file.path);
      }
      aggregate.added += file.added;
      aggregate.deleted += file.deleted;
      aggregate.linesChanged += file.added + file.deleted;
      byPath.set(file.path, aggregate);
    }
  }
  return byPath;
}

function isFixOrRevert(subject: string): boolean {
  return /\b(?:revert|fix|hotfix)\b/iu.test(subject);
}

function toCandidate(
  path: string,
  aggregate: ThrashAggregate,
  records: readonly CommitRecord[],
  referenceMs: number | null,
  youngDays: number,
): ThrashCandidate {
  const netLines = aggregate.added - aggregate.deleted;
  const netLinesPerRevision = aggregate.revisions === 0 ? 0 : netLines / aggregate.revisions;
  const firstTouchAgeDays = touchAgeDays(referenceMs, aggregate.oldestTouchMs);
  return {
    path,
    revisions: aggregate.revisions,
    linesChanged: aggregate.linesChanged,
    netLines,
    netLinesPerRevision,
    fixRevertCommits: aggregate.fixRevertCommits,
    firstTouchAgeDays,
    youngInWindow: firstTouchAgeDays !== null && firstTouchAgeDays <= youngDays,
    testChurnRatio: testChurnRatio(records, path),
    score: aggregate.revisions,
  };
}

function touchAgeDays(referenceMs: number | null, oldestTouchMs: number | null): number | null {
  if (referenceMs === null || oldestTouchMs === null) return null;
  return Math.max(0, Math.ceil((referenceMs - oldestTouchMs) / DAY_MS));
}

function testChurnRatio(records: readonly CommitRecord[], path: string): number {
  let testLines = 0;
  let totalLines = 0;
  for (const record of records) {
    if (!record.files.some((file) => file.path === path)) continue;
    for (const file of record.files) {
      const changed = file.added + file.deleted;
      totalLines += changed;
      // Broad history-heuristic policy on purpose: this lens scores git
      // history, so it must tolerate deleted paths and stale conventions.
      if (isBroadHistoryTestPath(file.path)) testLines += changed;
    }
  }
  return totalLines === 0 ? 0 : testLines / totalLines;
}

function compareCandidates(left: ThrashCandidate, right: ThrashCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  if (right.fixRevertCommits !== left.fixRevertCommits) {
    return right.fixRevertCommits - left.fixRevertCommits;
  }
  const leftNet = Math.abs(left.netLinesPerRevision);
  const rightNet = Math.abs(right.netLinesPerRevision);
  if (leftNet !== rightNet) return leftNet - rightNet;
  return left.path.localeCompare(right.path, "en");
}

function withContext(candidate: ThrashCandidate, records: readonly CommitRecord[]): ThrashHotspot {
  return { ...candidate, ...buildPathRowActionability(records, candidate.path) };
}
