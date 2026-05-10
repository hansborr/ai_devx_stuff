#!/usr/bin/env bun
// Read-only JSONL log quality audit.
//
// The audit stays deterministic: callers pass one or more log files, and the
// script reports parse failures, request/event field drift, and obvious
// unredacted sensitive fields without retaining raw record payloads.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type LogsAuditFormat = "text" | "json";

export type LogsAuditOptions = {
  readonly files: readonly string[];
  readonly format: LogsAuditFormat;
};

export type LogsAuditFindingCheck = "input" | "jsonl" | "redaction" | "request-id" | "event-fields";

export type LogsAuditFinding = {
  readonly check: LogsAuditFindingCheck;
  readonly file: string;
  readonly line?: number;
  readonly field?: string;
  readonly message: string;
};

export type LogsAuditFileSummary = {
  readonly file: string;
  readonly totalLines: number;
  readonly records: number;
  readonly rejectedLines: number;
};

export type LogsAuditReport = {
  readonly files: readonly LogsAuditFileSummary[];
  readonly findings: readonly LogsAuditFinding[];
};

export type LogFileReader = (filePath: string) => string;

class LogsAuditHelp extends Error {
  constructor() {
    super(usage());
    this.name = "LogsAuditHelp";
  }
}

export class LogsAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogsAuditError";
  }
}

type JsonObject = Record<string, unknown>;

interface ParsedLogRecord {
  readonly line: number;
  readonly value: JsonObject;
}

interface RequestIdCandidate {
  readonly field: string;
  readonly value: unknown;
}

interface RequestIdAuditContext {
  readonly line: number;
  readonly event?: string;
  readonly requestId?: string;
  readonly hasRequestEnvelope: boolean;
  readonly findings: readonly LogsAuditFinding[];
}

const REDACTED_STRINGS = new Set(["[redacted]", "redacted", "<redacted>", "***"]);

const STABLE_EVENT_VALUE = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-z][a-zA-Z0-9]*)*$/u;
const MAX_STABLE_EVENT_VALUE_LENGTH = 80;
const AUTHZ_OUTCOMES = new Set(["allow", "deny"]);
const MUTATION_OUTCOMES = new Set(["success", "failure"]);
const BROADCAST_OUTCOMES = new Set(["success", "skipped"]);

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "authorization",
  "body",
  "cookie",
  "cookies",
  "input",
  "password",
  "rawbody",
  "refreshtoken",
  "setcookie",
  "token",
]);

const SENSITIVE_FIELD_PATHS = new Set(
  [
    "chat.content",
    "chat.message.content",
    "chat.whisper.content",
    "message.content",
    "payload.content",
    "payload.message.content",
    "whisper.content",
    "whisper.message",
  ].map(normalizedFieldPath),
);

const SENSITIVE_QUERY_PARAMS = new Set([
  "accesstoken",
  "authorization",
  "cookie",
  "input",
  "password",
  "refreshtoken",
  "token",
]);

const URL_FIELD_KEYS = new Set(["url", "requesturl"]);

function usage(): string {
  return [
    "Usage:",
    "  bun run logs:audit --file <server.jsonl> [--file <more.jsonl>]",
    "  bun run logs:audit <server.jsonl> [more.jsonl...]",
    "  bun run logs:audit --format <text|json> --file <server.jsonl>",
    "",
    "Read-only. Exits 1 when the audited logs contain findings.",
  ].join("\n");
}

function readOptionValue(
  arg: string,
  argv: readonly string[],
  index: number,
): {
  readonly value: string;
  readonly nextIndex: number;
} {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined) throw new LogsAuditError(`${arg} requires a value.\n${usage()}`);
  return { value: next, nextIndex: index + 1 };
}

export function parseArgs(argv: readonly string[]): LogsAuditOptions {
  const files: string[] = [];
  let format: LogsAuditFormat = "text";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new LogsAuditError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") {
      throw new LogsAuditHelp();
    }
    if (arg === "--file" || arg.startsWith("--file=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new LogsAuditError("--file requires a path.");
      files.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (parsed.value !== "text" && parsed.value !== "json") {
        throw new LogsAuditError("--format requires text or json.");
      }
      format = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new LogsAuditError(`Unknown argument: ${arg}\n${usage()}`);
    }
    files.push(arg);
  }

  if (files.length === 0) {
    throw new LogsAuditError(`logs:audit requires at least one log file.\n${usage()}`);
  }
  return { files, format };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): unknown {
  return JSON.parse(line) as unknown;
}

function normalizedKey(key: string): string {
  return key.replace(/[-_]/gu, "").toLowerCase();
}

function normalizedFieldPath(field: string): string {
  return field
    .replace(/\[\d+\]/gu, "[]")
    .split(".")
    .map(normalizedKey)
    .join(".");
}

function isSensitiveField(field: string, key: string): boolean {
  return (
    SENSITIVE_KEYS.has(normalizedKey(key)) || SENSITIVE_FIELD_PATHS.has(normalizedFieldPath(field))
  );
}

function isUrlFieldKey(key: string): boolean {
  return URL_FIELD_KEYS.has(normalizedKey(key));
}

function isRedactedString(value: string): boolean {
  return REDACTED_STRINGS.has(value.trim().toLowerCase());
}

function isRedactedValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return isRedactedString(value);
}

function pathFor(parent: string, key: string): string {
  return parent.length === 0 ? key : `${parent}.${key}`;
}

function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function redactionFinding(
  file: string,
  line: number,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "redaction", file, line, field, message };
}

function requestIdFinding(
  file: string,
  line: number,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "request-id", file, line, field, message };
}

function eventFieldsFinding(
  file: string,
  line: number,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "event-fields", file, line, field, message };
}

function inspectUrl(file: string, line: number, field: string, value: string): LogsAuditFinding[] {
  const findings: LogsAuditFinding[] = [];
  try {
    const url = new URL(value, "http://musi.local");
    for (const [param, paramValue] of url.searchParams) {
      if (!SENSITIVE_QUERY_PARAMS.has(normalizedKey(param))) continue;
      if (isRedactedString(paramValue)) continue;
      findings.push(
        redactionFinding(
          file,
          line,
          `${field}?${param}`,
          `sensitive query parameter '${param}' is not redacted`,
        ),
      );
    }
  } catch {
    // Non-URL strings are common in log fields; they are not audit findings.
  }
  return findings;
}

function inspectValue(
  file: string,
  line: number,
  field: string,
  key: string,
  value: unknown,
): LogsAuditFinding[] {
  if (isSensitiveField(field, key)) {
    if (isRedactedValue(value)) return [];
    return [redactionFinding(file, line, field, `sensitive field '${field}' is not redacted`)];
  }

  const findings: LogsAuditFinding[] =
    isUrlFieldKey(key) && typeof value === "string" ? inspectUrl(file, line, field, value) : [];
  return findings.concat(inspectRedaction(file, line, value, field));
}

function inspectRedaction(
  file: string,
  line: number,
  value: unknown,
  parent = "",
): LogsAuditFinding[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      inspectRedaction(file, line, item, indexPath(parent, index)),
    );
  }
  if (!isJsonObject(value)) return [];

  const findings: LogsAuditFinding[] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = pathFor(parent, key);
    findings.push(...inspectValue(file, line, field, key, item));
  }
  return findings;
}

function nestedField(record: JsonObject, field: string, nested: string): unknown {
  const parent = record[field];
  return isJsonObject(parent) ? parent[nested] : undefined;
}

function requestIdCandidates(record: JsonObject): RequestIdCandidate[] {
  return [
    { field: "reqId", value: record["reqId"] },
    { field: "requestId", value: record["requestId"] },
    { field: "req.id", value: nestedField(record, "req", "id") },
    { field: "request.id", value: nestedField(record, "request", "id") },
  ].filter((candidate) => candidate.value !== undefined);
}

function businessEventName(record: JsonObject): string | undefined {
  const event = record["event"];
  if (typeof event !== "string") return undefined;
  if (event.startsWith("script.")) return undefined;
  return event;
}

function hasRequestEnvelope(record: JsonObject): boolean {
  return isJsonObject(record["req"]) || isJsonObject(record["request"]);
}

function extractRequestId(
  file: string,
  line: number,
  record: JsonObject,
): {
  readonly requestId?: string;
  readonly findings: readonly LogsAuditFinding[];
} {
  const findings: LogsAuditFinding[] = [];
  const values: string[] = [];
  for (const candidate of requestIdCandidates(record)) {
    if (typeof candidate.value === "string" && candidate.value.length > 0) {
      values.push(candidate.value);
      continue;
    }
    findings.push(requestIdFinding(file, line, candidate.field, "request id must be a string"));
  }

  const [requestId] = values;
  if (requestId === undefined) return { findings };
  if (values.some((value) => value !== requestId)) {
    findings.push(requestIdFinding(file, line, "requestId", "request id fields disagree"));
    return { findings };
  }
  return { requestId, findings };
}

function requestIdAuditContext(file: string, record: ParsedLogRecord): RequestIdAuditContext {
  const extracted = extractRequestId(file, record.line, record.value);
  return {
    line: record.line,
    event: businessEventName(record.value),
    requestId: extracted.requestId,
    hasRequestEnvelope: hasRequestEnvelope(record.value),
    findings: extracted.findings,
  };
}

function auditRequestIds(file: string, records: readonly ParsedLogRecord[]): LogsAuditFinding[] {
  const contexts = records.map((record) => requestIdAuditContext(file, record));
  const requestLogIds = new Set(
    contexts
      .filter((context) => context.event === undefined && context.hasRequestEnvelope)
      .flatMap((context) => (context.requestId === undefined ? [] : [context.requestId])),
  );

  const findings: LogsAuditFinding[] = contexts.flatMap((context) => context.findings);
  for (const context of contexts) {
    if (context.event === undefined) continue;
    if (context.requestId === undefined) {
      findings.push(
        requestIdFinding(
          file,
          context.line,
          "requestId",
          "business event log is missing a request id",
        ),
      );
      continue;
    }
    if (requestLogIds.size > 0 && !requestLogIds.has(context.requestId)) {
      findings.push(
        requestIdFinding(
          file,
          context.line,
          "requestId",
          "business event request id has no matching request log",
        ),
      );
    }
  }
  return findings;
}

function isStableEventValue(value: string): boolean {
  return value.length <= MAX_STABLE_EVENT_VALUE_LENGTH && STABLE_EVENT_VALUE.test(value);
}

function requiredStringField(
  file: string,
  line: number,
  record: JsonObject,
  field: string,
  message: string,
): {
  readonly value?: string;
  readonly findings: readonly LogsAuditFinding[];
} {
  const value = record[field];
  if (typeof value === "string" && value.length > 0) return { value, findings: [] };
  return { findings: [eventFieldsFinding(file, line, field, message)] };
}

function auditStableField(
  file: string,
  line: number,
  field: string,
  value: string,
): LogsAuditFinding[] {
  if (isStableEventValue(value)) return [];
  return [eventFieldsFinding(file, line, field, `${field} must be a stable low-cardinality code`)];
}

function auditAllowedField(
  file: string,
  line: number,
  field: string,
  value: string,
  allowed: ReadonlySet<string>,
  message: string,
): LogsAuditFinding[] {
  if (allowed.has(value)) return [];
  return [eventFieldsFinding(file, line, field, message)];
}

function auditReasonField(
  file: string,
  line: number,
  record: JsonObject,
  required: boolean,
  requiredMessage: string,
): LogsAuditFinding[] {
  const reason = record["reason"];
  if (reason === undefined) {
    return required ? [eventFieldsFinding(file, line, "reason", requiredMessage)] : [];
  }
  if (typeof reason !== "string" || reason.length === 0) {
    return [eventFieldsFinding(file, line, "reason", "reason must be a string")];
  }
  return auditStableField(file, line, "reason", reason);
}

function auditActorField(
  file: string,
  line: number,
  record: JsonObject,
  required: boolean,
): LogsAuditFinding[] {
  const actor = record["actor"];
  if (actor === undefined && !required) return [];
  if (!isJsonObject(actor)) {
    return [eventFieldsFinding(file, line, "actor", "actor is required with userId")];
  }
  if (typeof actor["userId"] === "string" && actor["userId"].length > 0) return [];
  return [eventFieldsFinding(file, line, "actor.userId", "actor.userId must be a string")];
}

function auditAuthzFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  return [
    ...auditAllowedField(
      file,
      record.line,
      "outcome",
      outcome,
      AUTHZ_OUTCOMES,
      "authz outcome must be allow or deny",
    ),
    ...auditActorField(file, record.line, record.value, true),
    ...auditReasonField(
      file,
      record.line,
      record.value,
      outcome === "deny",
      "reason is required for deny outcomes",
    ),
  ];
}

function auditMutationFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  return [
    ...auditAllowedField(
      file,
      record.line,
      "outcome",
      outcome,
      MUTATION_OUTCOMES,
      "mutation outcome must be success or failure",
    ),
    ...auditActorField(file, record.line, record.value, false),
    ...auditReasonField(
      file,
      record.line,
      record.value,
      outcome === "failure",
      "reason is required for failure outcomes",
    ),
  ];
}

function auditSocketBroadcastFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  const socketEvent = requiredStringField(
    file,
    record.line,
    record.value,
    "socketEvent",
    "socketEvent is required for socket.broadcast",
  );
  return [
    ...auditAllowedField(
      file,
      record.line,
      "outcome",
      outcome,
      BROADCAST_OUTCOMES,
      "socket.broadcast outcome must be success or skipped",
    ),
    ...(socketEvent.value === undefined
      ? socketEvent.findings
      : auditStableField(file, record.line, "socketEvent", socketEvent.value)),
    ...auditReasonField(
      file,
      record.line,
      record.value,
      outcome === "skipped",
      "reason is required for skipped outcomes",
    ),
  ];
}

function auditBusinessEventFields(
  file: string,
  record: ParsedLogRecord,
  event: string,
): LogsAuditFinding[] {
  const outcome = requiredStringField(
    file,
    record.line,
    record.value,
    "outcome",
    "outcome is required for business events",
  );
  const findings = auditStableField(file, record.line, "event", event);
  if (outcome.value === undefined) return findings.concat(outcome.findings);
  if (event.startsWith("authz.")) {
    return findings.concat(auditAuthzFields(file, record, outcome.value));
  }
  if (event === "socket.broadcast") {
    return findings.concat(auditSocketBroadcastFields(file, record, outcome.value));
  }
  return findings.concat(auditMutationFields(file, record, outcome.value));
}

function auditEventFields(file: string, records: readonly ParsedLogRecord[]): LogsAuditFinding[] {
  const findings: LogsAuditFinding[] = [];
  for (const record of records) {
    const event = record.value["event"];
    if (event === undefined) continue;
    if (typeof event !== "string" || event.length === 0) {
      findings.push(eventFieldsFinding(file, record.line, "event", "event must be a string"));
      continue;
    }
    if (event.startsWith("script.")) continue;
    findings.push(...auditBusinessEventFields(file, record, event));
  }
  return findings;
}

export function auditJsonlText(file: string, contents: string): LogsAuditReport {
  const lines = contents.split(/\r?\n/u);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

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
      parsed = parseJsonLine(line);
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

export function formatText(report: LogsAuditReport): string {
  const lines: string[] = [];
  lines.push(`logs:audit: ${report.files.length} file(s) audited`);
  for (const file of report.files) {
    lines.push(`  ${file.file}: ${file.records} record(s), ${file.rejectedLines} rejected line(s)`);
  }
  if (report.findings.length === 0) {
    lines.push(
      "OK: JSONL parsed and sensitive fields are redacted; request ids correlate and event fields are stable.",
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    const line = finding.line === undefined ? "" : `:${finding.line}`;
    const field = finding.field === undefined ? "" : ` ${finding.field}`;
    lines.push(`ERROR ${finding.check}: ${finding.file}${line}${field} - ${finding.message}`);
  }
  return lines.join("\n");
}

export function formatJson(report: LogsAuditReport): string {
  return JSON.stringify(report, null, 2);
}

export type RunLogsAuditOptions = {
  readonly argv: readonly string[];
  readonly readFile?: LogFileReader;
};

export type RunLogsAuditResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: LogsAuditReport;
};

export function runLogsAudit(options: RunLogsAuditOptions): RunLogsAuditResult {
  let parsed: LogsAuditOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    if (err instanceof LogsAuditHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof LogsAuditError) return { exitCode: 2, stdout: err.message };
    throw err;
  }

  const report = auditLogFiles(parsed.files, options.readFile);
  const stdout = parsed.format === "json" ? formatJson(report) : formatText(report);
  return {
    exitCode: report.findings.length === 0 ? 0 : 1,
    stdout,
    report,
  };
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runLogsAudit({ argv: process.argv.slice(2) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
