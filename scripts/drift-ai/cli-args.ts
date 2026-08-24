import { z } from "zod";

import { parseCli } from "../lib/cli.js";
import { ALL_CHECKS, CHECK_USAGE, DEFAULT_CHECKS } from "./check-metadata.js";
import { DriftAiError } from "./errors.js";
import { PROTOTYPE_ROOT_USAGE_LINES } from "./prototype-subcommand-definitions.js";
import {
  type CliOptions,
  DEFAULT_BASE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCOPE_MODE,
  type DriftCheckId,
} from "./types.js";

export class DriftAiHelp extends Error {
  // Defaults to the main-command usage; subcommands pass their own usage text so
  // `drift:ai <subcommand> --help` shows the right surface.
  constructor(message: string = usage()) {
    super(message);
    this.name = "DriftAiHelp";
  }
}

const CHECK_KEYS = new Set<string>(ALL_CHECKS);

function isCheckId(value: string): value is DriftCheckId {
  return CHECK_KEYS.has(value);
}

function usage(): string {
  return [
    "Usage:",
    "  bun run drift:ai",
    "  bun run drift:ai config [--config <path>] [--format <text|json>]",
    "  bun run drift:ai harness-freshness",
    ...PROTOTYPE_ROOT_USAGE_LINES,
    "  bun run drift:ai hotspots [--lens <churn|coupling|fragmentation|suppression-churn|thrash|all>] [--window <days>]",
    "  bun run drift:ai coldspots [--lens <coldspot|stale-markers|all>] [--window <days>]",
    "  bun run drift:ai --scope <changed|current>",
    "  bun run drift:ai --base <ref>",
    `  bun run drift:ai --check <${CHECK_USAGE}> [--check <...>]`,
    "  bun run drift:ai --root <path> [--root <path>]",
    "  bun run drift:ai --config <path>",
    "  bun run drift:ai --format <text|json>",
    "  bun run drift:ai --format json --include-scope",
    "  bun run drift:ai --output <path>",
    "  bun run drift:ai --chunk-dir <path> [--chunk-size <count>]",
    "  bun run drift:ai --jscpd-bin <path>",
    "  bun run drift:ai --knip-config <path>",
    "  bun run drift:ai --tsconfig <path>",
    "  bun run drift:ai --fail-on-findings",
    "  bun run drift:ai --scope current --check import-cycles --fail-on-runtime-cycles",
    "",
    "Report-only. Changed scope is the default; current scope audits the working tree.",
    "--fail-on-findings opts into exit 1 when findings exist; the default stays exit 0.",
    "--fail-on-runtime-cycles gates on runtime import cycles only (requires --check",
    "import-cycles or all); type-only cycles stay report-only evidence.",
  ].join("\n");
}

export const cliOptionsSchema = z.object({
  "--scope": z
    .enum(["changed", "current"], { error: "--scope requires changed or current." })
    .default(DEFAULT_SCOPE_MODE),
  "--base": z.string().optional(),
  "--check": z.array(z.string()).default([]),
  "--root": z.array(z.string()).default([]),
  "--config": z.string().optional(),
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
  "--chunk-dir": z.string().optional(),
  "--chunk-size": z
    .string()
    .regex(/^[1-9]\d*$/u, { error: "--chunk-size requires a positive integer." })
    .transform(Number)
    .optional(),
  "--jscpd-bin": z.string().optional(),
  "--knip-config": z.string().optional(),
  "--tsconfig": z.string().optional(),
  "--include-scope": z.boolean().default(false),
  "--fail-on-findings": z.boolean().default(false),
  "--fail-on-runtime-cycles": z.boolean().default(false),
});

function booleanFlag(name: string): {
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

// The parseCli option registry; the parity tests in drift-ai.test.ts hold this
// array, the Zod schema keys, and the usage text to the same option names.
export const CLI_OPTIONS = [
  { name: "--scope", kind: "value" },
  { name: "--base", kind: "value" },
  { name: "--check", kind: "value", repeatable: true },
  { name: "--root", kind: "value", repeatable: true },
  { name: "--config", kind: "value" },
  { name: "--format", kind: "value" },
  { name: "--output", kind: "value" },
  { name: "--chunk-dir", kind: "value" },
  { name: "--chunk-size", kind: "value" },
  { name: "--jscpd-bin", kind: "value" },
  { name: "--knip-config", kind: "value" },
  { name: "--tsconfig", kind: "value" },
  booleanFlag("--include-scope"),
  booleanFlag("--fail-on-findings"),
  booleanFlag("--fail-on-runtime-cycles"),
] as const;

// `--check` values resolve tool-side (not in the schema) so the exact
// `Unknown check: <value>\n<usage>` diagnostic and the dedupe-preserving-order
// accumulation stay byte-identical to the hand parser.
function resolveRequestedChecks(values: readonly string[]): {
  requested: DriftCheckId[];
  allRequested: boolean;
} {
  const requested: DriftCheckId[] = [];
  let allRequested = false;
  for (const value of values) {
    if (value === "all") {
      allRequested = true;
      continue;
    }
    if (!isCheckId(value)) throw new DriftAiError(`Unknown check: ${value}\n${usage()}`);
    if (!requested.includes(value)) requested.push(value);
  }
  return { requested, allRequested };
}

type ParsedDriftAiOptions = z.output<typeof cliOptionsSchema>;

function validateScopeOptions(parsed: ParsedDriftAiOptions): void {
  if (parsed["--scope"] === "current" && parsed["--base"] !== undefined) {
    throw new DriftAiError(
      "--scope current does not accept --base; current scope has no merge base.",
    );
  }
  if (parsed["--scope"] === "changed" && parsed["--root"].length > 0) {
    throw new DriftAiError("--root is only valid with --scope current.");
  }
}

function validateChunkOptions(parsed: ParsedDriftAiOptions): void {
  if (parsed["--chunk-size"] === undefined) return;
  if (parsed["--chunk-dir"] === undefined) {
    throw new DriftAiError("--chunk-size is only valid with --chunk-dir.");
  }
}

// The runtime-cycle gate is meaningless when the run never dispatches the
// import-cycles check (it is opt-in, so a bare run excludes it); reject that
// instead of letting a misconfigured gate pass green forever.
function validateRuntimeCycleGate(
  parsed: ParsedDriftAiOptions,
  checks: readonly DriftCheckId[],
): void {
  if (!parsed["--fail-on-runtime-cycles"]) return;
  if (!checks.includes("import-cycles")) {
    throw new DriftAiError(
      "--fail-on-runtime-cycles requires --check import-cycles (or --check all).",
    );
  }
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const { options, positionals } = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new DriftAiError(message),
    // Empty-string args flow through to the unknown-argument rejection below,
    // matching the hand parser's requireArgAllowingEmpty behavior.
    allowEmptyArgs: true,
    onHelp: () => {
      throw new DriftAiHelp();
    },
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });

  // drift:ai's main command takes no positionals; subcommand routing happens
  // before parseArgs in the entrypoint.
  const stray = positionals[0];
  if (stray !== undefined) throw new DriftAiError(`Unknown argument: ${stray}\n${usage()}`);

  const checks = resolveChecks(options["--check"]);
  validateScopeOptions(options);
  validateChunkOptions(options);
  validateRuntimeCycleGate(options, checks);
  return cliOptionsFromParsed(options, checks);
}

function resolveChecks(values: readonly string[]): DriftCheckId[] {
  const { requested, allRequested } = resolveRequestedChecks(values);
  if (allRequested) return [...ALL_CHECKS];
  if (requested.length === 0) return [...DEFAULT_CHECKS];
  return requested;
}

function cliOptionsFromParsed(
  options: ParsedDriftAiOptions,
  checks: readonly DriftCheckId[],
): CliOptions {
  const base = options["--base"];
  const chunkDir = options["--chunk-dir"];
  return {
    scopeMode: options["--scope"],
    base: base ?? DEFAULT_BASE,
    baseExplicit: base !== undefined,
    checks,
    format: options["--format"],
    roots: options["--root"],
    ...(options["--config"] === undefined ? {} : { configPath: options["--config"] }),
    ...(options["--output"] === undefined ? {} : { outputPath: options["--output"] }),
    ...(chunkDir === undefined
      ? {}
      : { chunkDir, chunkSize: options["--chunk-size"] ?? DEFAULT_CHUNK_SIZE }),
    ...(options["--jscpd-bin"] === undefined ? {} : { jscpdBin: options["--jscpd-bin"] }),
    ...(options["--knip-config"] === undefined ? {} : { knipConfig: options["--knip-config"] }),
    ...(options["--tsconfig"] === undefined ? {} : { tsconfig: options["--tsconfig"] }),
    includeScope: options["--include-scope"],
    failOnFindings: options["--fail-on-findings"],
    failOnRuntimeCycles: options["--fail-on-runtime-cycles"],
  };
}
