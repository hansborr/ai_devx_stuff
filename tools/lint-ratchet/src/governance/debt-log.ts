import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_DEBT_LOG_FILENAME, relativeToRepoRoot } from "../kernel/engine-context.js";
import { escapeMarkdownTableCell } from "../kernel/markdown-escape.js";
import { assertNever } from "../kernel/runtime-config.js";
import { parseDebtLogJsonl } from "./debt-log-jsonl.js";
import {
  type LintRatchetAcceptedDebtLogEntry,
  type LintRatchetDebtLogEntry,
} from "./debt-log-schema.js";

// Read-only markdown renderer for the committed debt log, mirroring
// report.ts. It touches neither the check path nor the verify cache
// and never throws on a clean tree (the log only exists once debt is accepted).

const STICKY_COMMENT_MARKER = "<!-- lint-ratchet-debt-log -->";
const MAX_FREE_TEXT_LENGTH = 200;
const MAX_LABEL_LENGTH = 80;

type DebtLogRegression = LintRatchetAcceptedDebtLogEntry["regressions"][number];
type DebtLogOrphan = LintRatchetAcceptedDebtLogEntry["orphansRemoved"][number];
type DebtLogOrphanItem = DebtLogOrphan["baselineItems"][number];

interface RunLintRatchetDebtLogReportOptions {
  readonly repoRoot: string;
  readonly debtLogPath: string;
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

function isLegacyRemovalOnlyEntry(entry: LintRatchetDebtLogEntry): boolean {
  return (
    entry.kind === "accepted-debt" &&
    entry.regressions.length === 0 &&
    entry.orphansRemoved.length > 0
  );
}

function isAcceptedDebtRecord(entry: LintRatchetDebtLogEntry): boolean {
  switch (entry.kind) {
    case "accepted-debt":
      return !isLegacyRemovalOnlyEntry(entry);
    case "coverage-shrink":
      return true;
    case "metric-migration":
    case "retirement":
      return false;
    default:
      return assertNever(entry);
  }
}

function isRetirementRecord(entry: LintRatchetDebtLogEntry): boolean {
  switch (entry.kind) {
    case "accepted-debt":
      return isLegacyRemovalOnlyEntry(entry);
    case "retirement":
      return true;
    case "coverage-shrink":
    case "metric-migration":
      return false;
    default:
      return assertNever(entry);
  }
}

function formatEntrySection(entry: LintRatchetDebtLogEntry, index: number): readonly string[] {
  switch (entry.kind) {
    case "retirement": {
      const lines = [
        `#### Retirement ${String(index + 1)}`,
        "",
        `Ratchet: ${cell(entry.ratchetId)}`,
        "",
        "Promotion proof: normal lint error coverage.",
        "",
      ];
      if (entry.optionsAttestation !== undefined) {
        lines.push(
          `Options attestation: ${cell(entry.optionsAttestation.reason)}`,
          "",
          `Ratchet options: ${cell(JSON.stringify(entry.optionsAttestation.ratchetOptions))}`,
          "",
          `Normal lint options: ${cell(JSON.stringify(entry.optionsAttestation.normalLintOptions))}`,
          "",
        );
      }
      return lines;
    }
    case "metric-migration":
      return [
        `#### Metric migration ${String(index + 1)}`,
        "",
        `Ratchet: ${cell(entry.ratchetId)}`,
        "",
        `Metric: ${entry.fromMetric} → ${entry.toMetric}`,
        "",
        `Reason: ${cell(entry.reason)}`,
        "",
      ];
    case "coverage-shrink":
      return [
        `#### Coverage shrink ${String(index + 1)}`,
        "",
        `Ratchet: ${cell(entry.ratchetId)}`,
        "",
        `Removed paths: ${cell(entry.removedPaths.join(", "))}`,
        "",
        `Files: ${cell(JSON.stringify(entry.previousFiles))} → ${cell(JSON.stringify(entry.currentFiles))}`,
        "",
        `Ignores: ${cell(JSON.stringify(entry.previousIgnores))} → ${cell(JSON.stringify(entry.currentIgnores))}`,
        "",
        `Reason: ${cell(entry.reason)}`,
        "",
      ];
    case "accepted-debt": {
      const heading = isLegacyRemovalOnlyEntry(entry) ? "Legacy retirement/removal" : "Acceptance";
      const lines = [
        `#### ${heading} ${String(index + 1)}`,
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
    default:
      return assertNever(entry);
  }
}

export function formatLintRatchetDebtLogReport(
  entries: readonly LintRatchetDebtLogEntry[],
): string {
  const acceptedDebtCount = entries.filter(isAcceptedDebtRecord).length;
  const retirementCount = entries.filter(isRetirementRecord).length;
  const lines = [
    STICKY_COMMENT_MARKER,
    "### Lint ratchet debt log",
    "",
    `Accepted-debt records: ${String(acceptedDebtCount)}`,
    `Retirement/removal records: ${String(retirementCount)}`,
    "",
  ];
  if (entries.length === 0) {
    lines.push("No debt acceptances recorded yet. (clean)", "");
  } else {
    for (const [index, entry] of entries.entries()) lines.push(...formatEntrySection(entry, index));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function readLintRatchetDebtLog(
  contents: string,
  debtLogName: string = DEFAULT_DEBT_LOG_FILENAME,
): readonly LintRatchetDebtLogEntry[] {
  return parseDebtLogJsonl(contents, debtLogName);
}

export function runLintRatchetDebtLogReport(options: RunLintRatchetDebtLogReportOptions): string {
  const path = options.debtLogPath;
  if (!existsSync(path)) return formatLintRatchetDebtLogReport([]);
  const debtLogName = relativeToRepoRoot(options.repoRoot, path);
  return formatLintRatchetDebtLogReport(
    readLintRatchetDebtLog(readFileSync(path, "utf8"), debtLogName),
  );
}
