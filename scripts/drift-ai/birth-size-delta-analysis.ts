import {
  birthSizeDeltaComplexityCaveats,
  birthSizeDeltaComplexityOverlay,
} from "./birth-size-delta-complexity.js";
import {
  type BirthBlobReadResult,
  type BirthSizeDeltaBlobState,
  type BirthSizeDeltaMetric,
  type BirthSizeDeltaRow,
  type BuildBirthSizeDeltaAdvisoryInput,
} from "./birth-size-delta-types.js";
import {
  type BranchPointMeasurer,
  type BranchPointResult,
  measureBranchPoints,
} from "./branch-points.js";
import { analyzeCommentMetrics } from "./comments.js";
import { shellQuoteArg } from "./hotspots-actionability.js";
import type { CommitRecord } from "./hotspots-history.js";

const PARTIAL_BIRTH_CAVEAT =
  "history was partial; birth commit is the earliest observed touch for this path, not guaranteed original creation.";
const LINE_DEGRADATION_CAVEAT =
  "git log line metrics unavailable; birth-burst added lines and churn changed lines are null.";

type BlobMetrics = {
  readonly bytes: number;
  readonly effectiveLoc: number;
  readonly branchPoints: BranchPointResult;
};

type ComparedBlobMetrics = {
  readonly birth: BlobMetrics | null;
  readonly current: BlobMetrics | null;
  readonly bytes: BirthSizeDeltaMetric;
  readonly effectiveLoc: BirthSizeDeltaMetric;
};

type PathTouch = {
  readonly record: CommitRecord;
  readonly change: CommitRecord["files"][number];
};

type PathTouches = {
  readonly touches: PathTouch[];
};

type BirthSizeDeltaCandidate = {
  readonly path: string;
  readonly touches: PathTouches;
};

export type BirthSizeDeltaAnalysis = {
  readonly rows: readonly BirthSizeDeltaRow[];
  readonly pathHistoryCandidateCount: number;
  readonly blobReadCount: number;
};

export function analyzeBirthSizeDeltas(
  input: BuildBirthSizeDeltaAdvisoryInput,
  maxBlobReads: number,
): BirthSizeDeltaAnalysis {
  const candidates = buildCandidates(input);
  const selected = candidates.slice(0, maxBlobReads);
  const rows = rankRows(buildRows(input, selected));
  return {
    rows,
    pathHistoryCandidateCount: candidates.length,
    blobReadCount: rows.length,
  };
}

function buildCandidates(
  input: BuildBirthSizeDeltaAdvisoryInput,
): readonly BirthSizeDeltaCandidate[] {
  const touchMap = pathTouches(input.history.records, input.currentFiles);
  const candidates: BirthSizeDeltaCandidate[] = [];
  for (const path of input.currentFiles) {
    const touches = touchMap.get(path);
    if (touches === undefined || touches.touches.length === 0) continue;
    candidates.push({ path, touches });
  }
  return candidates.sort(compareCandidates(input.history.linesAvailable));
}

function buildRows(
  input: BuildBirthSizeDeltaAdvisoryInput,
  candidates: readonly BirthSizeDeltaCandidate[],
): BirthSizeDeltaRow[] {
  return candidates.map((candidate) => buildRow(candidate.path, candidate.touches, input));
}

function buildRow(
  path: string,
  touches: PathTouches,
  input: BuildBirthSizeDeltaAdvisoryInput,
): BirthSizeDeltaRow {
  const birthTouch = oldestTouch(touches);
  const birthRecord = birthTouch.record;
  const birthBlob = readBirth(path, birthRecord, input);
  const measure = input.measureComplexity ?? measureBranchPoints;
  const metrics = compareBlobMetrics(path, birthBlob, input.readCurrentBlob(path), measure);
  return {
    rank: 0,
    path,
    birth: birthMetadata(birthRecord),
    birthBlob: birthBlobState(birthBlob),
    currentBlob: currentBlobState(metrics.current),
    birthBurst: birthBurst(birthRecord, input.history.linesAvailable),
    bytes: metrics.bytes,
    effectiveLoc: metrics.effectiveLoc,
    complexity: birthSizeDeltaComplexityOverlay(
      branchResult(metrics.birth),
      branchResult(metrics.current),
    ),
    churnSinceBirth: churnSinceBirth(touches.touches, input.history.linesAvailable),
    inspectCommand: `git log --oneline -- ${shellQuoteArg(path)}`,
    blobCommand: `git show ${birthRecord.hash}:${shellQuoteArg(path)}`,
    caveats: rowCaveats(input, birthBlob, metrics),
  };
}

function oldestTouch(touches: PathTouches): PathTouch {
  const touch = touches.touches[touches.touches.length - 1];
  if (touch === undefined) throw new Error("birth-size-delta row requires at least one touch.");
  return touch;
}

function birthMetadata(record: CommitRecord): BirthSizeDeltaRow["birth"] {
  return {
    commit: record.hash,
    authorName: record.authorName,
    authorEmail: record.authorEmail,
    authorDate: record.authorDate,
    subject: record.subject,
  };
}

function birthBlobState(birthBlob: BirthBlobReadResult): BirthSizeDeltaBlobState {
  return birthBlob.ok
    ? { available: true, reason: null }
    : { available: false, reason: birthBlob.reason };
}

function currentBlobState(metrics: BlobMetrics | null): BirthSizeDeltaBlobState {
  return metrics === null
    ? { available: false, reason: "current file could not be read" }
    : { available: true, reason: null };
}

function pathTouches(
  records: readonly CommitRecord[],
  currentFiles: readonly string[],
): Map<string, PathTouches> {
  const current = new Set(currentFiles);
  const map = new Map<string, PathTouches>();
  for (const record of records) {
    const touched = new Set<string>();
    for (const file of record.files) {
      if (!current.has(file.path) || touched.has(file.path)) continue;
      touched.add(file.path);
      const existing = map.get(file.path);
      const touch = { record, change: file };
      if (existing === undefined) map.set(file.path, { touches: [touch] });
      else existing.touches.push(touch);
    }
  }
  return map;
}

function readBirth(
  path: string,
  birthRecord: CommitRecord,
  input: BuildBirthSizeDeltaAdvisoryInput,
): BirthBlobReadResult {
  return input.readBirthBlob({ commit: birthRecord.hash, path });
}

function rowCaveats(
  input: BuildBirthSizeDeltaAdvisoryInput,
  birthBlob: BirthBlobReadResult,
  metrics: ComparedBlobMetrics,
): string[] {
  const caveats: string[] = [];
  if (input.history.moreHistoryMayExist) caveats.push(PARTIAL_BIRTH_CAVEAT);
  if (!input.history.linesAvailable) caveats.push(LINE_DEGRADATION_CAVEAT);
  if (!birthBlob.ok) caveats.push(`birth blob unavailable: ${birthBlob.reason}`);
  if (metrics.current === null) caveats.push("current file could not be read.");
  caveats.push(
    ...birthSizeDeltaComplexityCaveats(branchResult(metrics.birth), branchResult(metrics.current)),
  );
  return caveats;
}

// A blob's branch-points result, or null when the blob itself was unavailable. The
// overlay helpers use that null to keep a missing blob distinct from one that parsed.
function branchResult(metrics: BlobMetrics | null): BranchPointResult | null {
  return metrics === null ? null : metrics.branchPoints;
}

function birthBurst(
  record: CommitRecord,
  linesAvailable: boolean,
): BirthSizeDeltaRow["birthBurst"] {
  return {
    fileCount: record.files.length,
    linesAdded: linesAvailable ? sumAdded(record) : null,
    linesAvailable,
  };
}

function sumAdded(record: CommitRecord): number {
  return record.files.reduce((sum, file) => sum + file.added, 0);
}

function churnSinceBirth(
  touchesNewestFirst: readonly PathTouch[],
  linesAvailable: boolean,
): BirthSizeDeltaRow["churnSinceBirth"] {
  const afterBirth = touchesNewestFirst.slice(0, -1);
  return {
    commits: afterBirth.length,
    linesChanged: linesAvailable ? sumChanged(afterBirth) : null,
  };
}

function sumChanged(touches: readonly PathTouch[]): number {
  return touches.reduce((sum, touch) => sum + touch.change.added + touch.change.deleted, 0);
}

function measureBlob(path: string, source: string, measure: BranchPointMeasurer): BlobMetrics {
  return {
    bytes: Buffer.byteLength(source, "utf8"),
    effectiveLoc: analyzeCommentMetrics(source).effective,
    branchPoints: measure(path, source),
  };
}

function compareBlobMetrics(
  path: string,
  birthBlob: BirthBlobReadResult,
  currentSource: string | undefined,
  measure: BranchPointMeasurer,
): ComparedBlobMetrics {
  const birth = metricsForBirthBlob(path, birthBlob, measure);
  const current = currentSource === undefined ? null : measureBlob(path, currentSource, measure);
  return {
    birth,
    current,
    bytes: metricDelta(birth?.bytes ?? null, current?.bytes ?? null),
    effectiveLoc: metricDelta(birth?.effectiveLoc ?? null, current?.effectiveLoc ?? null),
  };
}

function metricsForBirthBlob(
  path: string,
  birthBlob: BirthBlobReadResult,
  measure: BranchPointMeasurer,
): BlobMetrics | null {
  return birthBlob.ok ? measureBlob(path, birthBlob.source, measure) : null;
}

function metricDelta(birth: number | null, current: number | null): BirthSizeDeltaMetric {
  return {
    birth,
    current,
    delta: birth === null || current === null ? null : current - birth,
  };
}

function rankRows(rows: readonly BirthSizeDeltaRow[]): BirthSizeDeltaRow[] {
  return [...rows].sort(compareRows).map((row, index) => ({ ...row, rank: index + 1 }));
}

function compareRows(left: BirthSizeDeltaRow, right: BirthSizeDeltaRow): number {
  return (
    compareNullableDesc(left.effectiveLoc.delta, right.effectiveLoc.delta) ||
    compareNullableDesc(left.bytes.delta, right.bytes.delta) ||
    right.churnSinceBirth.commits - left.churnSinceBirth.commits ||
    left.path.localeCompare(right.path, "en")
  );
}

function compareCandidates(
  linesAvailable: boolean,
): (left: BirthSizeDeltaCandidate, right: BirthSizeDeltaCandidate) => number {
  return (left, right) =>
    compareNullableDesc(
      candidateBirthLines(left, linesAvailable),
      candidateBirthLines(right, linesAvailable),
    ) ||
    right.touches.touches.length - left.touches.touches.length ||
    left.path.localeCompare(right.path, "en");
}

function candidateBirthLines(
  candidate: BirthSizeDeltaCandidate,
  linesAvailable: boolean,
): number | null {
  if (!linesAvailable) return null;
  return sumAdded(oldestTouch(candidate.touches).record);
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function birthBlobFailureCount(
  rows: readonly BirthSizeDeltaRow[],
  predicate: (message: string) => boolean,
): number {
  return rows.filter((row) => row.birthBlob.reason !== null && predicate(row.birthBlob.reason))
    .length;
}
