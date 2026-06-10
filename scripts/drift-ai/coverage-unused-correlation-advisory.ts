// Advisory rendering for the coverage x unused-export correlation (task 42b).
// Renders the task-42b correlation core through the shared prototype advisory
// contract (task 39): `kind: "advisory"`, `lane: "prototype"`, no top-level
// `findings`, no WARN/FIX language. The row text keeps the static signal and the
// per-artifact runtime coverage as two separate facts and never asserts deadness.

import { plural, positiveInt } from "./advisory-format-helpers.js";
import {
  type ArtifactCoverageResult,
  CORRELATION_STANDING_CAVEAT,
  type CorrelationAgreement,
  type CoverageUnusedCorrelationResult,
  type CoverageUnusedCorrelationRow,
} from "./coverage-unused-correlation.js";
import {
  fileLocationLabel,
  type KnipUnusedExportsReportStatus,
  unusedExportsReportPrerequisite,
} from "./knip-unused-exports-correlation.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypePrerequisite,
  type PrototypeSection,
} from "./prototype-advisory.js";

export const COVERAGE_UNUSED_SUBCOMMAND = "coverage-unused-exports";
export const DEFAULT_COVERAGE_UNUSED_TOP = 50;
const CANDIDATE_KIND = "coverage x unused-export correlation";
const PARSER_LIMITATION =
  "lcov line/function precision only; branch coverage and non-lcov formats are not correlated, " +
  "and coverage reflects the supplied run(s), not reachability";

export type UnusedExportsReportStatus = KnipUnusedExportsReportStatus;

export type CoverageUnusedCorrelationAdvisoryInput = {
  readonly report: UnusedExportsReportStatus;
  readonly artifactCount: number;
  // Per-artifact coverage parse/read notes, already formatted by the command.
  readonly coverageDegradations: readonly string[];
  readonly result: CoverageUnusedCorrelationResult;
  readonly top: number;
};

export type CoverageUnusedCorrelationSection = PrototypeSection<CoverageUnusedCorrelationRow> & {
  readonly standingCaveat: string;
};

export type CoverageUnusedCorrelationAdvisory = PrototypeAdvisory<CoverageUnusedCorrelationSection>;

export function buildCoverageUnusedCorrelationAdvisory(
  input: CoverageUnusedCorrelationAdvisoryInput,
): CoverageUnusedCorrelationAdvisory {
  const top = positiveInt(input.top, DEFAULT_COVERAGE_UNUSED_TOP);
  const rows = input.result.rows;
  const section: CoverageUnusedCorrelationSection = {
    candidateKind: CANDIDATE_KIND,
    standingCaveat: CORRELATION_STANDING_CAVEAT,
    totalCandidates: rows.length,
    emptyReason: emptyReason(input.report, rows.length),
    entries: rows.slice(0, top),
  };
  return buildPrototypeAdvisory({
    subcommand: COVERAGE_UNUSED_SUBCOMMAND,
    prerequisites: [
      unusedExportsReportPrerequisite(input.report),
      coveragePrerequisite(input.artifactCount),
    ],
    caps: [rowCap(top, rows.length)],
    degradations: [
      ...input.coverageDegradations,
      ...statsDegradations(input.result),
      PARSER_LIMITATION,
    ],
    sections: [section],
  });
}

export function formatCoverageUnusedCorrelationJson(
  advisory: CoverageUnusedCorrelationAdvisory,
): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatCoverageUnusedCorrelationText(
  advisory: CoverageUnusedCorrelationAdvisory,
): string {
  const lines = formatPrototypeHeader(advisory);
  for (const section of advisory.sections) {
    lines.push("");
    appendCorrelationSection(lines, section);
  }
  return lines.join("\n");
}

function coveragePrerequisite(artifactCount: number): PrototypePrerequisite {
  return {
    name: "coverage artifacts",
    satisfied: artifactCount > 0,
    detail:
      artifactCount > 0
        ? `${artifactCount} configured ${plural("artifact", artifactCount)}`
        : "0 configured artifacts; add coverage.artifacts to drift-ai config",
  };
}

function rowCap(top: number, total: number): PrototypeCap {
  const hit = total > top;
  return {
    label: "correlation rows",
    limit: top,
    hit,
    detail: hit ? `stopped after showing ${top} of ${total} correlated symbols` : null,
  };
}

function statsDegradations(result: CoverageUnusedCorrelationResult): string[] {
  const { stats } = result;
  const notes: string[] = [];
  if (stats.missingLocation > 0) {
    notes.push(
      `${stats.missingLocation} symbol(s) had no source location from knip; coverage could not be aligned to a range`,
    );
  }
  if (stats.fileNotInAnyArtifact > 0) {
    notes.push(
      `${stats.fileNotInAnyArtifact} symbol(s) had no matching file in any coverage artifact (path / source-map mismatch)`,
    );
  }
  if (stats.suffixMatched > 0) {
    notes.push(
      `${stats.suffixMatched} symbol(s) matched a coverage file by path suffix, not exact path`,
    );
  }
  return notes;
}

function emptyReason(report: UnusedExportsReportStatus, total: number): string | null {
  if (total > 0) return null;
  if (report.kind !== "ok") {
    return "no unused-export report parsed; pass --unused-exports-report <knip --reporter json output>.";
  }
  return "knip reported 0 unused exports; nothing to correlate.";
}

function appendCorrelationSection(
  lines: string[],
  section: CoverageUnusedCorrelationSection,
): void {
  appendPrototypeSection(lines, section, renderRow, { preludeLines: correlationSectionPrelude });
}

function correlationSectionPrelude(section: CoverageUnusedCorrelationSection): readonly string[] {
  const shown = (agreement: CorrelationAgreement): number =>
    section.entries.filter((row) => row.agreement === agreement).length;
  return [
    `caveat: ${section.standingCaveat}`,
    `summary (shown): ${shown("covered-but-unused")} covered-but-unused, ` +
      `${shown("uncovered-and-unused")} uncovered-and-unused, ` +
      `${shown("coverage-unavailable")} coverage-unavailable`,
  ];
}

function renderRow(row: CoverageUnusedCorrelationRow): readonly string[] {
  const lines = [
    `#${row.rank} [${row.agreement}] ${row.category} ${locationLabel(row)} ${symbolLabel(row)} ` +
      "-- static: unused-export (knip report)",
  ];
  for (const result of row.coverage) lines.push(`  coverage${formatCoverageResult(result)}`);
  for (const caveat of row.caveats) {
    if (caveat !== CORRELATION_STANDING_CAVEAT) lines.push(`  caveat: ${caveat}`);
  }
  return lines;
}

function formatCoverageResult(result: ArtifactCoverageResult): string {
  const head = `[${result.label}] (${result.format ?? "unparsed"}): ${result.state}`;
  if (result.state === "unavailable") {
    return `${head} -- ${result.note ?? "no coverage record"}`;
  }
  const range = formatRange(result);
  const note = result.note === null ? "" : `; ${result.note}`;
  return `${head} -- hits ${result.hits ?? "n/a"}, match ${result.matchKind} ${range}, path ${result.pathMatch}${note}`;
}

function formatRange(result: ArtifactCoverageResult): string {
  if (result.matchedLine === null) return "n/a";
  return result.matchedEndLine === null
    ? String(result.matchedLine)
    : `${result.matchedLine}-${result.matchedEndLine}`;
}

function locationLabel(row: CoverageUnusedCorrelationRow): string {
  return fileLocationLabel(row);
}

function symbolLabel(row: CoverageUnusedCorrelationRow): string {
  return row.namespace === null ? row.symbol : `${row.namespace}.${row.symbol}`;
}
