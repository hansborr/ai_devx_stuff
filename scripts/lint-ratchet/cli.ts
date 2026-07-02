import { buildParsedArgs } from "./cli-build.js";
import type { ParsedArgs, ParsedArgsState } from "./cli-types.js";
import { parseProposeCliOptions, ProposeArgsUsageError } from "./propose-cli-options.js";
import { ratchetRegressionReasonFailure } from "./recovery-command.js";

export type { ParsedArgs } from "./cli-types.js";

export const PROCESS_ARG_OFFSET = 2;
const OPTION_VALUE_ARG_SPAN = 2;
const DEFAULT_SUMMARY_DIRECTORY_DEPTH = 3;
const DECIMAL_RADIX = 10;

export class UsageError extends Error {}

const parsedArgModes = new Map<string, Exclude<ParsedArgs["mode"], "default">>([
  ["--update", "update"],
  ["--check-baseline", "check-baseline"],
  ["--check-debt-accounting", "check-debt-accounting"],
  ["--check-registry", "check-registry"],
  ["--summary", "summary"],
  ["--trend", "trend"],
  ["--zero-baseline", "zero-baseline"],
  ["--report", "report"],
  ["--debt-log", "debt-log"],
  ["--edit-check", "edit-check"],
]);

function setMode(state: ParsedArgsState, mode: Exclude<ParsedArgs["mode"], "default">): void {
  if (state.mode !== "default") throw new UsageError("choose only one mode");
  state.mode = mode;
}

function requiredArgument(args: readonly string[], index: number, message: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(message);
  return value;
}

function consumeReasonArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  state.reason = requiredArgument(args, index, "--reason requires a non-empty argument");
  return index + OPTION_VALUE_ARG_SPAN;
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
  state.targetsFile = requiredArgument(args, index, "--targets-file requires a non-empty argument");
  return index + OPTION_VALUE_ARG_SPAN;
}

function consumeRetireRatchetArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  state.retireRatchetId = requiredArgument(
    args,
    index,
    "--retire-ratchet requires a ratchet id argument",
  );
  return index + OPTION_VALUE_ARG_SPAN;
}

function consumeProposeArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  setMode(state, "propose");
  let parsed: ReturnType<typeof parseProposeCliOptions>;
  try {
    parsed = parseProposeCliOptions(args.slice(index + 1));
  } catch (error) {
    if (error instanceof ProposeArgsUsageError) throw new UsageError(error.message);
    throw error;
  }
  state.proposeRuleId = parsed.ruleId;
  state.proposeFiles = parsed.files;
  if (parsed.ignores !== undefined) state.proposeIgnores = parsed.ignores;
  if (parsed.metric !== undefined) state.proposeMetric = parsed.metric;
  if (parsed.ruleOptionsJson !== undefined) state.proposeRuleOptionsJson = parsed.ruleOptionsJson;
  return args.length;
}

function parsePositiveInteger(value: string, message: string): number {
  const depth = Number.parseInt(value, DECIMAL_RADIX);
  if (!Number.isInteger(depth) || depth < 1 || String(depth) !== value) {
    throw new UsageError(message);
  }
  return depth;
}

function parseDirectoryDepth(value: string): number {
  return parsePositiveInteger(value, "--by-directory depth must be a positive integer");
}

function consumeByDirectoryArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    state.summaryByDirectoryDepth = DEFAULT_SUMMARY_DIRECTORY_DEPTH;
    return index + 1;
  }
  state.summaryByDirectoryDepth = parseDirectoryDepth(value);
  return index + OPTION_VALUE_ARG_SPAN;
}

function consumeSinceArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  state.trendSince = requiredArgument(args, index, "--since requires a non-empty argument");
  return index + OPTION_VALUE_ARG_SPAN;
}

function consumeTrendMaxArgument(
  state: ParsedArgsState,
  args: readonly string[],
  index: number,
): number {
  state.trendMax = parsePositiveInteger(
    requiredArgument(args, index, "--max requires a positive integer"),
    "--max requires a positive integer",
  );
  return index + OPTION_VALUE_ARG_SPAN;
}

function unknownArgumentMessage(arg: string): string {
  return arg.startsWith("--input")
    ? "--input is not supported; use bun run lint:ratchet:report < diagnostics.json"
    : `Unknown argument: ${arg}`;
}

type ArgConsumer = (state: ParsedArgsState, args: readonly string[], index: number) => number;

const valueArgConsumers = new Map<string, ArgConsumer>([
  ["--reason", consumeReasonArgument],
  ["--edit-check-targets", consumeEditCheckTargets],
  ["--edit-ratchet-coverage", consumeEditRatchetCoverage],
  ["--targets-file", consumeTargetsFileArgument],
  ["--retire-ratchet", consumeRetireRatchetArgument],
  ["--propose", consumeProposeArgument],
  ["--by-directory", consumeByDirectoryArgument],
  ["--since", consumeSinceArgument],
  ["--max", consumeTrendMaxArgument],
]);

function consumeParsedArg(state: ParsedArgsState, args: readonly string[], index: number): number {
  const arg = args[index] ?? "";
  const mode = parsedArgModes.get(arg);
  if (mode !== undefined) {
    setMode(state, mode);
    return index + 1;
  }
  const consumer = valueArgConsumers.get(arg);
  if (consumer !== undefined) return consumer(state, args, index);
  if (arg === "--") return index + 1;
  if (arg === "--allow-worse") {
    state.allowWorse = true;
    return index + 1;
  }
  if (!arg.startsWith("--reason=")) throw new UsageError(unknownArgumentMessage(arg));
  state.reason = arg.slice("--reason=".length);
  return index + 1;
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

function assertUpdateOnlyFlag(present: boolean, mode: ParsedArgs["mode"], flag: string): void {
  if (present && mode !== "update") {
    throw new UsageError(`${flag} is only valid with --update`);
  }
}

function assertUpdateArgs(state: ParsedArgsState): void {
  const { mode, allowWorse, reason, retireRatchetId } = state;
  assertUpdateOnlyFlag(allowWorse, mode, "--allow-worse");
  assertUpdateOnlyFlag(reason !== undefined, mode, "--reason");
  assertUpdateOnlyFlag(retireRatchetId !== undefined, mode, "--retire-ratchet");
  // Retirement (proven promotion) and --allow-worse (accepted debt) are opposite
  // dispositions of a removed ratchet; forcing the operator to pick one keeps a
  // proven retirement from also writing a debt-log acceptance.
  if (retireRatchetId !== undefined && allowWorse) {
    throw new UsageError("--retire-ratchet and --allow-worse are mutually exclusive");
  }
  if (allowWorse) {
    const failure = ratchetRegressionReasonFailure(reason);
    if (failure !== undefined) throw new UsageError(failure);
  }
}

function assertProposeArgs(state: ParsedArgsState): void {
  if (state.mode === "propose") {
    if (
      state.proposeRuleId === undefined ||
      state.proposeFiles === undefined ||
      state.proposeFiles.length === 0
    ) {
      throw new UsageError("--propose requires <ruleId> <glob...>");
    }
  } else if (state.proposeRuleId !== undefined || state.proposeFiles !== undefined) {
    throw new UsageError("--propose is only valid in propose mode");
  }
}

function assertSummaryArgs(state: ParsedArgsState): void {
  if (state.summaryByDirectoryDepth !== undefined && state.mode !== "summary") {
    throw new UsageError("--by-directory is only valid with --summary");
  }
}

function assertTrendArgs(state: ParsedArgsState): void {
  if (state.trendSince !== undefined && state.mode !== "trend") {
    throw new UsageError("--since is only valid with --trend");
  }
  if (state.trendMax !== undefined && state.mode !== "trend") {
    throw new UsageError("--max is only valid with --trend");
  }
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const state = parseArgFlags(args);
  assertUpdateArgs(state);
  assertProposeArgs(state);
  assertSummaryArgs(state);
  assertTrendArgs(state);
  assertEditCheckArgs(state);
  assertEditRatchetCoverageArgs(state);
  return buildParsedArgs(state);
}

export function usage(): string {
  return [
    "usage: bun scripts/lint-ratchet.ts [--update [--allow-worse --reason <why> | --retire-ratchet <id>] | --check-baseline | --check-debt-accounting | --check-registry | --summary [--by-directory [depth]] | --trend [--since <date>] [--max <n>] | --zero-baseline | --report | --debt-log | --propose <ruleId> <glob...> | --edit-check-targets <relpath>... | --edit-check --targets-file <file> | --edit-ratchet-coverage <relpath>...]",
    "",
    "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
    "--retire-ratchet <id> drops a zero-finding orphan baseline floor without --allow-worse or a debt-log entry, but only when normal lint now errors on the retired scope (proven promotion).",
    "--summary prints committed baseline totals without running ESLint; add --by-directory [depth] to group remaining findings by directory. --trend reads committed baseline history and prints first/current/min/max totals; --zero-baseline audits drained ratchets against normal ESLint; --check-debt-accounting compares baseline increases to same-range debt-log entries; --report formats a diagnostics envelope from stdin; --debt-log renders the committed --allow-worse acceptance log.",
    "--propose <ruleId> <glob...> runs one core or local rule as a dry run and prints the would-be ratchet baseline without touching the registry or committed baseline.",
    "--edit-check-targets lists matching minimal-TS ratchets for edited paths (no ESLint); --edit-check lints the targets in <file> and prints only fresh ratchet regressions, for the edit-time advisory hook.",
    "--edit-ratchet-coverage prints, per edited path, the committed-baseline ratchet rule ids tracking it (no ESLint), for the lint-coverage advisory hook.",
  ].join("\n");
}
