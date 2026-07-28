#!/usr/bin/env bun
// mutation:survivors — Stryker survivor summarizer (report-only).
//
// Stryker's mutation.json is a raw per-mutant dump; triaging it means opening
// the HTML report and clicking through files. This command parses the JSON
// report and ranks the actionable residue — `Survived` and `NoCoverage`
// mutants — by file and by directory area, with a bounded sample of mutants
// per file, so an agent or reviewer gets a triage list instead of a blob.
//
// Report-only, never a gate: survivor counts never change the exit code.
// Exit 2 only for infrastructure failures — an unreadable or malformed
// report, an unwritable --output path, or CLI misuse — mirroring
// harness:audit's contract.
//
// Summary assembly and rendering live in scripts/lib/mutation-survivors-summary.ts
// and are re-exported here so this module stays the single public surface.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type CliFormat, parseCli } from "./lib/cli.js";
import {
  buildSurvivorSummary,
  DEFAULT_TOP_FILES,
  formatTextSummary,
  mutationReportSchema,
  type SurvivorSummary,
} from "./lib/mutation-survivors-summary.js";

export {
  buildSurvivorSummary,
  formatTextSummary,
  type MutationReportInput,
  type SurvivorSummary,
  type SurvivorSummaryOptions,
} from "./lib/mutation-survivors-summary.js";
import { isCliEntrypoint } from "./lib/process-argv.js";

const PROCESS_ARG_OFFSET = 2;
const TOOL_ERROR_EXIT_CODE = 2;
const DEFAULT_INPUT = "reports/mutation/mutation.json";
const JSON_INDENT = 2;

function usage(): string {
  return [
    "Usage:",
    "  bun run mutation:survivors [--input <mutation.json>]",
    "  bun run mutation:survivors --format <text|json> [--output <file>] [--top <n>]",
    "",
    `Parses a Stryker JSON report (default: ${DEFAULT_INPUT}) and ranks`,
    "Survived and NoCoverage mutants by file and directory area as a triage",
    "list. Report-only: survivor counts never change the exit code; exit 2",
    "only for infrastructure failures (unreadable or malformed report,",
    "unwritable output, CLI misuse).",
  ].join("\n");
}

class MutationSurvivorsHelp extends Error {
  constructor() {
    super(usage());
    this.name = "MutationSurvivorsHelp";
  }
}

export class MutationSurvivorsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationSurvivorsError";
  }
}

const cliOptionsSchema = z.object({
  "--input": z.string().default(DEFAULT_INPUT),
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
  "--top": z.coerce
    .number({ error: "--top requires a positive integer." })
    .int()
    .positive()
    .default(DEFAULT_TOP_FILES),
});

export type MutationSurvivorsOptions = {
  readonly input: string;
  readonly format: CliFormat;
  readonly output: string | undefined;
  readonly top: number;
};

export function parseArgs(argv: readonly string[]): MutationSurvivorsOptions {
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new MutationSurvivorsError(message),
    allowEmptyArgs: true,
    onHelp: () => {
      throw new MutationSurvivorsHelp();
    },
    options: [
      { name: "--input", kind: "value" },
      { name: "--format", kind: "value" },
      { name: "--output", kind: "value" },
      { name: "--top", kind: "value" },
    ],
    schema: cliOptionsSchema,
  });
  if (parsed.positionals.length > 0) {
    throw new MutationSurvivorsError(
      `unexpected argument: ${parsed.positionals[0] ?? ""}\n${usage()}`,
    );
  }
  return {
    input: parsed.options["--input"],
    format: parsed.options["--format"],
    output: parsed.options["--output"],
    top: parsed.options["--top"],
  };
}

export type RunMutationSurvivorsOptions = {
  readonly argv: readonly string[];
};

export type MutationSurvivorsRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

function loadSummary(options: MutationSurvivorsOptions): SurvivorSummary {
  let text: string;
  try {
    text = readFileSync(options.input, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MutationSurvivorsError(`could not read report file: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MutationSurvivorsError(`report is not valid JSON: ${message}`);
  }
  const report = mutationReportSchema.safeParse(parsed);
  if (!report.success) {
    throw new MutationSurvivorsError(
      `report does not match the Stryker mutation.json shape: ${report.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return buildSurvivorSummary(report.data, { top: options.top });
}

export function runMutationSurvivors(
  options: RunMutationSurvivorsOptions,
): MutationSurvivorsRunResult {
  let parsed: MutationSurvivorsOptions;
  let summary: SurvivorSummary;
  try {
    parsed = parseArgs(options.argv);
    summary = loadSummary(parsed);
  } catch (error) {
    if (error instanceof MutationSurvivorsHelp) return { exitCode: 0, stdout: error.message };
    if (error instanceof MutationSurvivorsError) {
      return { exitCode: TOOL_ERROR_EXIT_CODE, stdout: `mutation:survivors: ${error.message}` };
    }
    throw error;
  }
  const rendered =
    parsed.format === "json"
      ? JSON.stringify(summary, null, JSON_INDENT)
      : formatTextSummary(summary);
  if (parsed.output !== undefined) {
    try {
      mkdirSync(path.dirname(parsed.output), { recursive: true });
      writeFileSync(parsed.output, `${rendered}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        exitCode: TOOL_ERROR_EXIT_CODE,
        stdout: `mutation:survivors: could not write report to ${parsed.output}: ${message}`,
      };
    }
    return {
      exitCode: 0,
      stdout: `mutation:survivors: wrote ${parsed.format} report to ${parsed.output}`,
    };
  }
  return { exitCode: 0, stdout: rendered };
}

if (isCliEntrypoint(import.meta.url)) {
  const result = runMutationSurvivors({ argv: process.argv.slice(PROCESS_ARG_OFFSET) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
