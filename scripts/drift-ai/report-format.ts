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
  const timingLine = formatTimingLine(report);
  if (timingLine !== undefined) lines.push(`  ${timingLine}`);
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

// Evidence-only per-check wall-clock line, e.g.
// `timing: total 12ms (duplicates 3ms, comments 9ms)`. Omitted when the report
// carries no timings (a hand-built report or a run that dispatched nothing).
function formatTimingLine(report: DriftReport): string | undefined {
  const timings = report.checkTimings;
  if (timings === undefined || timings.length === 0) return undefined;
  const total = report.totalDurationMs ?? totalOf(timings);
  const perCheck = timings.map((timing) => `${timing.check} ${timing.durationMs}ms`).join(", ");
  return `timing: total ${total}ms (${perCheck})`;
}

function totalOf(timings: NonNullable<DriftReport["checkTimings"]>): number {
  return timings.reduce((sum, timing) => sum + timing.durationMs, 0);
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
  if (skippedChecks.length === 0) {
    return "drift:ai: no implemented checks selected.";
  }
  const [skip] = skippedChecks;
  if (skip !== undefined && skippedChecks.length === 1) {
    // Dispatch on the machine-readable code, never the reason prose: the reason
    // is presentation-only and may be reworded without changing which branch runs.
    if (skip.check === "suppressions" && skip.code === "changed-scope-only") {
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
  // Timing is additive evidence (schema v4): emit it only when the report carries
  // it, so a hand-built v3-shaped report still renders without the keys. Placed
  // between `summary` and `findings` to keep the run-metadata block together.
  const timing =
    report.checkTimings === undefined
      ? {}
      : {
          checkTimings: report.checkTimings,
          totalDurationMs: report.totalDurationMs ?? totalOf(report.checkTimings),
        };
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
    ...timing,
    findings: report.findings,
    scopeCount: report.scopeCount,
  };
  const payload = options.includeScope
    ? { ...payloadWithoutScope, scope: report.scope }
    : payloadWithoutScope;
  return JSON.stringify(payload, null, 2);
}
