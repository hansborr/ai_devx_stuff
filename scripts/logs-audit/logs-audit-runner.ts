import { z } from "zod";

import { parseCli } from "../lib/cli.js";
import { writeLogsAuditDiagnosticsSidecar } from "./logs-audit-diagnostics.js";
import { formatJson, formatText } from "./logs-audit-format.js";
import { auditLogFiles } from "./logs-audit-ingestion.js";
import { defaultLatestLogRoots, findLatestCompatibleLogFiles } from "./logs-audit-latest.js";
import type { LogFileReader, LogsAuditOptions, LogsAuditReport } from "./logs-audit-types.js";

const LATEST_NO_COMPATIBLE_LOGS_HINT =
  "logs:audit --latest: no compatible JSONL logs found in verify/hook log dirs; run `bun run verify:changed` to populate logs before retrying.";

// Deliberately a different condition, a different message, and a different
// exit code from the hint above. "No logs yet" is graceful degradation and
// stays the landed zero exit (docs/ai-harness.md tells automation to rely on
// it). "Nobody told me where the logs are" is CLI misuse: the state-path
// protocol is bash-owned (scripts/lib/verify-state-paths.sh, reached through
// the scripts/lib/verify-metadata.sh entry point) and crosses into this
// process only through the shim, so a raw `bun scripts/logs-audit.ts --latest`
// has no answer and must not invent one. Exit 2 is this CLI's existing
// tool-error code (bad args, sidecar write failure).
const LATEST_MISSING_LOG_DIRS_HINT =
  "logs:audit --latest: no verify/hook log directories configured. Run `bun run logs:audit --latest`: the package script's shell shim exports MUSI_STANDARD_VERIFY_LOG_DIR and MUSI_STANDARD_BUN_LOG_DIR from scripts/lib/verify-metadata.sh, and a direct `bun scripts/logs-audit.ts --latest` no longer derives them.";
const LATEST_MISSING_LOG_DIRS_EXIT_CODE = 2;

class LogsAuditHelp extends Error {
  constructor() {
    super(usage());
    this.name = "LogsAuditHelp";
  }
}

class LogsAuditError extends Error {
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
    "0 with a hint when no compatible verify/hook JSONL logs exist, and 2 when",
    "no log directories were configured (run --latest through `bun run",
    "logs:audit`, which exports them).",
    "Set HARNESS_DIAGNOSTICS_OUTPUT=<path> to also write a HarnessDiagnostics",
    "sidecar (opt-in; native stdout and exit code stay unchanged).",
  ].join("\n");
}

const cliOptionsSchema = z.object({
  "--file": z.array(z.string()).default([]),
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--latest": z.boolean().default(false),
});

export function parseArgs(argv: readonly string[]): LogsAuditOptions {
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new LogsAuditError(message),
    allowEmptyArgs: true,
    onHelp: () => {
      throw new LogsAuditHelp();
    },
    options: [
      { name: "--file", kind: "value", repeatable: true },
      { name: "--format", kind: "value" },
      { name: "--latest", kind: "flag" },
    ],
    schema: cliOptionsSchema,
  });

  const files = [...parsed.options["--file"], ...parsed.positionals];
  const format = parsed.options["--format"];
  if (parsed.options["--latest"]) {
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

type RunLogsAuditOptions = {
  readonly argv: readonly string[];
  readonly readFile?: LogFileReader;
  readonly latestLogRoots?: readonly string[];
};

type RunLogsAuditResult = {
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

type ResolvedRunFiles =
  | { readonly kind: "files"; readonly files: readonly string[] }
  | { readonly kind: "no-log-dirs" }
  | { readonly kind: "no-compatible-logs" };

function resolveRunFiles(
  parsed: LogsAuditOptions,
  latestLogRoots: readonly string[] | undefined,
): ResolvedRunFiles {
  if (!parsed.latest) return { kind: "files", files: parsed.files };
  const roots = latestLogRoots ?? defaultLatestLogRoots();
  if (roots.length === 0) return { kind: "no-log-dirs" };
  const files = findLatestCompatibleLogFiles(roots);
  return files.length === 0 ? { kind: "no-compatible-logs" } : { kind: "files", files };
}

export function runLogsAudit(options: RunLogsAuditOptions): RunLogsAuditResult {
  const parsed = parseRunArgs(options.argv);
  if (parsed.kind === "result") return parsed.result;

  const resolved = resolveRunFiles(parsed.options, options.latestLogRoots);
  if (resolved.kind === "no-log-dirs") {
    return { exitCode: LATEST_MISSING_LOG_DIRS_EXIT_CODE, stdout: LATEST_MISSING_LOG_DIRS_HINT };
  }
  if (resolved.kind === "no-compatible-logs") {
    return { exitCode: 0, stdout: LATEST_NO_COMPATIBLE_LOGS_HINT };
  }

  const report = auditLogFiles(resolved.files, options.readFile);
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
