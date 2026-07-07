import type { LogsAuditReport } from "../logs-audit.js";

const JSON_FORMAT_INDENT_SPACES = 2;
// A URL query-param finding sets `field` to `<urlField>?<param>` (e.g.
// `req.url?refresh_token`); LOGGER_REDACT_PATHS cannot touch strings inside a
// URL, so those must route through redactUrlForLogs — which may itself need
// extending for the flagged spelling. Object-field findings use dotted paths
// and are fixed by adding the path to LOGGER_REDACT_PATHS.
const REDACTION_REMEDY_URL =
  "Fix: redact this URL via redactUrlForLogs in packages/server/src/app.ts (extend it to cover this parameter spelling if it slips through).";
const REDACTION_REMEDY_FIELD =
  "Fix: add this field path to LOGGER_REDACT_PATHS in packages/server/src/app.ts.";

type LogsAuditFinding = LogsAuditReport["findings"][number];

function isUrlParamFinding(finding: LogsAuditFinding): boolean {
  // Discriminate on the producer's stable message shape rather than the field
  // string: inspectUrl is the only source of "sensitive query parameter"
  // findings, so this cannot be tripped by an object key that contains "?".
  return finding.message.startsWith("sensitive query parameter");
}

function formatFindingMessage(finding: LogsAuditFinding): string {
  if (finding.check !== "redaction") return finding.message;
  const remedy = isUrlParamFinding(finding) ? REDACTION_REMEDY_URL : REDACTION_REMEDY_FIELD;
  return `${finding.message}. ${remedy}`;
}

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
    lines.push(
      `ERROR ${finding.check}: ${finding.file}${line}${field} - ${formatFindingMessage(finding)}`,
    );
  }
  return lines.join("\n");
}

export function formatJson(report: LogsAuditReport): string {
  return JSON.stringify(report, null, JSON_FORMAT_INDENT_SPACES);
}
