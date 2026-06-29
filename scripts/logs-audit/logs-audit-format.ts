import type { LogsAuditReport } from "../logs-audit.js";

const JSON_FORMAT_INDENT_SPACES = 2;

export function formatText(report: LogsAuditReport): string {
  const lines: string[] = [];
  lines.push(`logs:audit: ${String(report.files.length)} file(s) audited`);
  for (const file of report.files) {
    lines.push(
      `  ${file.file}: ${String(file.records)} record(s), ${String(file.rejectedLines)} rejected line(s)`,
    );
  }
  if (report.findings.length === 0) {
    lines.push(
      "OK: JSONL parsed and sensitive fields are redacted; request ids correlate and event fields are stable.",
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    const line = finding.line === undefined ? "" : `:${String(finding.line)}`;
    const field = finding.field === undefined ? "" : ` ${finding.field}`;
    lines.push(`ERROR ${finding.check}: ${finding.file}${line}${field} - ${finding.message}`);
  }
  return lines.join("\n");
}

export function formatJson(report: LogsAuditReport): string {
  return JSON.stringify(report, null, JSON_FORMAT_INDENT_SPACES);
}
