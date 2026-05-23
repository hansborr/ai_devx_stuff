import { readFileSync } from "node:fs";

import { parseLintRatchetBaselineStructure, type LintRatchetBaseline } from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig, LintRatchetMetric, LintRatchetMode } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

export interface LintRatchetSummaryRow {
  readonly id: string;
  readonly ruleId: string;
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly fileCount: number;
  readonly totalFindings: number;
}

interface LintRatchetSummaryColumnWidths {
  readonly ratchet: number;
  readonly rule: number;
  readonly metric: number;
  readonly files: number;
  readonly findings: number;
}

interface RunLintRatchetSummaryOptions {
  readonly baselinePath: string;
  readonly registry: readonly LintRatchetConfig[];
}

interface LintRatchetSummaryCells {
  readonly ratchet: string;
  readonly rule: string;
  readonly metric: string;
  readonly files: string;
  readonly findings: string;
}

function sumFindings(test: LintRatchetBaselineTest): number {
  return Object.values(test.items).reduce((total, item) => total + item.count, 0);
}

function rowForTest(id: string, test: LintRatchetBaselineTest): LintRatchetSummaryRow {
  return {
    id,
    ruleId: test.ruleId,
    mode: test.mode,
    metric: test.metric,
    fileCount: Object.keys(test.items).length,
    totalFindings: sumFindings(test),
  };
}

function rowForRatchet(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest | undefined,
): LintRatchetSummaryRow {
  if (test !== undefined) return rowForTest(ratchet.id, test);
  return {
    id: ratchet.id,
    ruleId: ratchet.ruleId,
    mode: ratchet.mode,
    metric: ratchet.metric,
    fileCount: 0,
    totalFindings: 0,
  };
}

export function summarizeLintRatchetBaseline(
  baseline: LintRatchetBaseline,
  registry: readonly LintRatchetConfig[],
): readonly LintRatchetSummaryRow[] {
  const registryIds = new Set(registry.map((ratchet) => ratchet.id));
  const rows = registry.map((ratchet) => rowForRatchet(ratchet, baseline.tests[ratchet.id]));
  const orphanIds = Object.keys(baseline.tests)
    .filter((id) => !registryIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  for (const id of orphanIds) {
    const test = baseline.tests[id];
    if (test !== undefined) rows.push(rowForTest(id, test));
  }
  return rows;
}

function maxLength(values: readonly string[]): number {
  return Math.max(...values.map((value) => value.length));
}

function summaryColumnWidths(
  rows: readonly LintRatchetSummaryRow[],
): LintRatchetSummaryColumnWidths {
  return {
    ratchet: maxLength(["ratchet", ...rows.map((row) => row.id)]),
    rule: maxLength(["rule", ...rows.map((row) => row.ruleId)]),
    metric: maxLength(["metric", ...rows.map((row) => row.metric)]),
    files: maxLength(["files", ...rows.map((row) => String(row.fileCount))]),
    findings: maxLength(["findings", ...rows.map((row) => String(row.totalFindings))]),
  };
}

function formatRow(
  row: LintRatchetSummaryCells,
  widths: LintRatchetSummaryColumnWidths,
): string {
  return [
    row.ratchet.padEnd(widths.ratchet),
    row.rule.padEnd(widths.rule),
    row.metric.padEnd(widths.metric),
    row.files.padStart(widths.files),
    row.findings.padStart(widths.findings),
  ].join("  ");
}

function rowCells(row: LintRatchetSummaryRow): LintRatchetSummaryCells {
  return {
    ratchet: row.id,
    rule: row.ruleId,
    metric: row.metric,
    files: String(row.fileCount),
    findings: String(row.totalFindings),
  };
}

export function formatLintRatchetSummary(
  rows: readonly LintRatchetSummaryRow[],
): string {
  const widths = summaryColumnWidths(rows);
  const header = formatRow(
    {
      ratchet: "ratchet",
      rule: "rule",
      metric: "metric",
      files: "files",
      findings: "findings",
    },
    widths,
  );
  const body = rows.length === 0 ? ["(no ratchets)"] : rows.map((row) => formatRow(rowCells(row), widths));
  return `${[header, ...body].join("\n")}\n`;
}

export function runLintRatchetSummary(
  options: RunLintRatchetSummaryOptions,
): string {
  const parsed = parseLintRatchetBaselineStructure(readFileSync(options.baselinePath, "utf8"));
  if (parsed.baseline === undefined) {
    throw new ConfigError(parsed.failures.join("\n"));
  }
  return formatLintRatchetSummary(
    summarizeLintRatchetBaseline(parsed.baseline, options.registry),
  );
}
