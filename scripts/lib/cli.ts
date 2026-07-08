import {
  readRequiredOptionValue,
  requireArg,
  requireArgAllowingEmpty,
} from "../cli-option-values.js";

// Shared CLI arg-loop substrate for the flat harness tools (logs:audit,
// harness:audit, and the --format contract shared with code:intel). It layers
// the argv loop, option dispatch, and the `--format` value contract over the
// low-level value reader in ../cli-option-values.ts. Each tool keeps its own
// usage text and Error identity (both injected), so error/help shapes stay
// tool-local — only the mechanics are shared. Tools with a subcommand matrix
// (code:intel) or a bespoke internal parser (drift:ai) adopt only the pieces
// that fit (e.g. parseFormatValue) and keep their own loop.

/** The two output formats every diagnostics-capable tool understands. */
export type CliFormat = "text" | "json";

/** Validate a `--format` value against the shared text|json contract. */
export function parseFormatValue(value: string, fail: (message: string) => never): CliFormat {
  if (value !== "text" && value !== "json") fail("--format requires text or json.");
  return value;
}

/** True when `arg` is `--name` or `--name=<value>` (a value-bearing option match). */
export function matchesOption(arg: string, name: string): boolean {
  return arg === name || arg.startsWith(`${name}=`);
}

/** True for the conventional help flags. */
export function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

/** A `--name <value>` / `--name=<value>` option; `apply` receives the read value. */
type CliValueOption = {
  readonly name: string;
  readonly kind: "value";
  readonly apply: (value: string) => void;
};

/** A boolean `--name` flag; matched exactly (so `--name=x` is an unknown arg). */
type CliFlagOption = {
  readonly name: string;
  readonly kind: "flag";
  readonly apply: () => void;
};

type CliOption = CliValueOption | CliFlagOption;

export type ParseCliArgsSpec = {
  readonly argv: readonly string[];
  readonly usage: string;
  readonly createError: (message: string) => Error;
  readonly options: readonly CliOption[];
  readonly onPositional: (value: string) => void;
  readonly onHelp?: () => never;
  // Legacy parsers let an empty-string arg flow through to a positional (where
  // it fails later as an unreadable file) rather than rejecting it up front.
  // Off by default (strict); logs:audit and harness:audit opt in to match their
  // pre-substrate requireArgAllowingEmpty behavior.
  readonly allowEmptyArgs?: boolean;
};

/**
 * Walk a flat option/positional argv the way the harness CLIs do: a `for` loop
 * over args with `requireArg` guarding empties, help flags first, then each
 * registered option (value options match `--name`/`--name=v` and read via
 * `readRequiredOptionValue`; flag options match `--name` exactly), then the
 * shared `Unknown argument: <arg>\n<usage>` error, then positionals. Post-loop
 * validation (required counts, mutually exclusive flags) stays with the caller.
 * `createError` seeds every failure so error identity stays tool-local.
 */
export function parseCliArgs(spec: ParseCliArgsSpec): void {
  const { argv, usage, createError, options, onPositional, onHelp } = spec;
  const fail = (message: string): never => {
    throw createError(message);
  };
  const readArg = spec.allowEmptyArgs === true ? requireArgAllowingEmpty : requireArg;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = readArg(argv[index], fail);
    if (onHelp !== undefined && isHelpFlag(arg)) onHelp();
    const option = options.find((candidate) =>
      candidate.kind === "flag" ? arg === candidate.name : matchesOption(arg, candidate.name),
    );
    if (option === undefined) {
      if (arg.startsWith("--")) fail(`Unknown argument: ${arg}\n${usage}`);
      onPositional(arg);
      continue;
    }
    if (option.kind === "flag") {
      option.apply();
      continue;
    }
    const parsed = readRequiredOptionValue({ arg, argv, index, usage, createError });
    option.apply(parsed.value);
    index = parsed.nextIndex;
  }
}
