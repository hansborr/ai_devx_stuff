// Redaction inspection helpers for the logs-audit script.
//
// These functions walk parsed log records and flag sensitive fields that
// are not properly redacted (or sensitive query-params in URL values).

import type { LogsAuditFinding } from "../logs-audit.js";

type JsonObject = Record<string, unknown>;

interface RedactionContext {
  readonly file: string;
  readonly line: number;
}

const REDACTED_STRINGS = new Set(["[redacted]", "redacted", "<redacted>", "***"]);

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

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return `${parent}[${String(index)}]`;
}

function redactionFinding(
  context: RedactionContext,
  field: string,
  message: string,
): LogsAuditFinding {
  return { check: "redaction", file: context.file, line: context.line, field, message };
}

function inspectUrl(context: RedactionContext, field: string, value: string): LogsAuditFinding[] {
  const findings: LogsAuditFinding[] = [];
  try {
    const url = new URL(value, "http://musi.local");
    for (const [param, paramValue] of url.searchParams) {
      if (!SENSITIVE_QUERY_PARAMS.has(normalizedKey(param))) continue;
      if (isRedactedString(paramValue)) continue;
      findings.push(
        redactionFinding(
          context,
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
  context: RedactionContext,
  field: string,
  key: string,
  value: unknown,
): LogsAuditFinding[] {
  if (isSensitiveField(field, key)) {
    if (isRedactedValue(value)) return [];
    return [redactionFinding(context, field, `sensitive field '${field}' is not redacted`)];
  }

  const findings: LogsAuditFinding[] =
    isUrlFieldKey(key) && typeof value === "string" ? inspectUrl(context, field, value) : [];
  return findings.concat(inspectRedaction(context.file, context.line, value, field));
}

export function inspectRedaction(
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
  const context = { file, line };
  for (const [key, item] of Object.entries(value)) {
    const field = pathFor(parent, key);
    findings.push(...inspectValue(context, field, key, item));
  }
  return findings;
}
