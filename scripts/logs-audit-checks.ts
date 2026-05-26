// Public logs-audit check exports.

type JsonObject = Record<string, unknown>;

export interface ParsedLogRecord {
  readonly line: number;
  readonly value: JsonObject;
}

export { auditEventFields } from "./logs-audit-event-fields.js";
export { auditRequestIds } from "./logs-audit-request-ids.js";
