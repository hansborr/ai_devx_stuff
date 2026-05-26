// Business-event field convention auditing for the logs-audit script.

import type { LogsAuditFinding } from "./logs-audit.js";
import type { ParsedLogRecord } from "./logs-audit-checks.js";
import { isJsonObject } from "./logs-audit-redaction.js";

type JsonObject = Record<string, unknown>;

const STABLE_EVENT_VALUE = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-z][a-zA-Z0-9]*)*$/u;
const MAX_STABLE_EVENT_VALUE_LENGTH = 80;
const AUTHZ_OUTCOMES = new Set(["allow", "deny"]);
const MUTATION_OUTCOMES = new Set(["success", "failure"]);
const BROADCAST_OUTCOMES = new Set(["success", "skipped"]);

function eventFieldsFinding(
  file: string,
  line: number,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "event-fields", file, line, field, message };
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

export function auditEventFields(
  file: string,
  records: readonly ParsedLogRecord[],
): LogsAuditFinding[] {
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
