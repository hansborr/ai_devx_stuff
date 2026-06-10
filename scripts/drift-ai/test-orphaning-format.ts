import {
  formatBoundedHistory,
  formatPercent,
  formatScannedRange,
} from "./advisory-format-helpers.js";
import { formatCommitIntentOverlay } from "./commit-intent.js";
import {
  appendPrototypeSection,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
} from "./prototype-advisory.js";
import type {
  RelatedTestEvidence,
  TestOrphaningAdvisory,
  TestOrphaningRow,
} from "./test-orphaning-types.js";

export function formatTestOrphaningAdvisoryJson(advisory: TestOrphaningAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatTestOrphaningAdvisoryText(advisory: TestOrphaningAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  lines.push(`  history: ${formatBoundedHistory(advisory.history)}`);
  lines.push(`  scanned: ${formatScannedRange(advisory.history.scannedRange)}`);
  lines.push(`  mapping: ${advisory.mappingPatterns.join(" , ")}`);
  lines.push(`  filter: source files with >= ${advisory.minSourceCommits} commit(s)`);
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

function renderRow(row: TestOrphaningRow): readonly string[] {
  return row.relation === "no-test-inferred" ? renderNoTestRow(row) : renderStaleRow(row);
}

function renderNoTestRow(row: TestOrphaningRow): readonly string[] {
  return [
    `#${row.rank} ${row.path} source churn ${row.sourceChurn}; no related test inferred`,
    `looked for: ${row.inferredTestPaths.length === 0 ? "n/a" : row.inferredTestPaths.join(" , ")}`,
    `last source change: ${formatDate(row.lastSourceChangeDate)}`,
    `subjects: ${formatSubjects(row.recentSubjects)}`,
    `intent: ${formatCommitIntentOverlay(row.commitIntent)}`,
    `inspect: ${row.inspectCommand}`,
  ];
}

function renderStaleRow(row: TestOrphaningRow): readonly string[] {
  return [
    `#${row.rank} ${row.path} source churn ${row.sourceChurn}; test churn ${row.testChurn}; source-only ${row.sourceOnlyCommits} (orphan ${formatPercent(row.orphanScore)})`,
    `related tests: ${formatRelatedTests(row.relatedTests)}`,
    `last source ${formatDate(row.lastSourceChangeDate)}; last test ${formatDate(
      row.lastTestChangeDate,
    )}; last co-change ${formatDate(row.lastCoChangeDate)}; source commits since co-change ${row.sourceCommitsSinceCoChange}`,
    `subjects: ${formatSubjects(row.recentSubjects)}`,
    `intent: ${formatCommitIntentOverlay(row.commitIntent)}`,
    `inspect: ${row.inspectCommand}`,
  ];
}

function formatRelatedTests(relatedTests: readonly RelatedTestEvidence[]): string {
  if (relatedTests.length === 0) return "none";
  return relatedTests
    .map(
      (test) =>
        `${test.path} (churn ${test.testChurn}, last ${formatDate(test.lastTestChangeDate)})`,
    )
    .join(" | ");
}

function formatSubjects(subjects: readonly string[]): string {
  return subjects.length === 0 ? "none" : subjects.join(" | ");
}

function formatDate(date: string | null): string {
  return date ?? "never";
}
