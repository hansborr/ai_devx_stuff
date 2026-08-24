import { readFileSync } from "node:fs";

import { isRecord as isJsonObject } from "../lib/records.js";
import { auditEventFields, auditRequestIds, inspectRedaction } from "./logs-audit-checks.js";
import type {
  LogFileReader,
  LogsAuditFinding,
  LogsAuditReport,
  ParsedLogRecord,
} from "./logs-audit-types.js";

export function auditJsonlText(file: string, contents: string): LogsAuditReport {
  const lines = contents.split(/\r?\n/u);
  // Drop every trailing empty split element, not just one: a file ending in
  // "\n\n" is benign trailing slop, not an empty record. Interior empty lines
  // survive and are still flagged below. Deliberately the opposite of the
  // debt log's strict reader (tools/lint-ratchet/src/governance/debt-log-jsonl.ts), which
  // tolerates exactly one trailing newline in its tool-written log.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const findings: LogsAuditFinding[] = [];
  const parsedRecords: ParsedLogRecord[] = [];
  let records = 0;
  let rejectedLines = 0;

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line.length === 0) {
      rejectedLines += 1;
      findings.push({
        check: "jsonl",
        file,
        line: lineNumber,
        message: "line is empty",
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejectedLines += 1;
      findings.push({
        check: "jsonl",
        file,
        line: lineNumber,
        message: "line is not valid JSON",
      });
      continue;
    }
    if (!isJsonObject(parsed)) {
      rejectedLines += 1;
      findings.push({
        check: "jsonl",
        file,
        line: lineNumber,
        message: "JSONL record must be an object",
      });
      continue;
    }
    records += 1;
    parsedRecords.push({ line: lineNumber, value: parsed });
    findings.push(...inspectRedaction(file, lineNumber, parsed));
  }
  findings.push(...auditRequestIds(file, parsedRecords), ...auditEventFields(file, parsedRecords));

  return {
    files: [{ file, totalLines: lines.length, records, rejectedLines }],
    findings,
  };
}

function mergeReports(reports: readonly LogsAuditReport[]): LogsAuditReport {
  return {
    files: reports.flatMap((report) => report.files),
    findings: reports.flatMap((report) => report.findings),
  };
}

export function auditLogFiles(
  files: readonly string[],
  readFile: LogFileReader = (filePath) => readFileSync(filePath, "utf8"),
): LogsAuditReport {
  const reports: LogsAuditReport[] = [];
  const findings: LogsAuditFinding[] = [];
  for (const file of files) {
    try {
      reports.push(auditJsonlText(file, readFile(file)));
    } catch {
      findings.push({
        check: "input",
        file,
        message: "could not read log file",
      });
    }
  }
  const merged = mergeReports(reports);
  return {
    files: merged.files,
    findings: [...merged.findings, ...findings],
  };
}
