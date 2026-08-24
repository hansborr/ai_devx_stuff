// Shared argument substrate for drift:ai SUBCOMMANDS (hotspots, coldspots,
// harness-freshness, config, and the prototype advisories). Each subcommand
// parses through `parseSubcommandCli` — the same per-subcommand `parseCli` +
// Zod pattern the main command adopted in `cli-args.ts` — composing the base
// fragments below with its own options; result assembly stays hand-written per
// subcommand. The main `drift:ai` command keeps its own richer parser in
// `cli-args.ts`.
//
// Documented decision (backlog unit 120, discharging the deferral this header
// used to record for task 50 Low-1): the callback-record SubcommandSpec layer
// is retired in favor of parseCli+Zod, but subcommands and cli-args
// deliberately do NOT share one flag table — the main command's flag surface
// stays stable and separate, and registry agreement is guarded by parity
// tests, not a declarative per-option derivation layer.

import { z } from "zod";

import { type CliFormat, parseCli, type ParseCliSpec, type ParsedCli } from "../lib/cli.js";
import { DriftAiHelp } from "./cli-args.js";
import { type DriftAiCommandResult, sentinelToCommandResult } from "./command-result.js";
import { loadDriftAiConfig, type LoadedDriftAiConfig } from "./config.js";
import { DriftAiError } from "./errors.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";

export type SubcommandFormat = CliFormat;

export type SubcommandBaseOptions = {
  readonly format: SubcommandFormat;
  readonly outputPath: string | null;
  readonly configPath: string | null;
};

// parseCli option fragment for the base surface every subcommand accepts.
// Spread it into a subcommand's option array alongside the subcommand's own
// options; the Zod counterpart is `subcommandBaseSchemaShape` below.
export const SUBCOMMAND_BASE_CLI_OPTIONS = [
  { name: "--format", kind: "value" },
  { name: "--output", kind: "value" },
] as const;

// `--config` stays opt-in: a subcommand that does not read config (e.g.
// harness-freshness) rejects it as unknown rather than advertising an inert
// flag whose value is silently ignored. Compose with `configSchemaShape`.
export const CONFIG_CLI_OPTION = { name: "--config", kind: "value" } as const;

// Zod shape fragment for the base surface; spread into a subcommand's
// `z.object`. The enum error keeps the shared "--format requires text or
// json." diagnostic byte-identical to the retired callback layer's readFormat.
export const subcommandBaseSchemaShape = {
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
};

// Zod shape fragment for the opt-in `--config` option.
export const configSchemaShape = {
  "--config": z.string().optional(),
};

// A valueless `--name` flag whose `--name=value` form fails with the drift:ai
// "does not accept a value." convention (same shape cli-args' booleanFlag
// builds for the main command).
export function subcommandBooleanFlag(name: string): {
  readonly name: string;
  readonly kind: "flag";
  readonly inlineValueErrorMessage: string;
} {
  return {
    name,
    kind: "flag" as const,
    inlineValueErrorMessage: `${name} does not accept a value.`,
  };
}

// What a subcommand schema's output must carry for base assembly: the format
// default always lands, --output/--config only when the fragments above are
// composed in (extra subcommand-specific keys flow through structurally).
type SubcommandBaseParsedOptions = {
  readonly "--format": SubcommandFormat;
  readonly "--output"?: string | undefined;
  readonly "--config"?: string | undefined;
};

// Hand-written, compiler-checked assembly from a parsed record to the shared
// base options (no table-derived mapping; see the unit-120 binding rulings).
export function subcommandBaseFromOptions(
  options: SubcommandBaseParsedOptions,
): SubcommandBaseOptions {
  return {
    format: options["--format"],
    outputPath: options["--output"] ?? null,
    configPath: options["--config"] ?? null,
  };
}

// Per-subcommand `parseCli` entry: binds the drift:ai error/help identity and
// the subcommand token policies once — empty argv entries flow through to the
// unknown-argument rejection, and positionals are rejected at their token —
// so each subcommand passes only its usage, option array, and Zod schema.
export function parseSubcommandCli<Options>(spec: {
  readonly argv: readonly string[];
  readonly usage: string;
  readonly options: ParseCliSpec<Options>["options"];
  readonly schema: ParseCliSpec<Options>["schema"];
}): ParsedCli<Options> {
  return parseCli({
    argv: spec.argv,
    usage: spec.usage,
    createError: (message) => new DriftAiError(message),
    onHelp: () => {
      throw new DriftAiHelp(spec.usage);
    },
    allowEmptyArgs: true,
    rejectPositionals: true,
    options: spec.options,
    schema: spec.schema,
  });
}

// Read and JSON-parse a `--baseline <prev.json>` file for a subcommand's delta
// tagging. Hotspots and coldspots both consume an untrusted prior advisory, so
// the read/parse flow and its two distinct DriftAiError messages (unreadable
// vs. invalid JSON) live here once, reached through prepareSubcommandInputs.
// Returns `unknown`: the caller narrows the parsed shape downstream.
function loadBaseline(path: string, read: (path: string) => string): unknown {
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

// The `--config`/`--baseline` input surface shared by the advisory subcommands
// (hotspots and coldspots): both load the optional config and prior-advisory
// baseline up front, and both map sentinel errors through the shared drift-ai
// mapper (a DriftAiError becomes the standard exit-2 message, like the main
// command) rather than letting them escape as a stack trace + exit 1.
export type PreparedSubcommandInputs =
  | { readonly ok: true; readonly config: LoadedDriftAiConfig; readonly baseline: unknown }
  | { readonly ok: false; readonly result: DriftAiCommandResult };

export function prepareSubcommandInputs(
  parsed: { readonly base: SubcommandBaseOptions; readonly baselinePath: string | null },
  repoRoot: string,
  read: (path: string) => string,
): PreparedSubcommandInputs {
  try {
    const config = loadDriftAiConfig({
      repoRoot,
      ...(parsed.base.configPath === null ? {} : { configPath: parsed.base.configPath }),
    });
    const baseline = parsed.baselinePath === null ? null : loadBaseline(parsed.baselinePath, read);
    return { ok: true, config, baseline };
  } catch (err) {
    return { ok: false, result: sentinelToCommandResult(err) };
  }
}
