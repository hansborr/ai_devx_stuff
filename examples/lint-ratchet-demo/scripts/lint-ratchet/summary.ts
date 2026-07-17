import { readFileSync } from "node:fs";

import { type LintRatchetBaseline, parseLintRatchetBaselineStructure } from "./baseline.js";
import type {
  LintRatchetConfig,
  LintRatchetMetric,
  LintRatchetMode,
} from "./lint-ratchet-config.js";
import { ConfigError } from "./metrics.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
const DEBT_FILES_HEADER = "debt files";

export interface LintRatchetSummaryRow {
  readonly id: string;
  readonly ruleId: string;
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly fileCount: number;
  readonly totalFindings: number;
}

export interface LintRatchetDirectorySummaryRow {
  readonly id: string;
  readonly ruleId: string;
  readonly metric: LintRatchetMetric;
  readonly directory: string;
  readonly fileCount: number;
  readonly totalFindings: number;
}

interface LintRatchetSummaryColumnWidths {
  readonly ratchet: number;
  readonly rule: number;
  readonly metric: number;
  readonly directory?: number;
  readonly files: number;
  readonly findings: number;
}

interface RunLintRatchetSummaryOptions {
  readonly baselinePath: string;
  readonly registry: readonly LintRatchetConfig[];
  readonly byDirectoryDepth?: number | undefined;
}

interface LintRatchetSummaryCells {
  readonly ratchet: string;
  readonly rule: string;
  readonly metric: string;
  readonly directory?: string;
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

function directoryForPath(path: string, depth: number): string {
  const parts = path.split("/");
  if (parts.length <= 1) return ".";
  return parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

function directoryRowsForTest(
  id: string,
  test: LintRatchetBaselineTest,
  depth: number,
): readonly LintRatchetDirectorySummaryRow[] {
  const byDirectory = new Map<string, { fileCount: number; totalFindings: number }>();
  for (const [path, item] of Object.entries(test.items)) {
    const directory = directoryForPath(path, depth);
    const previous = byDirectory.get(directory) ?? { fileCount: 0, totalFindings: 0 };
    byDirectory.set(directory, {
      fileCount: previous.fileCount + 1,
      totalFindings: previous.totalFindings + item.count,
    });
  }
  return [...byDirectory.entries()]
    .map(([directory, totals]) => ({
      id,
      ruleId: test.ruleId,
      metric: test.metric,
      directory,
      fileCount: totals.fileCount,
      totalFindings: totals.totalFindings,
    }))
    .sort(
      (left, right) =>
        right.totalFindings - left.totalFindings || left.directory.localeCompare(right.directory),
    );
}

export function summarizeLintRatchetBaselineByDirectory(
  baseline: LintRatchetBaseline,
  registry: readonly LintRatchetConfig[],
  depth: number,
): readonly LintRatchetDirectorySummaryRow[] {
  const registryIds = new Set(registry.map((ratchet) => ratchet.id));
  const rows: LintRatchetDirectorySummaryRow[] = [];
  for (const ratchet of registry) {
    const test = baseline.tests[ratchet.id];
    if (test !== undefined) rows.push(...directoryRowsForTest(ratchet.id, test, depth));
  }
  const orphanIds = Object.keys(baseline.tests)
    .filter((id) => !registryIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  for (const id of orphanIds) {
    const test = baseline.tests[id];
    if (test !== undefined) rows.push(...directoryRowsForTest(id, test, depth));
  }
  return rows;
}

function maxLength(values: readonly string[]): number {
  return Math.max(...values.map((value) => value.length));
}

function summaryColumnWidths(
  rows: readonly LintRatchetSummaryRow[],
): LintRatchetSummaryColumnWidths {
  const cells = rows.map(rowCells);
  return {
    ratchet: maxLength(["ratchet", ...cells.map((row) => row.ratchet)]),
    rule: maxLength(["rule", ...cells.map((row) => row.rule)]),
    metric: maxLength(["metric", ...cells.map((row) => row.metric)]),
    files: maxLength([DEBT_FILES_HEADER, ...rows.map((row) => String(row.fileCount))]),
    findings: maxLength(["findings", ...rows.map((row) => String(row.totalFindings))]),
  };
}

function formatRow(row: LintRatchetSummaryCells, widths: LintRatchetSummaryColumnWidths): string {
  const cells = [
    row.ratchet.padEnd(widths.ratchet),
    row.rule.padEnd(widths.rule),
    row.metric.padEnd(widths.metric),
  ];
  if (row.directory !== undefined && widths.directory !== undefined) {
    cells.push(row.directory.padEnd(widths.directory));
  }
  return [...cells, row.files.padStart(widths.files), row.findings.padStart(widths.findings)].join(
    "  ",
  );
}

// These CLIs render space-aligned plain-text tables for a terminal, not a
// markdown table (no `|` separators), so cells are passed through raw. Markdown
// escaping belongs at a render boundary, and this output has none; escaping here
// only litters ids/rules/dirs containing `_`, `-`, or `|` with stray backslashes.
function rowCells(row: LintRatchetSummaryRow): LintRatchetSummaryCells {
  return {
    ratchet: row.id,
    rule: row.ruleId,
    metric: row.metric,
    files: String(row.fileCount),
    findings: String(row.totalFindings),
  };
}

export function formatLintRatchetSummary(rows: readonly LintRatchetSummaryRow[]): string {
  const widths = summaryColumnWidths(rows);
  const header = formatRow(
    {
      ratchet: "ratchet",
      rule: "rule",
      metric: "metric",
      files: DEBT_FILES_HEADER,
      findings: "findings",
    },
    widths,
  );
  const body =
    rows.length === 0 ? ["(no ratchets)"] : rows.map((row) => formatRow(rowCells(row), widths));
  return `${[header, ...body].join("\n")}\n`;
}

function directorySummaryColumnWidths(
  rows: readonly LintRatchetDirectorySummaryRow[],
): LintRatchetSummaryColumnWidths {
  const cells = rows.map(directoryRowCells);
  return {
    ratchet: maxLength(["ratchet", ...cells.map((row) => row.ratchet)]),
    rule: maxLength(["rule", ...cells.map((row) => row.rule)]),
    metric: maxLength(["metric", ...cells.map((row) => row.metric)]),
    directory: maxLength(["directory", ...cells.map((row) => row.directory ?? "")]),
    files: maxLength([DEBT_FILES_HEADER, ...rows.map((row) => String(row.fileCount))]),
    findings: maxLength(["findings", ...rows.map((row) => String(row.totalFindings))]),
  };
}

function directoryRowCells(row: LintRatchetDirectorySummaryRow): LintRatchetSummaryCells {
  return {
    ratchet: row.id,
    rule: row.ruleId,
    metric: row.metric,
    directory: row.directory,
    files: String(row.fileCount),
    findings: String(row.totalFindings),
  };
}

export function formatLintRatchetDirectorySummary(
  rows: readonly LintRatchetDirectorySummaryRow[],
): string {
  const widths = directorySummaryColumnWidths(rows);
  const header = formatRow(
    {
      ratchet: "ratchet",
      rule: "rule",
      metric: "metric",
      directory: "directory",
      files: DEBT_FILES_HEADER,
      findings: "findings",
    },
    widths,
  );
  const body =
    rows.length === 0
      ? ["(no ratchet directories)"]
      : rows.map((row) => formatRow(directoryRowCells(row), widths));
  return `${[header, ...body].join("\n")}\n`;
}

function runLintRatchetSummary(options: RunLintRatchetSummaryOptions): string {
  const parsed = parseLintRatchetBaselineStructure(readFileSync(options.baselinePath, "utf8"));
  if (parsed.baseline === undefined) {
    throw new ConfigError(parsed.failures.join("\n"));
  }
  if (options.byDirectoryDepth !== undefined) {
    return formatLintRatchetDirectorySummary(
      summarizeLintRatchetBaselineByDirectory(
        parsed.baseline,
        options.registry,
        options.byDirectoryDepth,
      ),
    );
  }
  return formatLintRatchetSummary(summarizeLintRatchetBaseline(parsed.baseline, options.registry));
}

export function runLintRatchetSummaryCli(
  baselinePath: string,
  registry: readonly LintRatchetConfig[],
  byDirectoryDepth: number | undefined,
): void {
  process.stdout.write(runLintRatchetSummary({ baselinePath, registry, byDirectoryDepth }));
}
