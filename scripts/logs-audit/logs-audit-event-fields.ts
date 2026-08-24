// Business-event field convention auditing for the logs-audit script.

import { isRecord as isJsonObject } from "../lib/records.js";
import type { BusinessEventFamilyPolicy } from "./logs-audit-event-policy.js";
import { businessEventFamilyPolicy, isBusinessEvent } from "./logs-audit-event-policy.js";
import type { JsonObject, LogsAuditFinding, ParsedLogRecord } from "./logs-audit-types.js";

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

function auditPolicyActorField(
  context: EventFieldContext,
  record: JsonObject,
  policy: BusinessEventFamilyPolicy,
): LogsAuditFinding[] {
  switch (policy.actorPolicy) {
    case "required":
      return auditActorField(context, record, true);
    case "when-present":
      return auditActorField(context, record, false);
    case "ignored":
      return [];
  }
}

function auditOutcomeActorReasonFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
  policy: BusinessEventFamilyPolicy,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  return [
    ...auditAllowedField(context, "outcome", outcome, {
      allowed: policy.allowedOutcomes,
      message: policy.outcomeMessage,
    }),
    ...auditPolicyActorField(context, record.value, policy),
    ...auditReasonField(
      context,
      record.value,
      outcome === policy.reasonRequiredOutcome
        ? `reason is required for ${policy.reasonRequiredOutcome} outcomes`
        : undefined,
    ),
  ];
}

function auditSocketBroadcastFields(
  file: string,
  record: ParsedLogRecord,
  outcome: string,
  policy: BusinessEventFamilyPolicy,
): LogsAuditFinding[] {
  const context = { file, line: record.line };
  return [
    ...auditAllowedField(context, "outcome", outcome, {
      allowed: policy.allowedOutcomes,
      message: policy.outcomeMessage,
    }),
    ...auditPolicyActorField(context, record.value, policy),
    ...policy.requiredStableFields.flatMap((field) => {
      const required = requiredStringField(
        context,
        record.value,
        field,
        `${field} is required for socket.broadcast`,
      );
      return required.value === undefined
        ? required.findings
        : auditStableField(context, field, required.value);
    }),
    ...auditReasonField(
      context,
      record.value,
      outcome === policy.reasonRequiredOutcome
        ? `reason is required for ${policy.reasonRequiredOutcome} outcomes`
        : undefined,
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
  const policy = businessEventFamilyPolicy(event);
  switch (policy.family) {
    case "authz":
      return findings.concat(auditOutcomeActorReasonFields(file, record, outcome.value, policy));
    case "socket.broadcast":
      return findings.concat(auditSocketBroadcastFields(file, record, outcome.value, policy));
    case "mutation/default":
      return findings.concat(auditOutcomeActorReasonFields(file, record, outcome.value, policy));
  }
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
    if (!isBusinessEvent(event)) continue;
    findings.push(...auditBusinessEventFields(file, record, event));
  }
  return findings;
}
