import { formatFindingLines } from "./finding-lines.js";
import { DEFAULT_BASE, type DriftReport } from "./types.js";

function formatTextHeader(report: DriftReport): string[] {
  const lines: string[] = [];
  if (report.scopeMode === "changed") {
    const base = report.base ?? DEFAULT_BASE;
    const resolvedRef = report.resolvedRef ?? base;
    const refSuffix = resolvedRef === base ? "" : ` (resolved ${resolvedRef})`;
    lines.push(`drift:ai (report-only) -- scope changed -- base ${base}${refSuffix}`);
  } else {
    lines.push("drift:ai (report-only) -- scope current");
    lines.push(`  roots: ${report.roots.length === 0 ? "./" : report.roots.join(", ")}`);
  }
  lines.push(`  scope: ${report.scope.length} file(s) considered after ignore filters`);
  lines.push(`  ${formatSummary(report.summary)}`);
  if (report.skippedChecks.length > 0) {
    lines.push(`  skipped: ${report.skippedChecks.map(formatSkippedCheck).join("; ")}`);
  }
  return lines;
}

function formatSkippedCheck(skip: DriftReport["skippedChecks"][number]): string {
  return `${skip.check} — ${skip.reason}`;
}

function formatSummary(summary: DriftReport["summary"]): string {
  const byCheck = Object.entries(summary.byCheck);
  if (byCheck.length === 0) return `findings: ${summary.total}`;
  return `findings: ${summary.total} (${byCheck
    .map(([check, count]) => `${check} ${count}`)
    .join(", ")})`;
}

export function formatText(report: DriftReport): string {
  const lines = formatTextHeader(report);
  if (report.findings.length === 0) {
    if (report.enabledChecks.length === 0) {
      lines.push(formatNothingToRun(report.skippedChecks));
    } else {
      lines.push(`OK: no findings from checks: ${report.enabledChecks.join(", ")}`);
    }
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(...formatFindingLines(finding));
  }
  return lines.join("\n");
}

function formatNothingToRun(skippedChecks: DriftReport["skippedChecks"]): string {
  if (
    skippedChecks.length === 0 ||
    skippedChecks.every((skip) => skip.reason === "check is not implemented")
  ) {
    return "drift:ai: no implemented checks selected.";
  }
  const [skip] = skippedChecks;
  if (skip !== undefined && skippedChecks.length === 1) {
    if (skip.check === "suppressions" && skip.reason === "only available in changed scope") {
      return `drift:ai: ${skip.check} is ${skip.reason}; nothing to run.`;
    }
    return `drift:ai: ${skip.check} was skipped: ${skip.reason}; nothing to run.`;
  }
  return "drift:ai: all requested checks were skipped; nothing to run.";
}

export type FormatJsonOptions = {
  readonly includeScope?: boolean;
};

export function formatJson(report: DriftReport, options: FormatJsonOptions = {}): string {
  const payloadWithoutScope = {
    schemaVersion: report.schemaVersion,
    scopeMode: report.scopeMode,
    base: report.base,
    resolvedRef: report.resolvedRef,
    roots: report.roots,
    configPath: report.configPath,
    enabledChecks: report.enabledChecks,
    skippedChecks: report.skippedChecks,
    summary: report.summary,
    findings: report.findings,
    scopeCount: report.scopeCount,
  };
  const payload = options.includeScope
    ? { ...payloadWithoutScope, scope: report.scope }
    : payloadWithoutScope;
  return JSON.stringify(payload, null, 2);
}
