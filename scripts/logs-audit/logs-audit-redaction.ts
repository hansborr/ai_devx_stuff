// Redaction inspection helpers for the logs-audit script.
//
// These functions walk parsed log records and flag sensitive fields that are
// not properly redacted (or sensitive query params in URL values). Generic
// sensitive-key classification uses shared canonical query-param spellings,
// while `body`, `cookies`, and `rawBody` remain auditor-local mirrors of
// deliberately Pino-local producer paths. Only the named `AUDIT_ONLY_*` values
// are the defence-in-depth acceptance delta.

import {
  CANONICAL_SENSITIVE_CONTENT_FIELD_PATHS,
  CANONICAL_SENSITIVE_QUERY_PARAMS,
  PRODUCER_REDACTION_SENTINELS,
} from "../../packages/shared/src/logging-policy.js";
import { isRecord as isJsonObject } from "../lib/records.js";
import type { LogsAuditFinding, LogsAuditRedactionKind } from "./logs-audit-types.js";

interface RedactionContext {
  readonly file: string;
  readonly line: number;
}

const AUDIT_ONLY_REDACTION_SENTINELS = ["<redacted>", "***"] as const;
const REDACTED_STRINGS = new Set<string>([
  ...PRODUCER_REDACTION_SENTINELS,
  ...AUDIT_ONLY_REDACTION_SENTINELS,
]);

const PRODUCER_PATH_SENSITIVE_KEYS = ["body", "cookies", "rawBody"] as const;
const AUDIT_ONLY_SENSITIVE_KEYS = ["password", "setcookie"] as const;
const SENSITIVE_KEYS = new Set(
  [
    ...CANONICAL_SENSITIVE_QUERY_PARAMS,
    ...PRODUCER_PATH_SENSITIVE_KEYS,
    ...AUDIT_ONLY_SENSITIVE_KEYS,
  ].map(normalizedKey),
);

const SENSITIVE_FIELD_PATHS = new Set(
  CANONICAL_SENSITIVE_CONTENT_FIELD_PATHS.map(normalizedFieldPath),
);

const AUDIT_ONLY_SENSITIVE_QUERY_PARAMS = ["password"] as const;
const SENSITIVE_QUERY_PARAMS = new Set(
  [...CANONICAL_SENSITIVE_QUERY_PARAMS, ...AUDIT_ONLY_SENSITIVE_QUERY_PARAMS].map(normalizedKey),
);

const URL_FIELD_KEYS = new Set(["url", "requesturl"]);

function normalizedKey(key: string): string {
  return key.replace(/[-_]/gu, "").toLowerCase();
}

function normalizedFieldPath(field: string): string {
  return field
    .replace(/\[\d+\]/gu, "")
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
  redactionKind: LogsAuditRedactionKind,
  field: string,
  message: string,
): LogsAuditFinding {
  return {
    check: "redaction",
    redactionKind,
    file: context.file,
    line: context.line,
    field,
    message,
  };
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
          "url-param",
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
    return [
      redactionFinding(
        context,
        "sensitive-field",
        field,
        `sensitive field '${field}' is not redacted`,
      ),
    ];
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
