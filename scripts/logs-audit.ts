#!/usr/bin/env bun
// Read-only JSONL log quality audit.
//
// The audit stays deterministic: callers pass one or more log files, and the
// script reports parse failures, request/event field drift, and obvious
// unredacted sensitive fields without retaining raw record payloads.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { ParsedLogRecord } from "./logs-audit/logs-audit-checks.js";
import { auditEventFields, auditRequestIds } from "./logs-audit/logs-audit-checks.js";
import { writeLogsAuditDiagnosticsSidecar } from "./logs-audit/logs-audit-diagnostics.js";
import { formatJson, formatText } from "./logs-audit/logs-audit-format.js";
import { findLatestCompatibleLogFiles } from "./logs-audit/logs-audit-latest.js";
import { inspectRedaction, isJsonObject } from "./logs-audit/logs-audit-redaction.js";

const CLI_USER_ARGS_START_INDEX = 2;
const LATEST_NO_COMPATIBLE_LOGS_HINT =
  "logs:audit --latest: no compatible JSONL logs found in verify/hook log dirs; run `bun run verify:changed` to populate logs before retrying.";

export { formatJson, formatText };
export { findLatestCompatibleLogFiles };

export type LogsAuditFormat = "text" | "json";

export type LogsAuditOptions = {
  readonly files: readonly string[];
  readonly format: LogsAuditFormat;
  readonly latest?: true;
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

function usage(): string {
  return [
    "Usage:",
    "  bun run logs:audit --file <server.jsonl> [--file <more.jsonl>]",
    "  bun run logs:audit <server.jsonl> [more.jsonl...]",
    "  bun run logs:audit --format <text|json> --file <server.jsonl>",
    "  bun run logs:audit --latest [--format <text|json>]",
    "",
    "Read-only. Exits 1 when the audited logs contain findings; --latest exits",
    "0 with a hint when no compatible verify/hook JSONL logs exist.",
    "Set HARNESS_DIAGNOSTICS_OUTPUT=<path> to also write a HarnessDiagnostics",
    "sidecar (opt-in; native stdout and exit code stay unchanged).",
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

type ParsedAuditArg =
  | {
      readonly kind: "file";
      readonly value: string;
      readonly nextIndex: number;
    }
  | {
      readonly kind: "format";
      readonly value: LogsAuditFormat;
      readonly nextIndex: number;
    }
  | {
      readonly kind: "latest";
      readonly nextIndex: number;
    };

function parseFileArg(arg: string, argv: readonly string[], index: number): ParsedAuditArg {
  const parsed = readOptionValue(arg, argv, index);
  if (!parsed.value) throw new LogsAuditError("--file requires a path.");
  return { kind: "file", value: parsed.value, nextIndex: parsed.nextIndex };
}

function parseFormatArg(arg: string, argv: readonly string[], index: number): ParsedAuditArg {
  const parsed = readOptionValue(arg, argv, index);
  if (parsed.value !== "text" && parsed.value !== "json") {
    throw new LogsAuditError("--format requires text or json.");
  }
  return { kind: "format", value: parsed.value, nextIndex: parsed.nextIndex };
}

function parseAuditArg(
  arg: string | undefined,
  argv: readonly string[],
  index: number,
): ParsedAuditArg {
  if (arg === undefined) throw new LogsAuditError("Empty arguments are not supported.");
  if (arg === "--help" || arg === "-h") throw new LogsAuditHelp();
  if (arg === "--latest") return { kind: "latest", nextIndex: index };
  if (arg === "--file" || arg.startsWith("--file=")) return parseFileArg(arg, argv, index);
  if (arg === "--format" || arg.startsWith("--format=")) return parseFormatArg(arg, argv, index);
  if (arg.startsWith("--")) throw new LogsAuditError(`Unknown argument: ${arg}\n${usage()}`);
  return { kind: "file", value: arg, nextIndex: index };
}

export function parseArgs(argv: readonly string[]): LogsAuditOptions {
  const files: string[] = [];
  let format: LogsAuditFormat = "text";
  let latest = false;

  for (let index = 0; index < argv.length; index += 1) {
    const parsed = parseAuditArg(argv[index], argv, index);
    if (parsed.kind === "file") files.push(parsed.value);
    else if (parsed.kind === "format") format = parsed.value;
    else latest = true;
    index = parsed.nextIndex;
  }

  if (latest) {
    if (files.length > 0) {
      throw new LogsAuditError("--latest cannot be combined with explicit log files.");
    }
    return { files: [], format, latest: true };
  }

  if (files.length === 0) {
    throw new LogsAuditError(`logs:audit requires at least one log file.\n${usage()}`);
  }
  return { files, format };
}

function parseJsonLine(line: string): unknown {
  return JSON.parse(line);
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

export type RunLogsAuditOptions = {
  readonly argv: readonly string[];
  readonly readFile?: LogFileReader;
  readonly latestLogRoots?: readonly string[];
};

export type RunLogsAuditResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: LogsAuditReport;
};

type ParsedRunArgs =
  | {
      readonly kind: "parsed";
      readonly options: LogsAuditOptions;
    }
  | {
      readonly kind: "result";
      readonly result: RunLogsAuditResult;
    };

function parseRunArgs(argv: readonly string[]): ParsedRunArgs {
  try {
    return { kind: "parsed", options: parseArgs(argv) };
  } catch (err) {
    if (err instanceof LogsAuditHelp) {
      return { kind: "result", result: { exitCode: 0, stdout: err.message } };
    }
    if (err instanceof LogsAuditError) {
      return { kind: "result", result: { exitCode: 2, stdout: err.message } };
    }
    throw err;
  }
}

function resolveRunFiles(
  parsed: LogsAuditOptions,
  latestLogRoots: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!parsed.latest) return parsed.files;
  const files =
    latestLogRoots === undefined
      ? findLatestCompatibleLogFiles()
      : findLatestCompatibleLogFiles(latestLogRoots);
  return files.length === 0 ? undefined : files;
}

export function runLogsAudit(options: RunLogsAuditOptions): RunLogsAuditResult {
  const parsed = parseRunArgs(options.argv);
  if (parsed.kind === "result") return parsed.result;

  const files = resolveRunFiles(parsed.options, options.latestLogRoots);
  if (files === undefined) {
    return { exitCode: 0, stdout: LATEST_NO_COMPATIBLE_LOGS_HINT };
  }

  const report = auditLogFiles(files, options.readFile);
  const stdout = parsed.options.format === "json" ? formatJson(report) : formatText(report);
  // Opt-in HarnessDiagnostics sidecar: native stdout above is untouched, and a
  // run without HARNESS_DIAGNOSTICS_OUTPUT set never reaches the projection. A
  // bad output path or failed write is a CLI/tool error (exit 2), not a log
  // finding; the audit findings keep their existing exit-1 semantics below.
  try {
    writeLogsAuditDiagnosticsSidecar(report);
  } catch (err) {
    return { exitCode: 2, stdout: err instanceof Error ? err.message : String(err), report };
  }
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
  const result = runLogsAudit({ argv: process.argv.slice(CLI_USER_ARGS_START_INDEX) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
