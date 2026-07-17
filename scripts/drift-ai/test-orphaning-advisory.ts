// Prototype advisory surface for the source/test orphaning lens (backlog task 44b).
// It splits the analysis rows into two candidate sections so "no test inferred"
// never reads the same as "a test exists but stopped tracking the source", and
// routes everything through the task-39 prototype contract (`kind: "advisory"`,
// `lane: "prototype"`, no `findings`, no WARN/FIX). The path conventions, churn, and
// co-change math all live in test-orphaning-analysis.ts; this module only frames and
// ranks the rows.

import {
  boundedHistoryAdvisoryFields,
  boundedHistoryDisclosure,
  positiveInt,
} from "./advisory-format-helpers.js";
import { buildPrototypeAdvisory, rowsPerSectionCap } from "./prototype-advisory.js";
import {
  buildTestOrphaningRows,
  type UnrankedTestOrphaningRow,
} from "./test-orphaning-analysis.js";
import {
  type BuildTestOrphaningAdvisoryInput,
  DEFAULT_MIN_SOURCE_COMMITS,
  DEFAULT_TEST_MAPPING_PATTERNS,
  DEFAULT_TEST_ORPHANING_TOP,
  TEST_ORPHANING_SUBCOMMAND,
  type TestOrphaningAdvisory,
  type TestOrphaningRow,
  type TestOrphaningSection,
} from "./test-orphaning-types.js";

export {
  formatTestOrphaningAdvisoryJson,
  formatTestOrphaningAdvisoryText,
} from "./test-orphaning-format.js";
export type {
  BuildTestOrphaningAdvisoryInput,
  TestOrphaningAdvisory,
} from "./test-orphaning-types.js";
export { DEFAULT_TEST_ORPHANING_TOP } from "./test-orphaning-types.js";

const NO_TEST_CANDIDATE_KIND = "source files with no inferred test";
const STALE_CANDIDATE_KIND = "source files whose tests lag source churn";

export function buildTestOrphaningAdvisory(
  input: BuildTestOrphaningAdvisoryInput,
): TestOrphaningAdvisory {
  const top = positiveInt(input.top, DEFAULT_TEST_ORPHANING_TOP);
  const minSourceCommits = positiveInt(input.minSourceCommits, DEFAULT_MIN_SOURCE_COMMITS);
  const mappingPatterns =
    input.mappingPatterns === undefined || input.mappingPatterns.length === 0
      ? DEFAULT_TEST_MAPPING_PATTERNS
      : input.mappingPatterns;

  const rows = buildTestOrphaningRows(input.history.records, mappingPatterns).filter(
    (row) => row.sourceChurn >= minSourceCommits,
  );
  const noTest = rows.filter((row) => row.relation === "no-test-inferred");
  const stale = rows.filter(
    (row) => row.relation === "test-inferred" && row.sourceOnlyCommits >= 1,
  );
  const sections = [
    section(
      NO_TEST_CANDIDATE_KIND,
      noTest,
      top,
      compareNoTest,
      noTestEmptyReason(minSourceCommits),
    ),
    section(STALE_CANDIDATE_KIND, stale, top, compareStale, STALE_EMPTY_REASON),
  ];

  const historyFields = boundedHistoryAdvisoryFields(input.history);
  const advisory = buildPrototypeAdvisory({
    subcommand: TEST_ORPHANING_SUBCOMMAND,
    prerequisites: historyFields.prerequisites,
    caps: [
      ...historyFields.caps,
      rowsPerSectionCap(top, sections, { label: "rows per section", noun: "section" }),
    ],
    degradations: historyFields.degradations,
    sections,
  });
  return {
    ...advisory,
    history: boundedHistoryDisclosure(input.history),
    mappingPatterns,
    minSourceCommits,
  };
}

const STALE_EMPTY_REASON =
  "no source file with an inferred test had source-only churn; tests moved with the source.";

function noTestEmptyReason(minSourceCommits: number): string {
  return `no source file with >= ${minSourceCommits} commit(s) lacked an inferred test.`;
}

function section(
  candidateKind: string,
  rows: readonly UnrankedTestOrphaningRow[],
  top: number,
  compare: (left: UnrankedTestOrphaningRow, right: UnrankedTestOrphaningRow) => number,
  emptyReason: string,
): TestOrphaningSection {
  const ranked: TestOrphaningRow[] = [...rows]
    .sort(compare)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    candidateKind,
    totalCandidates: ranked.length,
    emptyReason: ranked.length === 0 ? emptyReason : null,
    entries: ranked.slice(0, top),
  };
}

function compareNoTest(left: UnrankedTestOrphaningRow, right: UnrankedTestOrphaningRow): number {
  return right.sourceChurn - left.sourceChurn || left.path.localeCompare(right.path, "en");
}

function compareStale(left: UnrankedTestOrphaningRow, right: UnrankedTestOrphaningRow): number {
  return (
    right.sourceCommitsSinceCoChange - left.sourceCommitsSinceCoChange ||
    right.sourceOnlyCommits - left.sourceOnlyCommits ||
    right.sourceChurn - left.sourceChurn ||
    left.path.localeCompare(right.path, "en")
  );
}
