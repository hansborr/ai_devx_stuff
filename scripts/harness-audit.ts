#!/usr/bin/env bun
// harness:audit — read-only diagnostics fusion consumer.
//
// Multiple deterministic harness tools (lint:ratchet, drift:ai, logs:audit, ...)
// already emit one shared `HarnessDiagnostics` envelope. This command is the
// boring spine that closes the loop: it reads one or more envelope files from
// disk, validates each against the shared schema, and renders a single bounded
// report grouped by tool with totals and per-control counts.
//
// It is an artifact generator for scheduled or manual review, NOT an edit-loop
// gate. Findings — even `block`-severity ones — never change the exit code; the
// command summarizes, it never gates. Only an unreadable or malformed envelope
// (a genuine infrastructure failure) is a tool error (exit 2). This first slice
// reads envelope files passed on the CLI and does not run child producer
// commands; pass paths a producer wrote via `HARNESS_DIAGNOSTICS_OUTPUT=<path>`.
//
// Report assembly and rendering live in scripts/harness/harness-audit-report.ts
// and are re-exported here so this module stays the single public surface.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { harnessDiagnosticsSchema } from "@musi/harness-diagnostics/schema.js";
import { z } from "zod";

import {
  buildAuditReport,
  type EnvelopeFailure,
  formatJson,
  formatText,
  type HarnessAuditReport,
  type LoadedEnvelope,
} from "./harness/harness-audit-report.js";
import { type CliFormat, parseCli } from "./lib/cli.js";

export {
  buildAuditReport,
  type EnvelopeFailure,
  formatJson,
  formatText,
  type HarnessAuditReport,
  type LoadedEnvelope,
} from "./harness/harness-audit-report.js";
import { errorMessage } from "./lib/error-message.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

const TOOL_ERROR_EXIT_CODE = 2;

export type HarnessAuditFormat = CliFormat;

export type HarnessAuditOptions = {
  readonly inputs: readonly string[];
  readonly format: HarnessAuditFormat;
  readonly output: string | undefined;
};

export type EnvelopeFileReader = (filePath: string) => string;
export type ReportWriter = (filePath: string, contents: string) => void;

class HarnessAuditHelp extends Error {
  constructor() {
    super(usage());
    this.name = "HarnessAuditHelp";
  }
}

export class HarnessAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessAuditError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun run harness:audit <envelope.json> [more.json...]",
    "  bun run harness:audit --format <text|json> <envelope.json>",
    "  bun run harness:audit --output <report.txt> <envelope.json>",
    "",
    "Reads HarnessDiagnostics envelope files (e.g. each written by a producer",
    "run with HARNESS_DIAGNOSTICS_OUTPUT=<path>), validates them against the",
    "shared schema, and renders one report grouped by tool.",
    "",
    "Report-only artifact generator, not an edit-loop gate: findings never",
    "change the exit code. Exits 2 only when an envelope is unreadable or",
    "malformed.",
  ].join("\n");
}

function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function defaultWriteFile(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

const cliOptionsSchema = z.object({
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
});

export function parseArgs(argv: readonly string[]): HarnessAuditOptions {
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new HarnessAuditError(message),
    allowEmptyArgs: true,
    onHelp: () => {
      throw new HarnessAuditHelp();
    },
    options: [
      { name: "--format", kind: "value" },
      { name: "--output", kind: "value" },
    ],
    schema: cliOptionsSchema,
  });

  if (parsed.positionals.length === 0) {
    throw new HarnessAuditError(`harness:audit requires at least one envelope file.\n${usage()}`);
  }
  return {
    inputs: parsed.positionals,
    format: parsed.options["--format"],
    output: parsed.options["--output"],
  };
}

function formatSchemaIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  return issues
    .map(
      (issue) => `${issue.path.length === 0 ? "(root)" : issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");
}

/**
 * Read, parse, and schema-validate every input path. Clean envelopes land in
 * `envelopes`; any read, JSON, or schema failure lands in `failures` with a
 * descriptive reason. Loading never throws — the caller maps a non-empty
 * `failures` list to the tool-error exit code while still rendering a report.
 */
export function loadEnvelopes(
  inputs: readonly string[],
  readFile: EnvelopeFileReader = defaultReadFile,
): {
  readonly envelopes: readonly LoadedEnvelope[];
  readonly failures: readonly EnvelopeFailure[];
} {
  const envelopes: LoadedEnvelope[] = [];
  const failures: EnvelopeFailure[] = [];
  for (const input of inputs) {
    let text: string;
    try {
      text = readFile(input);
    } catch (error) {
      failures.push({
        path: input,
        reason: `could not read envelope file: ${errorMessage(error)}`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      failures.push({ path: input, reason: `not valid JSON: ${errorMessage(error)}` });
      continue;
    }
    const result = harnessDiagnosticsSchema.safeParse(parsed);
    if (!result.success) {
      failures.push({
        path: input,
        reason: `failed harnessDiagnosticsSchema: ${formatSchemaIssues(result.error.issues)}`,
      });
      continue;
    }
    envelopes.push({ path: input, envelope: result.data });
  }
  return { envelopes, failures };
}

export type RunHarnessAuditOptions = {
  readonly argv: readonly string[];
  readonly readFile?: EnvelopeFileReader;
  readonly writeFile?: ReportWriter;
};

export type RunHarnessAuditResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: HarnessAuditReport;
};

export function runHarnessAudit(options: RunHarnessAuditOptions): RunHarnessAuditResult {
  let parsed: HarnessAuditOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (error) {
    if (error instanceof HarnessAuditHelp) return { exitCode: 0, stdout: error.message };
    if (error instanceof HarnessAuditError) {
      return { exitCode: TOOL_ERROR_EXIT_CODE, stdout: error.message };
    }
    throw error;
  }

  const { envelopes, failures } = loadEnvelopes(parsed.inputs, options.readFile);
  const report = buildAuditReport(envelopes, failures);
  const rendered = parsed.format === "json" ? formatJson(report) : formatText(report);
  // Report-only: even a `block`-severity finding leaves exit 0. Only a failed
  // read or schema validation — a real infrastructure failure — is a tool error.
  const exitCode = report.failures.length > 0 ? TOOL_ERROR_EXIT_CODE : 0;

  if (parsed.output !== undefined) {
    try {
      (options.writeFile ?? defaultWriteFile)(parsed.output, `${rendered}\n`);
    } catch (error) {
      return {
        exitCode: TOOL_ERROR_EXIT_CODE,
        stdout: `harness:audit could not write report to ${parsed.output}: ${errorMessage(error)}`,
        report,
      };
    }
    // Exit 2 with only a success-sounding confirmation reads as a clean run;
    // surface the drop count so the terminal line agrees with the exit code.
    const failureNote =
      report.failures.length > 0
        ? ` (${String(report.failures.length)} envelope(s) unreadable/malformed - see report)`
        : "";
    return {
      exitCode,
      stdout: `harness:audit: wrote ${parsed.format} report to ${parsed.output}${failureNote}`,
      report,
    };
  }

  return { exitCode, stdout: rendered, report };
}

if (isCliEntrypoint(import.meta.url)) {
  const result = runHarnessAudit({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
