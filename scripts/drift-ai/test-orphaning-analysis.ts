// Row builder for the `test-orphaning` prototype lens (backlog task 44b). Reduces a
// bounded full-history walk into per-source orphaning evidence: how much a source
// churned, which test files its path conventions imply, and whether those tests
// actually moved with it. No verdicts — the rows name churn, co-change, and the
// commits behind each lead so the reader judges.

import { buildCommitIntentOverlay } from "./commit-intent.js";
import { shellQuoteArg, subjectsAtIndexes } from "./hotspots-actionability.js";
import type { CommitRecord } from "./hotspots-history.js";
import {
  expandMappingPatterns,
  type MappingCandidate,
  parseSourceParts,
} from "./test-orphaning-mapping.js";
import type { RelatedTestEvidence, TestOrphaningRow } from "./test-orphaning-types.js";

// One touch of a path: the record index (0 = newest, since git log is reverse
// chronological) plus the author date string for disclosure.
type FileTouch = { readonly index: number; readonly date: string };

export type UnrankedTestOrphaningRow = Omit<TestOrphaningRow, "rank">;

// Build an unranked orphaning row for every source candidate found in history.
// Section split, threshold filtering, sorting, ranking, and display caps are the
// advisory builder's job; this stays a pure reduction.
export function buildTestOrphaningRows(
  records: readonly CommitRecord[],
  mappingPatterns: readonly string[],
): UnrankedTestOrphaningRow[] {
  const touchesByPath = buildTouchesByPath(records);
  const rows: UnrankedTestOrphaningRow[] = [];
  for (const [path, sourceTouches] of touchesByPath) {
    const parts = parseSourceParts(path);
    if (parts === null) continue;
    rows.push(
      rowForSource({
        path,
        sourceTouches,
        candidates: expandMappingPatterns(parts, mappingPatterns),
        touchesByPath,
        records,
      }),
    );
  }
  return rows;
}

function buildTouchesByPath(records: readonly CommitRecord[]): Map<string, FileTouch[]> {
  const touches = new Map<string, FileTouch[]>();
  records.forEach((record, index) => {
    const seen = new Set<string>();
    for (const file of record.files) {
      if (seen.has(file.path)) continue; // one numstat row per path per commit, but guard
      seen.add(file.path);
      const list = touches.get(file.path);
      const touch: FileTouch = { index, date: record.authorDate };
      if (list === undefined) touches.set(file.path, [touch]);
      else list.push(touch);
    }
  });
  return touches;
}

function rowForSource(input: {
  readonly path: string;
  readonly sourceTouches: readonly FileTouch[];
  readonly candidates: readonly MappingCandidate[];
  readonly touchesByPath: ReadonlyMap<string, FileTouch[]>;
  readonly records: readonly CommitRecord[];
}): UnrankedTestOrphaningRow {
  const relatedTests = relatedTestEvidence(input.candidates, input.touchesByPath);
  const testIndexes = new Set<number>();
  for (const candidate of input.candidates) {
    for (const touch of input.touchesByPath.get(candidate.path) ?? []) testIndexes.add(touch.index);
  }
  const newestTestIndex = smallestIndex(testIndexes);
  const coChangeIndexes = input.sourceTouches.filter((touch) => testIndexes.has(touch.index));
  const lastCoChangeIndex = coChangeIndexes.length === 0 ? null : minIndex(coChangeIndexes);
  const sourceChurn = input.sourceTouches.length;
  const sourceOnlyCommits = sourceChurn - coChangeIndexes.length;
  const sourceCommitsSinceCoChange =
    lastCoChangeIndex === null
      ? sourceChurn
      : input.sourceTouches.filter((touch) => touch.index < lastCoChangeIndex).length;
  const subjects = subjectsAtIndexes(input.records, touchIndexes(input.sourceTouches));
  return {
    path: input.path,
    relation: relatedTests.length === 0 ? "no-test-inferred" : "test-inferred",
    inferredTestPaths: input.candidates.map((candidate) => candidate.path),
    relatedTests,
    sourceChurn,
    testChurn: testIndexes.size,
    sourceOnlyCommits,
    sourceCommitsSinceCoChange,
    lastSourceChangeDate: newestDate(input.sourceTouches),
    lastTestChangeDate: dateAtIndex(input.records, newestTestIndex),
    lastCoChangeDate: dateAtIndex(input.records, lastCoChangeIndex),
    orphanScore: round2(divide(sourceOnlyCommits, sourceChurn)),
    recentSubjects: subjects,
    commitIntent: buildCommitIntentOverlay(subjects),
    inspectCommand: inspectCommand(input.path, relatedTests),
  };
}

// Project touch indexes lazily so subjectsAtIndexes consumes only its shared-limit
// prefix instead of allocating an index for every historical source touch.
function* touchIndexes(touches: readonly FileTouch[]): IterableIterator<number> {
  for (const touch of touches) yield touch.index;
}

function relatedTestEvidence(
  candidates: readonly MappingCandidate[],
  touchesByPath: ReadonlyMap<string, FileTouch[]>,
): RelatedTestEvidence[] {
  const evidence: RelatedTestEvidence[] = [];
  for (const candidate of candidates) {
    const touches = touchesByPath.get(candidate.path);
    if (touches === undefined || touches.length === 0) continue;
    evidence.push({
      path: candidate.path,
      testChurn: touches.length,
      lastTestChangeDate: newestDate(touches),
      matchedPattern: candidate.pattern,
    });
  }
  return evidence;
}

// Touch lists are appended in record order (index 0 = newest), so the smallest
// index is the most recent touch and dates need no offset-aware parsing here.
function newestDate(touches: readonly FileTouch[]): string | null {
  let newest: FileTouch | null = null;
  for (const touch of touches) {
    if (newest === null || touch.index < newest.index) newest = touch;
  }
  return newest?.date ?? null;
}

// The author date of a record by index, or null when the index is null/missing.
// Used for the index-derived "newest" fields so every newest is index-based and
// no field depends on offset-aware date parsing.
function dateAtIndex(records: readonly CommitRecord[], index: number | null): string | null {
  if (index === null) return null;
  return records[index]?.authorDate ?? null;
}

// The smallest (newest) index in a set of record indexes, or null when empty.
function smallestIndex(indexes: ReadonlySet<number>): number | null {
  let smallest: number | null = null;
  for (const index of indexes) {
    if (smallest === null || index < smallest) smallest = index;
  }
  return smallest;
}

function minIndex(touches: readonly FileTouch[]): number {
  let min = touches[0]?.index ?? 0;
  for (const touch of touches) if (touch.index < min) min = touch.index;
  return min;
}

function inspectCommand(path: string, relatedTests: readonly RelatedTestEvidence[]): string {
  const targets = [path, ...relatedTests.map((test) => test.path)].map(shellQuoteArg).join(" ");
  return `git log --oneline -- ${targets}`;
}

function divide(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
