// Business-event field convention auditing for the logs-audit script.

import type { LogsAuditFinding } from "../logs-audit.js";
import type { ParsedLogRecord } from "./logs-audit-checks.js";
import { isJsonObject } from "./logs-audit-redaction.js";

type JsonObject = Record<string, unknown>;

interface EventFieldContext {
  readonly file: string;
  readonly line: number;
}

interface AllowedFieldPolicy {
  readonly allowed: ReadonlySet<string>;
  readonly message: string;
}

const STABLE_EVENT_VALUE = /^[a-z][a-zA-Z0-9]*(?:[._:-][a-z][a-zA-Z0-9]*)*$/u;
const MAX_STABLE_EVENT_VALUE_LENGTH = 80;
const AUTHZ_OUTCOMES = new Set(["allow", "deny"]);
const MUTATION_OUTCOMES = new Set(["success", "failure"]);
const BROADCAST_OUTCOMES = new Set(["success", "skipped"]);
const AUTHZ_OUTCOME_POLICY = {
  allowed: AUTHZ_OUTCOMES,
  message: "authz outcome must be allow or deny",
} satisfies AllowedFieldPolicy;
const MUTATION_OUTCOME_POLICY = {
  allowed: MUTATION_OUTCOMES,
  message: "mutation outcome must be success or failure",
} satisfies AllowedFieldPolicy;
const BROADCAST_OUTCOME_POLICY = {
  allowed: BROADCAST_OUTCOMES,
  message: "socket.broadcast outcome must be success or skipped",
} satisfies AllowedFieldPolicy;

function eventFieldsFinding(
  context: EventFieldContext,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "event-fields", file: context.file, line: context.line, field, message };
}

function isStableEventValue(value: string): boolean {
  return value.length <= MAX_STABLE_EVENT_VALUE_LENGTH && STABLE_EVENT_VALUE.test(value);
}

function requiredStringField(
  context: EventFieldContext,
  record: JsonObject,
  field: string,
  message: string,
): {
  readonly value?: string;
  readonly findings: readonly LogsAuditFinding[];
} {
  const value = record[field];
  if (typeof value === "string" && value.length > 0) return { value, findings: [] };
  return { findings: [eventFieldsFinding(context, field, message)] };
}

function auditStableField(
  context: EventFieldContext,
  field: string,
  value: string,
): LogsAuditFinding[] {
  if (isStableEventValue(value)) return [];
  return [eventFieldsFinding(context, field, `${field} must be a stable low-cardinality code`)];
}

function auditAllowedField(
  context: EventFieldContext,
  field: string,
  value: string,
  policy: AllowedFieldPolicy,
): LogsAuditFinding[] {
  if (policy.allowed.has(value)) return [];
  return [eventFieldsFinding(context, field, policy.message)];
}

function auditReasonField(
  context: EventFieldContext,
  record: JsonObject,
  requiredMessage?: string,
): LogsAuditFinding[] {
  const reason = record["reason"];
  if (reason === undefined) {
    return requiredMessage === undefined
      ? []
      : [eventFieldsFinding(context, "reason", requiredMessage)];
  }
  if (typeof reason !== "string" || reason.length === 0) {
    return [eventFieldsFinding(context, "reason", "reason must be a string")];
  }
  return auditStableField(context, "reason", reason);
}

function auditActorField(
  context: EventFieldContext,
  record: JsonObject,
  required: boolean,
): LogsAuditFinding[] {
  const actor = record["actor"];
  if (actor === undefined && !required) return [];
  if (!isJsonObject(actor)) {
    return [eventFieldsFinding(context, "actor", "actor is required with userId")];
  }
  if (typeof actor["userId"] === "string" && actor["userId"].length > 0) return [];
  return [eventFieldsFinding(context, "actor.userId", "actor.userId must be a string")];
}

function auditAuthzFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  return [
    ...auditAllowedField(context, "outcome", outcome, AUTHZ_OUTCOME_POLICY),
    ...auditActorField(context, record.value, true),
    ...auditReasonField(
      context,
      record.value,
      outcome === "deny" ? "reason is required for deny outcomes" : undefined,
    ),
  ];
}

function auditMutationFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  return [
    ...auditAllowedField(context, "outcome", outcome, MUTATION_OUTCOME_POLICY),
    ...auditActorField(context, record.value, false),
    ...auditReasonField(
      context,
      record.value,
      outcome === "failure" ? "reason is required for failure outcomes" : undefined,
    ),
  ];
}

function auditSocketBroadcastFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  const socketEvent = requiredStringField(
    context,
    record.value,
    "socketEvent",
    "socketEvent is required for socket.broadcast",
  );
  return [
    ...auditAllowedField(context, "outcome", outcome, BROADCAST_OUTCOME_POLICY),
    ...(socketEvent.value === undefined
      ? socketEvent.findings
      : auditStableField(context, "socketEvent", socketEvent.value)),
    ...auditReasonField(
      context,
      record.value,
      outcome === "skipped" ? "reason is required for skipped outcomes" : undefined,
    ),
  ];
}

function auditBusinessEventFields(
  file: string,
  record: ParsedLogRecord,
  event: string,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  const outcome = requiredStringField(
    context,
    record.value,
    "outcome",
    "outcome is required for business events",
  );
  const findings = auditStableField(context, "event", event);
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
      findings.push(
        eventFieldsFinding({ file, line: record.line }, "event", "event must be a string"),
      );
      continue;
    }
    if (event.startsWith("script.")) continue;
    findings.push(...auditBusinessEventFields(file, record, event));
  }
  return findings;
}
