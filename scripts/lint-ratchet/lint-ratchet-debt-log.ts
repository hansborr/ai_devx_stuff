import { existsSync, readFileSync } from "node:fs";

import { type LintRatchetDebtLogEntry, parseLintRatchetDebtLogEntry } from "./debt-log-schema.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { escapeMarkdownTableCell } from "./markdown-escape.js";
import { DEBT_LOG_FILENAME, debtLogPath } from "./paths.js";

// Read-only markdown renderer for the committed debt log, mirroring
// lint-ratchet-report.ts. It touches neither the check path nor the verify cache
// and never throws on a clean tree (the log only exists once debt is accepted).

const STICKY_COMMENT_MARKER = "<!-- lint-ratchet-debt-log -->";
const MAX_FREE_TEXT_LENGTH = 200;
const MAX_LABEL_LENGTH = 80;

type DebtLogRegression = LintRatchetDebtLogEntry["regressions"][number];
type DebtLogOrphan = LintRatchetDebtLogEntry["orphansRemoved"][number];
type DebtLogOrphanItem = DebtLogOrphan["baselineItems"][number];

interface RunLintRatchetDebtLogReportOptions {
  readonly debtLogPath?: string;
}

function capText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function cell(value: string, max = MAX_FREE_TEXT_LENGTH): string {
  return escapeMarkdownTableCell(capText(value, max));
}

function regressionDelta(regression: DebtLogRegression): string {
  if (regression.baselineLines !== undefined && regression.currentLines !== undefined) {
    return `${String(regression.baselineLines)} → ${String(regression.currentLines)} lines`;
  }
  if (regression.baselineComplexity !== undefined && regression.currentComplexity !== undefined) {
    return `complexity ${String(regression.baselineComplexity)} → ${String(regression.currentComplexity)}`;
  }
  return `${String(regression.baselineCount)} → ${String(regression.currentCount)}`;
}

function formatRegressionTable(regressions: readonly DebtLogRegression[]): readonly string[] {
  if (regressions.length === 0) return [];
  return [
    "| Ratchet | Rule | Path | Reason | Delta |",
    "| --- | --- | --- | --- | --- |",
    ...regressions.map(
      (regression) =>
        `| ${cell(regression.testId)} | ${cell(regression.ruleId)} | ${cell(regression.path)} | ${cell(regression.reason)} | ${cell(regressionDelta(regression))} |`,
    ),
  ];
}

function orphanItemDetail(item: DebtLogOrphanItem): string {
  if (item.lines !== undefined) return `${String(item.lines)} lines`;
  if (item.maxComplexity !== undefined) {
    const top = item.perFunction?.[0];
    const label = top === undefined ? "" : ` (${capText(top.label, MAX_LABEL_LENGTH)})`;
    return `max complexity ${String(item.maxComplexity)}${label}`;
  }
  return "—";
}

function orphanRows(orphan: DebtLogOrphan): readonly string[] {
  if (orphan.baselineItems.length === 0) {
    return [
      `| ${cell(orphan.testId)} | ${cell(orphan.ruleId)} | ${cell(orphan.metric)} | — | 0 | — |`,
    ];
  }
  return orphan.baselineItems.map(
    (item) =>
      `| ${cell(orphan.testId)} | ${cell(orphan.ruleId)} | ${cell(orphan.metric)} | ${cell(item.path)} | ${String(item.count)} | ${cell(orphanItemDetail(item))} |`,
  );
}

function formatOrphanTable(orphansRemoved: readonly DebtLogOrphan[]): readonly string[] {
  if (orphansRemoved.length === 0) return [];
  return [
    "| Removed ratchet | Rule | Metric | Path | Count | Detail |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...orphansRemoved.flatMap((orphan) => orphanRows(orphan)),
  ];
}

function formatEntrySection(entry: LintRatchetDebtLogEntry, index: number): readonly string[] {
  const lines = [
    `#### Acceptance ${String(index + 1)}`,
    "",
    `Reason: ${cell(entry.acceptanceReason)}`,
    "",
  ];
  const regressionTable = formatRegressionTable(entry.regressions);
  if (regressionTable.length > 0) lines.push(...regressionTable, "");
  const orphanTable = formatOrphanTable(entry.orphansRemoved);
  if (orphanTable.length > 0) lines.push(...orphanTable, "");
  return lines;
}

export function formatLintRatchetDebtLogReport(
  entries: readonly LintRatchetDebtLogEntry[],
): string {
  const lines = [STICKY_COMMENT_MARKER, "### Lint ratchet debt log", ""];
  if (entries.length === 0) {
    lines.push("No debt acceptances recorded yet. (clean)", "");
  } else {
    for (const [index, entry] of entries.entries()) lines.push(...formatEntrySection(entry, index));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseDebtLogLine(line: string, lineNumber: number): LintRatchetDebtLogEntry {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new ConfigError(
      `${DEBT_LOG_FILENAME} line ${String(lineNumber)} is not valid JSON: ${message}`,
    );
  }
  const parsed = parseLintRatchetDebtLogEntry(value);
  if (parsed.entry === undefined) {
    throw new ConfigError(
      `${DEBT_LOG_FILENAME} line ${String(lineNumber)} is invalid:\n${parsed.failures.join("\n")}`,
    );
  }
  return parsed.entry;
}

export function readLintRatchetDebtLog(contents: string): readonly LintRatchetDebtLogEntry[] {
  const lines = contents.split(/\r?\n/u);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line, index) => parseDebtLogLine(line, index + 1));
}

export function runLintRatchetDebtLogReport(
  options: RunLintRatchetDebtLogReportOptions = {},
): string {
  const path = options.debtLogPath ?? debtLogPath;
  if (!existsSync(path)) return formatLintRatchetDebtLogReport([]);
  return formatLintRatchetDebtLogReport(readLintRatchetDebtLog(readFileSync(path, "utf8")));
}
