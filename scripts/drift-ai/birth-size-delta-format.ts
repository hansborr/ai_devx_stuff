import { formatBoundedHistory, formatScannedRange } from "./advisory-format-helpers.js";
import type {
  BirthSizeDeltaAdvisory,
  BirthSizeDeltaComplexity,
  BirthSizeDeltaMetric,
  BirthSizeDeltaRow,
} from "./birth-size-delta-types.js";
import { BRANCH_POINTS_METRIC_NAME, BRANCH_POINTS_METRIC_VERSION } from "./branch-points.js";
import {
  appendPrototypeSection,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
} from "./prototype-advisory.js";

export function formatBirthSizeDeltaAdvisoryJson(advisory: BirthSizeDeltaAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatBirthSizeDeltaAdvisoryText(advisory: BirthSizeDeltaAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  lines.push(`  history: ${formatBoundedHistory(advisory.history)}`);
  lines.push(`  scanned: ${formatScannedRange(advisory.history.scannedRange)}`);
  lines.push(
    `  current files: ${advisory.currentFileCount}; path-history candidates: ${advisory.pathHistoryCandidateCount}; blob-read rows: ${advisory.blobReadCount}/${advisory.maxBlobReads}`,
  );
  lines.push(
    `  birth blob read caps: ${advisory.blobReadCaps.maxOutputBytes} byte(s), ${advisory.blobReadCaps.timeoutMs}ms`,
  );
  lines.push(`  metric effective LOC: ${advisory.metricDefinitions.effectiveLoc}`);
  lines.push(`  metric bytes: ${advisory.metricDefinitions.bytes}`);
  lines.push(
    `  metric complexity: ${advisory.complexityMetric.name} v${advisory.complexityMetric.version} -- ${advisory.complexityMetric.definition}`,
  );
  for (const section of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, section, renderRow);
  }
  return lines.join("\n");
}

function renderRow(row: BirthSizeDeltaRow): readonly string[] {
  return [
    `#${row.rank} ${row.path} effective LOC ${formatMetric(
      row.effectiveLoc,
    )}; bytes ${formatMetric(row.bytes)}`,
    `complexity ${BRANCH_POINTS_METRIC_NAME} v${BRANCH_POINTS_METRIC_VERSION}: ${formatMetric(
      row.complexity.branchPoints,
    )}`,
    `top branch-points (current): ${formatTopFunctions(row.complexity)}`,
    `birth: ${row.birth.commit} @ ${row.birth.authorDate} by ${row.birth.authorName} <${row.birth.authorEmail}> -- ${row.birth.subject}`,
    `birth-burst: ${row.birthBurst.fileCount} file(s), ${formatNullable(
      row.birthBurst.linesAdded,
    )} added line(s)`,
    `churn since observed birth: ${row.churnSinceBirth.commits} commit(s), ${formatNullable(
      row.churnSinceBirth.linesChanged,
    )} changed line(s)`,
    `birth blob: ${formatBlob(row.birthBlob.available, row.birthBlob.reason)}; current blob: ${formatBlob(
      row.currentBlob.available,
      row.currentBlob.reason,
    )}`,
    `caveats: ${row.caveats.length === 0 ? "none" : row.caveats.join(" | ")}`,
    `blob: ${row.blobCommand}`,
    `inspect: ${row.inspectCommand}`,
  ];
}

function formatMetric(metric: BirthSizeDeltaMetric): string {
  return `${formatNullable(metric.birth)} -> ${formatNullable(metric.current)} (${formatDelta(
    metric.delta,
  )})`;
}

function formatDelta(value: number | null): string {
  if (value === null) return "delta n/a";
  return `delta ${value >= 0 ? "+" : ""}${value}`;
}

function formatNullable(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatBlob(available: boolean, reason: string | null): string {
  if (available) return "available";
  return reason === null ? "unavailable" : `unavailable (${reason})`;
}

function formatTopFunctions(complexity: BirthSizeDeltaComplexity): string {
  if (complexity.topFunctions.length > 0) {
    return complexity.topFunctions
      .map((fn) => `${fn.name}:${fn.line} (${fn.branchPoints})`)
      .join(", ");
  }
  return complexity.currentParsed ? "none" : "n/a";
}
