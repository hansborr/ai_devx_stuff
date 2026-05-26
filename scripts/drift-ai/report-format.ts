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
  if (report.skippedChecks.length > 0) {
    lines.push(`  skipped: ${report.skippedChecks.join(", ")} (not run for this scope)`);
  }
  return lines;
}

export function formatText(report: DriftReport): string {
  const lines = formatTextHeader(report);
  if (report.findings.length === 0) {
    if (report.enabledChecks.length === 0) {
      lines.push("drift:ai: no implemented checks selected.");
    } else {
      lines.push(`OK: no findings from checks: ${report.enabledChecks.join(", ")}`);
    }
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(`WARN ${finding.check}: ${finding.file} — ${finding.message}`);
    if (finding.hint) lines.push(`  FIX: ${finding.hint}`);
  }
  return lines.join("\n");
}

export function formatJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2);
}
