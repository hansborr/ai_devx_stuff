// Argument grammar for the harness:registration:check entrypoint. No
// arguments keeps the byte-stable registration-check behavior; any argument
// list without `--explain` keeps the historical unknown-argument rejection.
// Selectors are explicitly typed (`--path`, `--control`, `--script`) so
// overlapping names are never disambiguated heuristically, and the output
// format is an explicit text/JSON choice.

import type { ExplainSelector, ExplainSelectorKind } from "./registration-explain-model.js";

const EXPLAIN_USAGE =
  "--explain usage: --explain (--path <repo-path> | --control <control-id> | --script <package-script-name>) [--json]";

const SELECTOR_FLAGS: ReadonlyMap<string, ExplainSelectorKind> = new Map([
  ["--path", "path"],
  ["--control", "control"],
  ["--script", "script"],
]);

export type RegistrationCliCommand =
  | { readonly mode: "check" }
  | {
      readonly mode: "explain";
      readonly selector: ExplainSelector;
      readonly format: "text" | "json";
    }
  | { readonly mode: "usage-error"; readonly message: string };

interface ExplainParseState {
  selector?: ExplainSelector;
  json: boolean;
  seenExplain: boolean;
}

function usageError(message: string): RegistrationCliCommand {
  return { mode: "usage-error", message: `${message}; ${EXPLAIN_USAGE}` };
}

const FLAG_ONLY_CONSUMED = 1;
const FLAG_WITH_VALUE_CONSUMED = 2;

function consumeSelectorFlag(
  arg: string,
  kind: ExplainSelectorKind,
  value: string | undefined,
  state: ExplainParseState,
): number | RegistrationCliCommand {
  if (state.selector !== undefined) return usageError("exactly one selector is allowed");
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    return usageError(`${arg} requires a value`);
  }
  state.selector = { kind, value };
  return FLAG_WITH_VALUE_CONSUMED;
}

/** Returns the number of consumed arguments, or a usage error. */
function consumeExplainArg(
  args: readonly string[],
  index: number,
  state: ExplainParseState,
): number | RegistrationCliCommand {
  const arg = args[index] ?? "";
  if (arg === "--explain") {
    if (state.seenExplain) return usageError("duplicate --explain");
    state.seenExplain = true;
    return FLAG_ONLY_CONSUMED;
  }
  if (arg === "--json") {
    if (state.json) return usageError("duplicate --json");
    state.json = true;
    return FLAG_ONLY_CONSUMED;
  }
  const kind = SELECTOR_FLAGS.get(arg);
  if (kind === undefined) return usageError(`unknown --explain argument: ${arg}`);
  return consumeSelectorFlag(arg, kind, args[index + 1], state);
}

export function parseRegistrationCheckArgs(args: readonly string[]): RegistrationCliCommand {
  if (args.length === 0) return { mode: "check" };
  if (!args.includes("--explain")) {
    return { mode: "usage-error", message: `unknown argument(s): ${args.join(", ")}` };
  }
  const state: ExplainParseState = { json: false, seenExplain: false };
  let index = 0;
  while (index < args.length) {
    const consumed = consumeExplainArg(args, index, state);
    if (typeof consumed !== "number") return consumed;
    index += consumed;
  }
  if (state.selector === undefined) return usageError("--explain requires a selector");
  return { mode: "explain", selector: state.selector, format: state.json ? "json" : "text" };
}
