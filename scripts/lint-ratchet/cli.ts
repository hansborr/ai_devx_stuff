import { ratchetRegressionReasonFailure } from "./recovery-command.js";

export const PROCESS_ARG_OFFSET = 2;

export interface ParsedArgs {
  readonly mode:
    | "default"
    | "update"
    | "check-baseline"
    | "check-registry"
    | "summary"
    | "zero-baseline"
    | "report"
    | "debt-log"
    | "edit-check-targets"
    | "edit-check"
    | "edit-ratchet-coverage";
  readonly allowWorse: boolean;
  readonly reason?: string;
  readonly editCheckTargets?: readonly string[];
  readonly targetsFile?: string;
  readonly editRatchetCoveragePaths?: readonly string[];
}

interface ParsedArgsState {
  mode: ParsedArgs["mode"];
  allowWorse: boolean;
  reason?: string;
  editCheckTargets?: readonly string[];
  targetsFile?: string;
  editRatchetCoveragePaths?: readonly string[];
}

export class UsageError extends Error {}

const parsedArgModes = new Map<string, Exclude<ParsedArgs["mode"], "default">>([
  ["--update", "update"],
  ["--check-baseline", "check-baseline"],
  ["--check-registry", "check-registry"],
  ["--summary", "summary"],
  ["--zero-baseline", "zero-baseline"],
  ["--report", "report"],
  ["--debt-log", "debt-log"],
  ["--edit-check", "edit-check"],
]);

function setMode(state: ParsedArgsState, mode: Exclude<ParsedArgs["mode"], "default">): void {
  if (state.mode !== "default") throw new UsageError("choose only one mode");
  state.mode = mode;
}

function consumeReasonArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError("--reason requires a non-empty argument");
  }
  state.reason = value;
  return index + 2;
}

// --edit-check-targets consumes the rest of argv as edited relpaths; the
// remaining flags belong to the two-step edit-time hook contract and never mix
// with another mode.
function consumeEditCheckTargets(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  setMode(state, "edit-check-targets");
  state.editCheckTargets = args.slice(index + 1).filter((value) => value.length > 0);
  return args.length;
}

// --edit-ratchet-coverage consumes the rest of argv as edited relpaths, like
// --edit-check-targets. It answers the lint-coverage hook's "is this path
// tracked by a committed ratchet floor?" query without running ESLint.
function consumeEditRatchetCoverage(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  setMode(state, "edit-ratchet-coverage");
  state.editRatchetCoveragePaths = args.slice(index + 1).filter((value) => value.length > 0);
  return args.length;
}

function consumeTargetsFileArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError("--targets-file requires a non-empty argument");
  }
  state.targetsFile = value;
  return index + 2;
}

function unknownArgumentMessage(arg: string): string {
  return arg.startsWith("--input")
    ? "--input is not supported; use bun run lint:ratchet:report < diagnostics.json"
    : `Unknown argument: ${arg}`;
}

function consumeParsedArg(state: ParsedArgsState, args: readonly string[], index: number): number {
  const arg = args[index] ?? "";
  const mode = parsedArgModes.get(arg);
  if (mode !== undefined) {
    setMode(state, mode);
    return index + 1;
  }
  switch (arg) {
    case "--":
      return index + 1;
    case "--allow-worse":
      state.allowWorse = true;
      return index + 1;
    case "--reason":
      return consumeReasonArgument(state, args, index);
    case "--edit-check-targets":
      return consumeEditCheckTargets(state, args, index);
    case "--edit-ratchet-coverage":
      return consumeEditRatchetCoverage(state, args, index);
    case "--targets-file":
      return consumeTargetsFileArgument(state, args, index);
    default:
      if (!arg.startsWith("--reason=")) throw new UsageError(unknownArgumentMessage(arg));
      state.reason = arg.slice("--reason=".length);
      return index + 1;
  }
}

function parseArgFlags(args: readonly string[]): ParsedArgsState {
  const state: ParsedArgsState = { mode: "default", allowWorse: false };
  let index = 0;
  while (index < args.length) index = consumeParsedArg(state, args, index);
  return state;
}

function assertEditCheckArgs(state: ParsedArgsState): void {
  if (state.mode === "edit-check-targets") {
    if (state.editCheckTargets === undefined || state.editCheckTargets.length === 0) {
      throw new UsageError("--edit-check-targets requires at least one path");
    }
  } else if (state.editCheckTargets !== undefined) {
    throw new UsageError("--edit-check-targets is only valid in edit-check-targets mode");
  }
  if (state.mode === "edit-check") {
    if (state.targetsFile === undefined) {
      throw new UsageError("--edit-check requires --targets-file");
    }
  } else if (state.targetsFile !== undefined) {
    throw new UsageError("--targets-file is only valid with --edit-check");
  }
}

function assertEditRatchetCoverageArgs(state: ParsedArgsState): void {
  if (state.mode === "edit-ratchet-coverage") {
    if (
      state.editRatchetCoveragePaths === undefined ||
      state.editRatchetCoveragePaths.length === 0
    ) {
      throw new UsageError("--edit-ratchet-coverage requires at least one path");
    }
  } else if (state.editRatchetCoveragePaths !== undefined) {
    throw new UsageError("--edit-ratchet-coverage is only valid in edit-ratchet-coverage mode");
  }
}

function assertUpdateArgs(state: ParsedArgsState): void {
  const { mode, allowWorse, reason } = state;
  if (allowWorse && mode !== "update") {
    throw new UsageError("--allow-worse is only valid with --update");
  }
  if (reason !== undefined && mode !== "update") {
    throw new UsageError("--reason is only valid with --update");
  }
  if (allowWorse) {
    const failure = ratchetRegressionReasonFailure(reason);
    if (failure !== undefined) throw new UsageError(failure);
  }
}

function buildParsedArgs(state: ParsedArgsState): ParsedArgs {
  return {
    mode: state.mode,
    allowWorse: state.allowWorse,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
    ...(state.editCheckTargets === undefined ? {} : { editCheckTargets: state.editCheckTargets }),
    ...(state.targetsFile === undefined ? {} : { targetsFile: state.targetsFile }),
    ...(state.editRatchetCoveragePaths === undefined
      ? {}
      : { editRatchetCoveragePaths: state.editRatchetCoveragePaths }),
  };
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const state = parseArgFlags(args);
  assertUpdateArgs(state);
  assertEditCheckArgs(state);
  assertEditRatchetCoverageArgs(state);
  return buildParsedArgs(state);
}

export function usage(): string {
  return [
    "usage: bun scripts/lint-ratchet.ts [--update [--allow-worse --reason <why>] | --check-baseline | --check-registry | --summary | --zero-baseline | --report | --debt-log | --edit-check-targets <relpath>... | --edit-check --targets-file <file> | --edit-ratchet-coverage <relpath>...]",
    "",
    "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
    "--summary prints committed baseline totals without running ESLint; --zero-baseline audits drained ratchets against normal ESLint; --report formats a diagnostics envelope from stdin; --debt-log renders the committed --allow-worse acceptance log.",
    "--edit-check-targets lists matching minimal-TS ratchets for edited paths (no ESLint); --edit-check lints the targets in <file> and prints only fresh ratchet regressions, for the edit-time advisory hook.",
    "--edit-ratchet-coverage prints, per edited path, the committed-baseline ratchet rule ids tracking it (no ESLint), for the lint-coverage advisory hook.",
  ].join("\n");
}
