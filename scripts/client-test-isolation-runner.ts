#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyClientTestIsolation } from "./client-test-isolation-classifier.js";
import type {
  ClassifyClientTestIsolationOptions,
  ClientTestIsolationClassification,
  ClientTestIsolationTotals,
} from "./client-test-isolation-classifier-types.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

const EXIT_USAGE = 2;
const EXIT_COMMAND_FAILED_TO_START = 1;
// Conventional shell exit code for a process terminated by signal N is 128 + N.
const SIGNAL_EXIT_BASE = 128;
const ROOT_RELATIVE_VITEST_RUNNER = "scripts/vitest.sh";
const HELP_FLAGS = new Set(["--help", "-h"]);

export type ClientTestIsolationSplitLaneName = "fast" | "compatibility";

export type ClientTestIsolationSplitLane = {
  readonly name: ClientTestIsolationSplitLaneName;
  readonly description: string;
  readonly files: readonly string[];
  readonly args: readonly string[];
};

export type ClientTestIsolationSplitPlan = {
  readonly totals: ClientTestIsolationTotals;
  readonly lanes: readonly ClientTestIsolationSplitLane[];
};

export type BuildClientTestIsolationSplitPlanOptions = {
  readonly vitestArgs?: readonly string[];
};

type ClientTestIsolationSplitCommandResult = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
};

type ClientTestIsolationSplitCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => ClientTestIsolationSplitCommandResult;

type TextWriter = (text: string) => void;

export type RunClientTestIsolationSplitCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly classify?: (
    options: ClassifyClientTestIsolationOptions,
  ) => ClientTestIsolationClassification;
  readonly runCommand?: ClientTestIsolationSplitCommandRunner;
  readonly vitestRunner?: string;
  readonly stdout?: TextWriter;
  readonly stderr?: TextWriter;
};

type ParsedCliArgs =
  | { readonly kind: "run"; readonly vitestArgs: readonly string[] }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

export function buildClientTestIsolationSplitPlan(
  classification: ClientTestIsolationClassification,
  options: BuildClientTestIsolationSplitPlanOptions = {},
): ClientTestIsolationSplitPlan {
  const vitestArgs = options.vitestArgs ?? [];
  const lanes: ClientTestIsolationSplitLane[] = [];
  const noIsolateFiles = [...classification.noIsolateFiles];
  const isolatedFiles = classification.isolatedFiles.map((file) => file.file);

  if (noIsolateFiles.length > 0) {
    lanes.push({
      name: "fast",
      description: "no-isolate shuffled client tests",
      files: noIsolateFiles,
      args: [
        ...baseVitestArgs(),
        "--no-isolate",
        "--sequence.shuffle.files",
        ...vitestArgs,
        ...noIsolateFiles,
      ],
    });
  }

  if (isolatedFiles.length > 0) {
    lanes.push({
      name: "compatibility",
      description: "isolated client tests",
      files: isolatedFiles,
      args: [...baseVitestArgs(), ...vitestArgs, ...isolatedFiles],
    });
  }

  return { totals: classification.totals, lanes };
}

export function runClientTestIsolationSplitCli(
  options: RunClientTestIsolationSplitCliOptions,
): number {
  const stdout = options.stdout ?? writeStdout;
  const stderr = options.stderr ?? writeStderr;
  const parsed = parseCliArgs(options.argv);

  if (parsed.kind !== "run") return finishNonRunCliArgs(parsed, stdout, stderr);
  return runClientTestIsolationSplit(parsed.vitestArgs, options, stdout, stderr);
}

function runClientTestIsolationSplit(
  vitestArgs: readonly string[],
  options: RunClientTestIsolationSplitCliOptions,
  stdout: TextWriter,
  stderr: TextWriter,
): number {
  const cwd = path.resolve(options.cwd ?? repoRoot());
  const classify = options.classify ?? classifyClientTestIsolation;
  const classification = classify({ cwd });
  const plan = buildClientTestIsolationSplitPlan(classification, {
    vitestArgs,
  });
  const vitestRunner = options.vitestRunner ?? ROOT_RELATIVE_VITEST_RUNNER;
  const runCommand = options.runCommand ?? defaultRunCommand;

  stdout(formatSummary(plan));
  if (plan.lanes.length === 0) {
    stdout("client-test:split - no client test files selected.\n");
    return 0;
  }

  return runLanes(plan.lanes, {
    runCommand,
    vitestRunner,
    cwd,
    stdout,
    stderr,
  });
}

type RunLanesContext = {
  readonly runCommand: ClientTestIsolationSplitCommandRunner;
  readonly vitestRunner: string;
  readonly cwd: string;
  readonly stdout: TextWriter;
  readonly stderr: TextWriter;
};

function runLanes(lanes: readonly ClientTestIsolationSplitLane[], ctx: RunLanesContext): number {
  let exitCode = 0;
  for (const lane of lanes) {
    ctx.stdout(formatLaneStart(lane));
    const result = ctx.runCommand("bash", [ctx.vitestRunner, ...lane.args], ctx.cwd);
    const laneExitCode = exitCodeFromCommandResult(result);
    if (laneExitCode !== 0 && exitCode === 0) exitCode = laneExitCode;
    // A lane that could not even start (e.g. a missing runner) would make the
    // next lane fail to start identically; surface the underlying error rather
    // than swallowing it and silently retrying, and stop here.
    if (result.error !== undefined) {
      ctx.stderr(
        `client-test:split - ${lane.name} lane failed to start: ${result.error.message}\n`,
      );
      break;
    }
    // A lane killed by a signal (e.g. Ctrl-C -> SIGINT) means the user asked to
    // stop; do not launch the next lane behind their back.
    if (result.signal !== null) break;
  }

  return exitCode;
}

function finishNonRunCliArgs(
  parsed: Exclude<ParsedCliArgs, { readonly kind: "run" }>,
  stdout: TextWriter,
  stderr: TextWriter,
): number {
  if (parsed.kind === "help") {
    stdout(`${usage()}\n`);
    return 0;
  }

  stderr(`${parsed.message}\n${usage()}\n`);
  return EXIT_USAGE;
}

function baseVitestArgs(): readonly string[] {
  return ["run", "--passWithNoTests", "--project=client"];
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const vitestArgs = stripLeadingDashDash(argv);
  for (const arg of vitestArgs) {
    if (HELP_FLAGS.has(arg)) return { kind: "help" };
    if (isCoverageArg(arg)) {
      return {
        kind: "error",
        message:
          "client-test:split coverage is intentionally unsupported; use test:coverage until split coverage output is merged.",
      };
    }
    if (isProjectArg(arg)) {
      return {
        kind: "error",
        message: "client-test:split always runs --project=client; do not pass --project.",
      };
    }
    if (isOutputFileArg(arg)) {
      return {
        kind: "error",
        message:
          "client-test:split output files are intentionally unsupported; use test:client:isolated until per-lane reports are merged.",
      };
    }
  }
  return { kind: "run", vitestArgs };
}

function stripLeadingDashDash(argv: readonly string[]): readonly string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function isCoverageArg(arg: string): boolean {
  return arg === "--coverage" || arg.startsWith("--coverage=") || arg.startsWith("--coverage.");
}

function isProjectArg(arg: string): boolean {
  return arg === "--project" || arg.startsWith("--project=");
}

function isOutputFileArg(arg: string): boolean {
  return (
    arg === "--outputFile" || arg.startsWith("--outputFile=") || arg.startsWith("--outputFile.")
  );
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): ClientTestIsolationSplitCommandResult {
  const result = spawnSync(command, [...args], { cwd, stdio: "inherit" });
  if (result.error !== undefined) {
    return { status: EXIT_COMMAND_FAILED_TO_START, signal: null, error: result.error };
  }
  return { status: result.status, signal: result.signal };
}

function exitCodeFromCommandResult(result: ClientTestIsolationSplitCommandResult): number {
  if (result.signal !== null) return signalExitCode(result.signal);
  if (result.status !== null) return result.status;
  return EXIT_COMMAND_FAILED_TO_START;
}

function signalExitCode(signal: NodeJS.Signals): number {
  // os.constants.signals maps the common signal names to their numbers, but it is
  // NOT guaranteed to contain every NodeJS.Signals name at runtime (e.g. real-time
  // SIGRTMIN-family signals are absent), in which case the lookup is undefined and
  // `128 + undefined` is NaN. Fall back to a plain failure code rather than letting
  // NaN reach process.exitCode. 128 + N is the conventional "killed by signal N".
  const exitCode = SIGNAL_EXIT_BASE + osConstants.signals[signal];
  return Number.isNaN(exitCode) ? EXIT_COMMAND_FAILED_TO_START : exitCode;
}

function formatSummary(plan: ClientTestIsolationSplitPlan): string {
  const { totals } = plan;
  return `client-test:split - ${String(totals.noIsolate)} no-isolate file(s), ${String(
    totals.isolated,
  )} isolated file(s), ${String(totals.testFiles)} total.\n`;
}

function formatLaneStart(lane: ClientTestIsolationSplitLane): string {
  return `client-test:split - running ${lane.name} lane (${lane.description}, ${String(
    lane.files.length,
  )} file(s)).\n`;
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/client-test-isolation-runner.ts [vitest-arg ...]",
    "",
    "Runs client Vitest files in generated isolation lanes:",
    "  fast: --no-isolate --sequence.shuffle.files for files without module-registry mutations",
    "  compatibility: normal Vitest isolation for vi.mock / vi.unmock / resetModules files",
    "",
    "Coverage args are rejected until coverage output is merged across lanes.",
  ].join("\n");
}

function writeStdout(text: string): void {
  process.stdout.write(text);
}

function writeStderr(text: string): void {
  process.stderr.write(text);
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = runClientTestIsolationSplitCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
  });
}
