// Shared argument parser for drift:ai SUBCOMMANDS (hotspots, harness-freshness).
// Subcommands historically did bespoke arg handling with no `--format`/`--output`
// parity; this gives them one parser so they converge instead of forking. The
// main `drift:ai` command keeps its own richer parser in `cli-args.ts`.
//
// Coordinates with backlog task 50 (Med-1 / M4 / L1): that cleanup defers to this
// parser shape for the harness-freshness retrofit. A future declarative per-option
// table (task 50 Low-1) could unify this with cli-args, but they are kept separate
// for now so the main command's flag surface stays stable.

import type { OutputFormat } from "./arg-readers.js";
import { optionName, readFormat, readPath, readValue } from "./arg-readers.js";
import { DriftAiHelp } from "./cli-args.js";
import { DriftAiError } from "./errors.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";

export type SubcommandFormat = OutputFormat;

export type SubcommandBaseOptions = {
  readonly format: SubcommandFormat;
  readonly outputPath: string | null;
  readonly configPath: string | null;
};

// A per-subcommand value option: given the raw value, validate and stash it
// (mutating the subcommand's own accumulator). Throws DriftAiError on a bad value.
export type SubcommandValueOption = (value: string) => void;

// A per-subcommand valueless boolean flag (present = true): the handler flips the
// subcommand's own accumulator. Mirrors the main parser's parseBooleanFlag.
export type SubcommandFlagOption = () => void;

export type SubcommandSpec = {
  // Full usage text, shown on `--help` and appended to unknown-arg / missing-value
  // errors so the surface is discoverable.
  readonly usage: string;
  // Subcommand-specific value-taking options keyed by flag name (e.g. "--lens").
  readonly valueOptions?: Readonly<Record<string, SubcommandValueOption>>;
  // Subcommand-specific path-taking options keyed by flag name (e.g. "--root").
  // Values flow through the same non-empty path validation as universal path flags.
  readonly pathValueOptions?: Readonly<Record<string, SubcommandValueOption>>;
  // Subcommand-specific valueless flags keyed by flag name (e.g. "--allow-live-registry").
  // `--flag=value` is rejected: a boolean flag never takes a value.
  readonly flagOptions?: Readonly<Record<string, SubcommandFlagOption>>;
  // Whether this subcommand consumes `--config`. Opt-in: a subcommand that does not
  // read config (e.g. harness-freshness) rejects `--config` as unknown rather than
  // advertising an inert flag whose value is silently ignored.
  readonly acceptsConfig?: boolean;
};

type MutableBase = {
  format: SubcommandFormat;
  outputPath: string | null;
  configPath: string | null;
};

// `--format` and `--output` are accepted by every subcommand. `--config` is opt-in
// (see SubcommandSpec.acceptsConfig) and handled separately below.
const UNIVERSAL_SETTERS: Readonly<Record<string, (value: string, base: MutableBase) => void>> = {
  "--format": (value, base) => {
    base.format = readFormat(value);
  },
  "--output": (value, base) => {
    base.outputPath = readPath("--output", value);
  },
};

function configSetter(value: string, base: MutableBase): void {
  base.configPath = readPath("--config", value);
}

// Resolve the universal setter for a flag: `--format`/`--output` always, `--config`
// only when the subcommand opts in. Returns undefined for non-universal flags so the
// caller can fall through to subcommand-specific options.
function universalSetterFor(
  name: string,
  spec: SubcommandSpec,
): ((value: string, base: MutableBase) => void) | undefined {
  const setter = UNIVERSAL_SETTERS[name];
  if (setter !== undefined) return setter;
  if (name === "--config" && spec.acceptsConfig === true) return configSetter;
  return undefined;
}

// Parse subcommand argv (already sliced past the subcommand token) into the
// `--format`/`--output` options (plus opt-in `--config`; see acceptsConfig),
// dispatching subcommand extras (e.g. `--lens`, `--window`) to the spec's
// value-option handlers.
export function parseSubcommandArgs(
  argv: readonly string[],
  spec: SubcommandSpec,
): SubcommandBaseOptions {
  const base: MutableBase = { format: "text", outputPath: null, configPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new DriftAiError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") throw new DriftAiHelp(spec.usage);
    index = dispatchSubcommandArg(arg, argv, index, spec, base);
  }
  return { format: base.format, outputPath: base.outputPath, configPath: base.configPath };
}

// Dispatch one argv entry to its handler (universal setter, valueless flag, path
// option, then value option) and return the index of the last token it consumed.
// Throws DriftAiError on an unknown argument.
function dispatchSubcommandArg(
  arg: string,
  argv: readonly string[],
  index: number,
  spec: SubcommandSpec,
  base: MutableBase,
): number {
  const name = optionName(arg);
  const universal = universalSetterFor(name, spec);
  if (universal !== undefined) {
    const { value, nextIndex } = readValue(arg, argv, index, spec.usage);
    universal(value, base);
    return nextIndex;
  }
  const flag = spec.flagOptions?.[name];
  if (flag !== undefined) {
    if (arg !== name) throw new DriftAiError(`${name} does not accept a value.`);
    flag();
    return index;
  }
  const pathExtra = spec.pathValueOptions?.[name];
  if (pathExtra !== undefined) {
    const { value, nextIndex } = readValue(arg, argv, index, spec.usage);
    pathExtra(readPath(name, value));
    return nextIndex;
  }
  const extra = spec.valueOptions?.[name];
  if (extra !== undefined) {
    const { value, nextIndex } = readValue(arg, argv, index, spec.usage);
    extra(value);
    return nextIndex;
  }
  throw new DriftAiError(`Unknown argument: ${arg}\n${spec.usage}`);
}

// Read and JSON-parse a `--baseline <prev.json>` file for a subcommand's delta
// tagging. Shared by hotspots and coldspots — both consume an untrusted prior
// advisory, so the read/parse flow and its two distinct DriftAiError messages
// (unreadable vs. invalid JSON) live here once. Returns `unknown`: the caller
// narrows the parsed shape downstream.
export function loadBaseline(path: string, read: (path: string) => string): unknown {
  let raw: string;
  try {
    raw = read(path);
  } catch {
    throw new DriftAiError(`--baseline file does not exist or is unreadable: ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new DriftAiError(`--baseline file is not valid JSON: ${path}`);
  }
}

// Write a subcommand's rendered output: to a file (returning a pointer message)
// when `--output` is set, else return the rendering itself for stdout.
export function writeSubcommandOutput(
  options: Pick<SubcommandBaseOptions, "format" | "outputPath">,
  rendered: string,
  writer: ReportWriter = defaultReportWriter,
): string {
  if (options.outputPath === null) return rendered;
  writer(options.outputPath, `${rendered}\n`);
  return `drift:ai: wrote ${options.format} report to ${options.outputPath}`;
}
