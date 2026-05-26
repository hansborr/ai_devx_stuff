export const PROCESS_ARG_OFFSET = 2;

export interface ParsedArgs {
  readonly mode:
    | "default"
    | "update"
    | "check-baseline"
    | "check-registry"
    | "summary"
    | "zero-baseline"
    | "report";
  readonly allowWorse: boolean;
  readonly reason?: string;
}

interface ParsedArgsState {
  mode: ParsedArgs["mode"];
  allowWorse: boolean;
  reason?: string;
}

export class UsageError extends Error {}

const parsedArgModes = new Map<string, Exclude<ParsedArgs["mode"], "default">>([
  ["--update", "update"],
  ["--check-baseline", "check-baseline"],
  ["--check-registry", "check-registry"],
  ["--summary", "summary"],
  ["--zero-baseline", "zero-baseline"],
  ["--report", "report"],
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

export function parseArgs(args: readonly string[]): ParsedArgs {
  const { mode, allowWorse, reason } = parseArgFlags(args);
  if (allowWorse && mode !== "update") {
    throw new UsageError("--allow-worse is only valid with --update");
  }
  if (reason !== undefined && mode !== "update") {
    throw new UsageError("--reason is only valid with --update");
  }
  if (allowWorse && (reason?.trim() ?? "").length === 0) {
    throw new UsageError("--allow-worse requires a non-empty --reason");
  }
  return reason === undefined ? { mode, allowWorse } : { mode, allowWorse, reason };
}

export function usage(): string {
  return [
    "usage: bun scripts/lint-ratchet.ts [--update [--allow-worse --reason <why>] | --check-baseline | --check-registry | --summary | --zero-baseline | --report]",
    "",
    "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
    "--summary prints committed baseline totals without running ESLint; --zero-baseline audits drained ratchets against normal ESLint; --report formats a diagnostics envelope from stdin.",
  ].join("\n");
}
