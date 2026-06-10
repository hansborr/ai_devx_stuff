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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
  type HarnessDiagnosticTool,
  type HarnessFindingSeverity,
} from "../packages/shared/src/schemas/harness-diagnostics.js";

const JSON_INDENT_SPACES = 2;

export type HarnessAuditFormat = "text" | "json";

export type HarnessAuditOptions = {
  readonly inputs: readonly string[];
  readonly format: HarnessAuditFormat;
  readonly output: string | undefined;
};

/** One envelope file that read, parsed, and validated cleanly. */
export type LoadedEnvelope = {
  readonly path: string;
  readonly envelope: HarnessDiagnostics;
};

/** An envelope file that could not be read, parsed, or validated. */
export type EnvelopeFailure = {
  readonly path: string;
  readonly reason: string;
};

export type HarnessAuditSeverityCounts = {
  readonly blocking: number;
  readonly warning: number;
  readonly info: number;
};

export type HarnessAuditControlSummary = HarnessAuditSeverityCounts & {
  readonly control: string;
  readonly total: number;
};

export type HarnessAuditToolSummary = HarnessAuditSeverityCounts & {
  readonly tool: HarnessDiagnosticTool;
  readonly sources: readonly string[];
  readonly envelopes: number;
  readonly total: number;
  readonly controls: readonly HarnessAuditControlSummary[];
};

export type HarnessAuditTotals = HarnessAuditSeverityCounts & {
  readonly envelopes: number;
  readonly tools: number;
  readonly total: number;
};

export type HarnessAuditReport = {
  readonly tools: readonly HarnessAuditToolSummary[];
  readonly totals: HarnessAuditTotals;
  readonly failures: readonly EnvelopeFailure[];
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function defaultWriteFile(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function readOptionValue(
  arg: string,
  argv: readonly string[],
  index: number,
): { readonly value: string; readonly nextIndex: number } {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined) throw new HarnessAuditError(`${arg} requires a value.\n${usage()}`);
  return { value: next, nextIndex: index + 1 };
}

export function parseArgs(argv: readonly string[]): HarnessAuditOptions {
  const inputs: string[] = [];
  let format: HarnessAuditFormat = "text";
  let output: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new HarnessAuditError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") throw new HarnessAuditHelp();
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (parsed.value !== "text" && parsed.value !== "json") {
        throw new HarnessAuditError("--format requires text or json.");
      }
      format = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--output" || arg.startsWith("--output=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new HarnessAuditError("--output requires a path.");
      output = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new HarnessAuditError(`Unknown argument: ${arg}\n${usage()}`);
    }
    inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new HarnessAuditError(`harness:audit requires at least one envelope file.\n${usage()}`);
  }
  return { inputs, format, output };
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
        reason: `could not read envelope file: ${describeError(error)}`,
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      failures.push({ path: input, reason: `not valid JSON: ${describeError(error)}` });
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

type SeverityAccumulator = { blocking: number; warning: number; info: number };

function newSeverityAccumulator(): SeverityAccumulator {
  return { blocking: 0, warning: 0, info: 0 };
}

function bumpSeverity(counts: SeverityAccumulator, severity: HarnessFindingSeverity): void {
  if (severity === "block") counts.blocking += 1;
  else if (severity === "warn") counts.warning += 1;
  else counts.info += 1;
}

type ToolAccumulator = SeverityAccumulator & {
  readonly tool: HarnessDiagnosticTool;
  readonly sources: string[];
  envelopes: number;
  readonly controls: Map<string, SeverityAccumulator>;
};

function totalOf(counts: HarnessAuditSeverityCounts): number {
  return counts.blocking + counts.warning + counts.info;
}

function controlSummaries(
  controls: ReadonlyMap<string, SeverityAccumulator>,
): readonly HarnessAuditControlSummary[] {
  return [...controls.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([control, counts]) => ({ control, ...counts, total: totalOf(counts) }));
}

/**
 * Fold the loaded envelopes into one report grouped by tool. Envelopes that
 * share a tool id merge into a single group whose `sources` lists every
 * contributing file, so two runs of the same producer are summarized together.
 * Tools, sources, and controls are sorted for deterministic output.
 */
export function buildAuditReport(
  envelopes: readonly LoadedEnvelope[],
  failures: readonly EnvelopeFailure[],
): HarnessAuditReport {
  const byTool = new Map<HarnessDiagnosticTool, ToolAccumulator>();
  for (const { path, envelope } of envelopes) {
    const accumulator =
      byTool.get(envelope.tool) ??
      ({
        tool: envelope.tool,
        sources: [],
        envelopes: 0,
        ...newSeverityAccumulator(),
        controls: new Map<string, SeverityAccumulator>(),
      } satisfies ToolAccumulator);
    byTool.set(envelope.tool, accumulator);
    accumulator.sources.push(path);
    accumulator.envelopes += 1;
    for (const finding of envelope.findings) {
      bumpSeverity(accumulator, finding.severity);
      const controlCounts = accumulator.controls.get(finding.control) ?? newSeverityAccumulator();
      accumulator.controls.set(finding.control, controlCounts);
      bumpSeverity(controlCounts, finding.severity);
    }
  }

  const tools: HarnessAuditToolSummary[] = [...byTool.values()]
    .sort((left, right) => left.tool.localeCompare(right.tool))
    .map((accumulator) => ({
      tool: accumulator.tool,
      sources: [...accumulator.sources].sort((left, right) => left.localeCompare(right)),
      envelopes: accumulator.envelopes,
      blocking: accumulator.blocking,
      warning: accumulator.warning,
      info: accumulator.info,
      total: totalOf(accumulator),
      controls: controlSummaries(accumulator.controls),
    }));

  const totals: HarnessAuditTotals = {
    envelopes: envelopes.length,
    tools: tools.length,
    blocking: tools.reduce((sum, tool) => sum + tool.blocking, 0),
    warning: tools.reduce((sum, tool) => sum + tool.warning, 0),
    info: tools.reduce((sum, tool) => sum + tool.info, 0),
    total: tools.reduce((sum, tool) => sum + tool.total, 0),
  };

  return { tools, totals, failures };
}

const REPORT_ONLY_FOOTER =
  "Report-only: findings above never change this command's exit code; only " +
  "unreadable or malformed envelope files do (exit 2).";

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function severityLine(counts: HarnessAuditSeverityCounts): string {
  const total = totalOf(counts);
  return (
    `${String(counts.blocking)} blocking, ${String(counts.warning)} warning, ` +
    `${String(counts.info)} info (${String(total)} ${pluralize(total, "entry", "entries")})`
  );
}

function severityMix(counts: HarnessAuditSeverityCounts): string {
  const parts: string[] = [];
  if (counts.blocking > 0) parts.push(`${String(counts.blocking)} blocking`);
  if (counts.warning > 0) parts.push(`${String(counts.warning)} warning`);
  if (counts.info > 0) parts.push(`${String(counts.info)} info`);
  return parts.join(", ");
}

function toolSection(tool: HarnessAuditToolSummary): readonly string[] {
  const lines = [
    `${tool.tool} — ${String(tool.envelopes)} ${pluralize(tool.envelopes, "envelope")} (${tool.sources.join(", ")})`,
    `  ${tool.total === 0 ? "clean (no findings)" : severityLine(tool)}`,
  ];
  for (const control of tool.controls) {
    lines.push(`    ${control.control}: ${severityMix(control)}`);
  }
  return lines;
}

export function formatText(report: HarnessAuditReport): string {
  const lines: string[] = [
    "harness:audit — diagnostics fusion (artifact, not an edit-loop gate)",
    "",
  ];
  lines.push(
    `Envelopes: ${String(report.totals.envelopes)} read, ${String(report.failures.length)} unreadable/malformed; ` +
      `${String(report.totals.tools)} ${pluralize(report.totals.tools, "tool")}`,
  );
  lines.push(`Totals: ${severityLine(report.totals)}`);

  if (report.tools.length === 0) {
    lines.push("", "No valid envelopes were read.");
  } else {
    for (const tool of report.tools) {
      lines.push("", ...toolSection(tool));
    }
  }

  if (report.failures.length > 0) {
    lines.push("", `Unreadable or malformed envelopes (${String(report.failures.length)}):`);
    for (const failure of report.failures) {
      lines.push(`  - ${failure.path}: ${failure.reason}`);
    }
  }

  lines.push("", REPORT_ONLY_FOOTER);
  return lines.join("\n");
}

export function formatJson(report: HarnessAuditReport): string {
  return JSON.stringify(report, null, JSON_INDENT_SPACES);
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
    if (error instanceof HarnessAuditError) return { exitCode: 2, stdout: error.message };
    throw error;
  }

  const { envelopes, failures } = loadEnvelopes(parsed.inputs, options.readFile);
  const report = buildAuditReport(envelopes, failures);
  const rendered = parsed.format === "json" ? formatJson(report) : formatText(report);
  // Report-only: even a `block`-severity finding leaves exit 0. Only a failed
  // read or schema validation — a real infrastructure failure — is a tool error.
  const exitCode = report.failures.length > 0 ? 2 : 0;

  if (parsed.output !== undefined) {
    try {
      (options.writeFile ?? defaultWriteFile)(parsed.output, `${rendered}\n`);
    } catch (error) {
      return {
        exitCode: 2,
        stdout: `harness:audit could not write report to ${parsed.output}: ${describeError(error)}`,
        report,
      };
    }
    return {
      exitCode,
      stdout: `harness:audit: wrote ${parsed.format} report to ${parsed.output}`,
      report,
    };
  }

  return { exitCode, stdout: rendered, report };
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runHarnessAudit({ argv: process.argv.slice(2) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
