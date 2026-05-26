// Request-ID correlation auditing for the logs-audit script.

import type { LogsAuditFinding } from "./logs-audit.js";
import type { ParsedLogRecord } from "./logs-audit-checks.js";
import { isJsonObject } from "./logs-audit-redaction.js";

type JsonObject = Record<string, unknown>;

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

function requestIdFinding(
  file: string,
  line: number,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "request-id", file, line, field, message };
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

export function auditRequestIds(
  file: string,
  records: readonly ParsedLogRecord[],
): LogsAuditFinding[] {
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
