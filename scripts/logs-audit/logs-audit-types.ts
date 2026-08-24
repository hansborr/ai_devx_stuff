import type { CliFormat } from "../lib/cli.js";

export type JsonObject = Record<string, unknown>;

type LogsAuditFormat = CliFormat;

export type LogsAuditOptions = {
  readonly files: readonly string[];
  readonly format: LogsAuditFormat;
  readonly latest?: true;
};

export type LogsAuditFindingCheck = "input" | "jsonl" | "redaction" | "request-id" | "event-fields";

// Machine-readable subtype of a `check: "redaction"` finding: a sensitive URL
// query parameter must route through redactUrlForLogs, while an object field is
// fixed via LOGGER_REDACT_PATHS. The formatter dispatches remedies on this
// discriminant so the human-facing message stays presentation-only prose.
export type LogsAuditRedactionKind = "url-param" | "sensitive-field";

export type LogsAuditFinding = {
  readonly check: LogsAuditFindingCheck;
  readonly file: string;
  readonly line?: number;
  readonly field?: string;
  readonly message: string;
  // Optional at the JSON boundary for additive compatibility, but both redaction
  // producers supply it by construction; absent on every non-redaction check.
  readonly redactionKind?: LogsAuditRedactionKind;
};

type LogsAuditFileSummary = {
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

export interface ParsedLogRecord {
  readonly line: number;
  readonly value: JsonObject;
}
