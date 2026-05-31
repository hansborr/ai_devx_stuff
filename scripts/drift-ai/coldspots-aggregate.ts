// Per-file aggregation + shared date/number math for the coldspot lens. Split out
// of `coldspots-coldspot.ts` so the reducer (gate + assembly) and the amplifiers
// each stay focused. The walk is the SAME windowed history hotspots collects; this
// only reduces it. The first-seen/last-touched pattern is copied from
// `hotspots-thrash.ts` (updateTouchDates / oldest / newest).

import type { CommitRecord } from "./hotspots-history.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

// Per-file aggregate over the windowed walk. `oldestTouchMs`/`newestTouchMs` follow
// the thrash first-seen/last-touched pattern. `churnLines` is the size proxy.
export type FileAggregate = {
  revisions: number;
  churnLines: number; // accumulated added + deleted (the large-file-cold size proxy)
  added: number;
  oldestTouchMs: number | null;
  newestTouchMs: number | null;
  birthFileCount: number; // files touched by this file's earliest in-window commit
  birthLinesAdded: number; // COMMIT-WIDE lines added by that birth commit (the scaffold size)
  birthMs: number | null;
};

export function aggregateFiles(records: readonly CommitRecord[]): Map<string, FileAggregate> {
  const byPath = new Map<string, FileAggregate>();
  for (const record of records) {
    const seen = new Set<string>();
    const recordFileCount = new Set(record.files.map((file) => file.path)).size;
    // Commit-wide added lines: the size of the whole birth commit, not just this
    // file's slice. A genuine multi-file scaffold is large in BOTH files and lines;
    // attributing only `file.added` made a solo 200-line edit look like a burst.
    const recordLinesAdded = record.files.reduce((sum, file) => sum + file.added, 0);
    for (const file of record.files) {
      const aggregate = byPath.get(file.path) ?? newAggregate();
      if (!seen.has(file.path)) {
        aggregate.revisions += 1;
        updateTouchDates(aggregate, record);
        recordBirth(aggregate, record, recordFileCount, recordLinesAdded);
        seen.add(file.path);
      }
      aggregate.churnLines += file.added + file.deleted;
      aggregate.added += file.added;
      byPath.set(file.path, aggregate);
    }
  }
  return byPath;
}

function newAggregate(): FileAggregate {
  return {
    revisions: 0,
    churnLines: 0,
    added: 0,
    oldestTouchMs: null,
    newestTouchMs: null,
    birthFileCount: 0,
    birthLinesAdded: 0,
    birthMs: null,
  };
}

// First-seen / last-touched, copied from the thrash pattern (hotspots-thrash.ts).
function updateTouchDates(aggregate: FileAggregate, record: CommitRecord): void {
  const timestamp = Date.parse(record.authorDate);
  if (!Number.isFinite(timestamp)) return;
  aggregate.newestTouchMs =
    aggregate.newestTouchMs === null ? timestamp : Math.max(aggregate.newestTouchMs, timestamp);
  aggregate.oldestTouchMs =
    aggregate.oldestTouchMs === null ? timestamp : Math.min(aggregate.oldestTouchMs, timestamp);
}

// Track the EARLIEST in-window commit for this file (the birth). `git log` is
// newest-first, so each later (older) record touching the path overwrites until the
// oldest wins. Birth burst is the commit-wide file count + commit-wide lines added.
function recordBirth(
  aggregate: FileAggregate,
  record: CommitRecord,
  recordFileCount: number,
  recordLinesAdded: number,
): void {
  const timestamp = Date.parse(record.authorDate);
  const ts = Number.isFinite(timestamp) ? timestamp : null;
  if (aggregate.birthMs === null || (ts !== null && ts <= aggregate.birthMs)) {
    aggregate.birthMs = ts;
    aggregate.birthFileCount = recordFileCount;
    aggregate.birthLinesAdded = recordLinesAdded;
  }
}

// Count of DISTINCT COMMITS touching each immediate parent directory. Used by
// stale-in-hot-neighborhood (a fossil sitting in an active module). Counting commits
// — not summing each file's revisions — keeps the unit comparable to a file's own
// revision count: one scaffold commit touching 10 siblings is ONE dir commit, not 10,
// so a one-time scaffold no longer masquerades as an actively churning neighborhood.
export function directoryCommits(records: readonly CommitRecord[]): Map<string, number> {
  const byDir = new Map<string, number>();
  for (const record of records) {
    const dirs = new Set(record.files.map((file) => dirnameOf(file.path)));
    for (const dir of dirs) byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return byDir;
}

export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

// Most-recent repo-wide commit timestamp per committing author (%an). gone-silent
// is about the human who keeps showing up, so co-authors are not keyed here.
export function lastRepoCommitMsByAuthor(records: readonly CommitRecord[]): Map<string, number> {
  const byAuthor = new Map<string, number>();
  for (const record of records) {
    const timestamp = Date.parse(record.authorDate);
    if (!Number.isFinite(timestamp)) continue;
    const name = record.authorName.trim();
    if (name.length === 0) continue;
    byAuthor.set(name, Math.max(byAuthor.get(name) ?? Number.NEGATIVE_INFINITY, timestamp));
  }
  return byAuthor;
}

export function ageDaysOf(referenceMs: number | null, newestTouchMs: number | null): number | null {
  if (referenceMs === null || newestTouchMs === null) return null;
  return Math.max(0, Math.floor((referenceMs - newestTouchMs) / DAY_MS));
}

export function newestTimestamp(records: readonly CommitRecord[]): number | null {
  let newest: number | null = null;
  for (const record of records) {
    const timestamp = Date.parse(record.authorDate);
    if (!Number.isFinite(timestamp)) continue;
    newest = newest === null ? timestamp : Math.max(newest, timestamp);
  }
  return newest;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
