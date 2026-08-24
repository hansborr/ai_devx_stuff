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

/**
 * The shape every walkable option shares. `rejectInlineForm` makes a value
 * option match its bare `--name` form only, so `--name=value` falls through to
 * the unknown-argument error (the sensor CLI's asymmetric inline contract).
 */
type CliWalkOption = {
  readonly name: string;
  readonly kind: "value" | "flag";
  readonly rejectInlineForm?: boolean;
  // Overrides the shared `<name> requires a value.\n<usage>` diagnostic for a
  // value option (and drops the usage suffix), so tools with their own
  // missing-value texts keep exact error identity.
  readonly valueErrorMessage?: string;
  // For a flag option: report `--name=value` with this message instead of the
  // shared unknown-argument error (the drift:ai "does not accept a value."
  // convention).
  readonly inlineValueErrorMessage?: string;
};

type CliWalkSpec<Option extends CliWalkOption> = {
  readonly argv: readonly string[];
  readonly usage: string;
  readonly createError: (message: string) => Error;
  readonly options: readonly Option[];
  readonly onValue: (option: Option, value: string) => void;
  readonly onFlag: (option: Option) => void;
  readonly onPositional: (value: string) => void;
  readonly onHelp?: () => never;
  readonly allowEmptyArgs?: boolean;
  readonly rejectPositionals?: boolean;
};

/**
 * The shared argv walk under `parseCli`: a `for`
 * loop over args with `requireArg` guarding empties, help flags first, then
 * each registered option (value options match `--name`/`--name=v` and read via
 * `readRequiredOptionValue`; flag and rejectInlineForm options match `--name`
 * exactly), then the shared `Unknown argument: <arg>\n<usage>` error for `--`
 * tokens, then positionals (which include single-dash tokens).
 *
 * S1 spike record (arch-plans-2026-07 leaf 02): per lint-arch leaf 08's idiom
 * the first cut compiled the spec down to `node:util` parseArgs, but the
 * compatibility tests in cli.test.ts pin concrete mismatches (option-like
 * tokens consumed as values, single-dash tokens exploded into short options
 * instead of positionals, inline values accepted on booleans, bare `--`
 * swallowed, and Node-owned strict-mode error text), so the proven hand walk
 * stays and parseArgs remains a tokenizer we deliberately do not use.
 */
// Whether `arg` selects `candidate`. Flags and rejectInlineForm value options
// match their bare `--name` only, except that a flag declaring an
// inlineValueErrorMessage also claims its `--name=value` form so the walk can
// report the tool's own diagnostic instead of the unknown-argument error.
function walkOptionMatches(candidate: CliWalkOption, arg: string): boolean {
  const exactOnly =
    candidate.kind === "flag"
      ? candidate.inlineValueErrorMessage === undefined
      : candidate.rejectInlineForm === true;
  return exactOnly ? arg === candidate.name : matchesOption(arg, candidate.name);
}

// Report a flag token carrying an inline `=value`. Reachable only for flags
// declaring inlineValueErrorMessage — walkOptionMatches never lets any other
// flag claim its inline form.
function failFlagInlineValue(
  option: CliWalkOption,
  arg: string,
  fail: (message: string) => never,
): void {
  if (arg === option.name || option.inlineValueErrorMessage === undefined) return;
  fail(option.inlineValueErrorMessage);
}

function walkCliArgs<Option extends CliWalkOption>(spec: CliWalkSpec<Option>): void {
  const { argv, usage, createError, options, onValue, onFlag, onPositional, onHelp } = spec;
  const fail = (message: string): never => {
    throw createError(message);
  };
  const readArg = spec.allowEmptyArgs === true ? requireArgAllowingEmpty : requireArg;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = readArg(argv[index], fail);
    if (onHelp !== undefined && isHelpFlag(arg)) onHelp();
    const option = options.find((candidate) => walkOptionMatches(candidate, arg));
    if (option === undefined) {
      // An empty usage opts out of the suffix for tools (code:intel) whose
      // smoke-locked unknown-argument diagnostics carry no usage text.
      // Keep this array form: plain `||` raises this function's complexity to 11 (max 10).
      if ([arg.startsWith("--"), spec.rejectPositionals].includes(true)) {
        fail(`Unknown argument: ${arg}${usage.length === 0 ? "" : `\n${usage}`}`);
      }
      onPositional(arg);
      continue;
    }
    if (option.kind === "flag") {
      failFlagInlineValue(option, arg, fail);
      onFlag(option);
      continue;
    }
    const parsed = readRequiredOptionValue({
      arg,
      argv,
      index,
      usage,
      ...(option.valueErrorMessage === undefined ? {} : { message: option.valueErrorMessage }),
      createError,
    });
    onValue(option, parsed.value);
    index = parsed.nextIndex;
  }
}

/** A value option in a `parseCli` spec; see `CliWalkOption` for the walk rules. */
type CliSpecValueOption = {
  readonly name: string;
  readonly kind: "value";
  // Collect every occurrence into a string[] (in argv order); the default is
  // last-occurrence-wins with a single string value.
  readonly repeatable?: boolean;
  readonly rejectInlineForm?: boolean;
  readonly valueErrorMessage?: string;
};

/** A boolean `--name` flag in a `parseCli` spec; present means `true`. */
type CliSpecFlagOption = {
  readonly name: string;
  readonly kind: "flag";
  readonly inlineValueErrorMessage?: string;
};

type CliSpecOption = CliSpecValueOption | CliSpecFlagOption;

/** The raw option record `parseCli` hands to the tool's schema. */
type RawCliOptionValues = Readonly<Record<string, string | true | readonly string[]>>;

/**
 * The minimal schema contract `parseCli` validates through — deliberately
 * structural (Zod's `safeParse` satisfies it) so the substrate itself stays
 * dependency-free and copy-portable. The schema owns coercion, defaults, and
 * every value-validation message; `parseCli` surfaces the first issue message
 * through the injected `createError` so error identity stays tool-local.
 */
type CliOptionsSchema<Options> = {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: Options }
    | {
        readonly success: false;
        readonly error: { readonly issues: readonly { readonly message: string }[] };
      };
};

export type ParseCliSpec<Options> = {
  readonly argv: readonly string[];
  readonly usage: string;
  readonly createError: (message: string) => Error;
  readonly options: readonly CliSpecOption[];
  readonly schema: CliOptionsSchema<Options>;
  readonly onHelp?: () => never;
  readonly allowEmptyArgs?: boolean;
  readonly rejectPositionals?: boolean;
};

/** One option occurrence the walk saw: the raw value for a value option, `true` for a flag. */
export type CliOptionEvent = {
  readonly name: string;
  readonly value: string | true;
};

export type ParsedCli<Options> = {
  readonly options: Options;
  readonly positionals: readonly string[];
  // Option names the walk actually saw, in first-occurrence argv order — the
  // presence information the raw-record accumulator already collects, exposed
  // so option-dependency diagnostics (e.g. "<flag> requires --packet-dir.")
  // can name the first offending flag without re-walking raw argv. Omitted
  // entirely (never `[]`) when the walk saw no options, keeping the result
  // shape of presence-free parses byte-stable.
  readonly seenOptions?: readonly string[];
  // Every option occurrence in argv order (repeats included), for consumers
  // whose semantics pair values across DIFFERENT options by position (e.g.
  // semgrep-candidates' --rule-license licensing the --semgrep-config it
  // follows) — ordering the flattened options record cannot carry. Omitted
  // when the walk saw no options, like seenOptions.
  readonly optionEvents?: readonly CliOptionEvent[];
};

/**
 * Spec-driven flat parse with a typed return: walk the argv once (same
 * mechanics and error text as the pre-spec substrate loop), accumulate seen options into a
 * raw record keyed by option name (`--format`), then validate it through the
 * tool's schema. Flags land as `true`, repeatable value options as ordered
 * string arrays, other value options as the last string seen. Positionals are
 * returned raw unless `rejectPositionals` is declared, in which case the walk
 * rejects the first positional at its token. Positional-count rules,
 * cross-flag validation, and exit-code mapping stay with the caller.
 */
export function parseCli<Options>(spec: ParseCliSpec<Options>): ParsedCli<Options> {
  const positionals: string[] = [];
  const seen = new Map<string, string | true | string[]>();
  const optionEvents: CliOptionEvent[] = [];
  walkCliArgs<CliSpecOption>({
    argv: spec.argv,
    usage: spec.usage,
    createError: spec.createError,
    options: spec.options,
    onValue: (option, value) => {
      optionEvents.push({ name: option.name, value });
      if (option.kind === "value" && option.repeatable === true) {
        const values = seen.get(option.name);
        if (Array.isArray(values)) values.push(value);
        else seen.set(option.name, [value]);
        return;
      }
      seen.set(option.name, value);
    },
    onFlag: (option) => {
      optionEvents.push({ name: option.name, value: true });
      seen.set(option.name, true);
    },
    onPositional: (value) => positionals.push(value),
    onHelp: spec.onHelp,
    allowEmptyArgs: spec.allowEmptyArgs,
    rejectPositionals: spec.rejectPositionals,
  });
  const raw: RawCliOptionValues = Object.fromEntries(seen);
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid command-line options.";
    throw spec.createError(message);
  }
  return {
    options: parsed.data,
    positionals,
    ...(seen.size === 0 ? {} : { seenOptions: [...seen.keys()] }),
    ...(optionEvents.length === 0 ? {} : { optionEvents }),
  };
}
