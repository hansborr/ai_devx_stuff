import { optionName, readFormat, readPath, readValue } from "./arg-readers.js";
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

type ParsedCliOptions = {
  scopeMode: CliOptions["scopeMode"];
  base: string;
  baseExplicit: boolean;
  format: CliOptions["format"];
  roots: string[];
  configPath?: string;
  outputPath?: string;
  chunkDir?: string;
  chunkSize?: number;
  jscpdBin?: string;
  knipConfig?: string;
  tsconfig?: string;
  requested: DriftCheckId[];
  allRequested: boolean;
  includeScope: boolean;
  failOnFindings: boolean;
  failOnRuntimeCycles: boolean;
};

function initialParsedOptions(): ParsedCliOptions {
  return {
    scopeMode: DEFAULT_SCOPE_MODE,
    base: DEFAULT_BASE,
    baseExplicit: false,
    format: "text",
    roots: [],
    requested: [],
    allRequested: false,
    includeScope: false,
    failOnFindings: false,
    failOnRuntimeCycles: false,
  };
}

function parseScopeOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const option = readValue(arg, argv, index, usage());
  if (option.value !== "changed" && option.value !== "current") {
    throw new DriftAiError("--scope requires changed or current.");
  }
  parsed.scopeMode = option.value;
  return option.nextIndex;
}

function parsePathOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const name = optionName(arg);
  const option = readValue(arg, argv, index, usage());
  if (!option.value) {
    throw new DriftAiError(
      name === "--base" ? "--base requires a ref." : `${name} requires a path.`,
    );
  }
  if (name === "--base") {
    parsed.base = option.value;
    parsed.baseExplicit = true;
  } else if (name === "--root") {
    parsed.roots.push(option.value);
  } else {
    parsed.configPath = option.value;
  }
  return option.nextIndex;
}

function parseOutputOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  if (optionName(arg) === "--format") {
    const option = readValue(arg, argv, index, usage());
    parsed.format = readFormat(option.value);
    return option.nextIndex;
  }
  const option = readValue(arg, argv, index, usage());
  parsed.outputPath = readPath("--output", option.value);
  return option.nextIndex;
}

function parseChunkOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  if (optionName(arg) === "--chunk-dir") {
    const option = readValue(arg, argv, index, usage());
    parsed.chunkDir = readPath("--chunk-dir", option.value);
    return option.nextIndex;
  }
  const option = readValue(arg, argv, index, usage());
  if (!/^[1-9]\d*$/u.test(option.value)) {
    throw new DriftAiError("--chunk-size requires a positive integer.");
  }
  parsed.chunkSize = Number(option.value);
  return option.nextIndex;
}

// Single-valued tool/path options that just stash a path on `parsed`: --jscpd-bin,
// --knip-config, --tsconfig. They share the read-value-or-error shape, so one
// parser keyed by option name keeps them DRY.
function parseToolPathOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const name = optionName(arg);
  const option = readValue(arg, argv, index, usage());
  const pathValue = readPath(name, option.value);
  if (name === "--jscpd-bin") parsed.jscpdBin = pathValue;
  else if (name === "--knip-config") parsed.knipConfig = pathValue;
  else parsed.tsconfig = pathValue;
  return option.nextIndex;
}

// Valueless boolean flags (present = true): --include-scope, --fail-on-findings,
// --fail-on-runtime-cycles. One parser keyed by option name keeps them DRY
// alongside the declarative OPTION_PARSERS table, mirroring parseToolPathOption
// for the single-value paths.
function parseBooleanFlag(
  arg: string,
  _argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const name = optionName(arg);
  if (arg !== name) throw new DriftAiError(`${name} does not accept a value.`);
  if (name === "--include-scope") parsed.includeScope = true;
  else if (name === "--fail-on-findings") parsed.failOnFindings = true;
  else if (name === "--fail-on-runtime-cycles") parsed.failOnRuntimeCycles = true;
  // An unhandled name falls through to parseArgs' unknown-argument error rather
  // than silently arming the wrong flag if a future boolean flag forgets a branch.
  else return undefined;
  return index;
}

function parseCheckOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const option = readValue(arg, argv, index, usage());
  if (!option.value) {
    throw new DriftAiError(`--check requires ${CHECK_USAGE.replace(/\|/gu, ", ")}.`);
  }
  if (option.value === "all") {
    parsed.allRequested = true;
    return option.nextIndex;
  }
  if (!isCheckId(option.value))
    throw new DriftAiError(`Unknown check: ${option.value}\n${usage()}`);
  if (!parsed.requested.includes(option.value)) parsed.requested.push(option.value);
  return option.nextIndex;
}

type OptionParser = (
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
) => number | undefined;

const OPTION_PARSERS: Readonly<Record<string, OptionParser>> = {
  "--scope": parseScopeOption,
  "--base": parsePathOption,
  "--check": parseCheckOption,
  "--root": parsePathOption,
  "--config": parsePathOption,
  "--format": parseOutputOption,
  "--output": parseOutputOption,
  "--chunk-dir": parseChunkOption,
  "--chunk-size": parseChunkOption,
  "--jscpd-bin": parseToolPathOption,
  "--knip-config": parseToolPathOption,
  "--tsconfig": parseToolPathOption,
  "--include-scope": parseBooleanFlag,
  "--fail-on-findings": parseBooleanFlag,
  "--fail-on-runtime-cycles": parseBooleanFlag,
};

function parseKnownOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  return OPTION_PARSERS[optionName(arg)]?.(arg, argv, index, parsed);
}

function validateScopeOptions(parsed: ParsedCliOptions): void {
  if (parsed.scopeMode === "current" && parsed.baseExplicit) {
    throw new DriftAiError(
      "--scope current does not accept --base; current scope has no merge base.",
    );
  }
  if (parsed.scopeMode === "changed" && parsed.roots.length > 0) {
    throw new DriftAiError("--root is only valid with --scope current.");
  }
}

function validateChunkOptions(parsed: ParsedCliOptions): void {
  if (parsed.chunkSize === undefined) return;
  if (parsed.chunkDir === undefined) {
    throw new DriftAiError("--chunk-size is only valid with --chunk-dir.");
  }
}

// The runtime-cycle gate is meaningless when the run never dispatches the
// import-cycles check (it is opt-in, so a bare run excludes it); reject that
// instead of letting a misconfigured gate pass green forever.
function validateRuntimeCycleGate(parsed: ParsedCliOptions): void {
  if (!parsed.failOnRuntimeCycles) return;
  if (!resolveChecks(parsed).includes("import-cycles")) {
    throw new DriftAiError(
      "--fail-on-runtime-cycles requires --check import-cycles (or --check all).",
    );
  }
}

function resolveChecks(parsed: ParsedCliOptions): DriftCheckId[] {
  if (parsed.allRequested) return [...ALL_CHECKS];
  if (parsed.requested.length === 0) return [...DEFAULT_CHECKS];
  return parsed.requested;
}

function cliOptionsFromParsed(parsed: ParsedCliOptions): CliOptions {
  return {
    scopeMode: parsed.scopeMode,
    base: parsed.base,
    baseExplicit: parsed.baseExplicit,
    checks: resolveChecks(parsed),
    format: parsed.format,
    roots: parsed.roots,
    ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
    ...(parsed.outputPath === undefined ? {} : { outputPath: parsed.outputPath }),
    ...(parsed.chunkDir === undefined
      ? {}
      : { chunkDir: parsed.chunkDir, chunkSize: parsed.chunkSize ?? DEFAULT_CHUNK_SIZE }),
    ...(parsed.jscpdBin === undefined ? {} : { jscpdBin: parsed.jscpdBin }),
    ...(parsed.knipConfig === undefined ? {} : { knipConfig: parsed.knipConfig }),
    ...(parsed.tsconfig === undefined ? {} : { tsconfig: parsed.tsconfig }),
    includeScope: parsed.includeScope,
    failOnFindings: parsed.failOnFindings,
    failOnRuntimeCycles: parsed.failOnRuntimeCycles,
  };
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const parsed = initialParsedOptions();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new DriftAiError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") {
      throw new DriftAiHelp();
    }
    const nextIndex = parseKnownOption(arg, argv, index, parsed);
    if (nextIndex === undefined) throw new DriftAiError(`Unknown argument: ${arg}\n${usage()}`);
    index = nextIndex;
  }

  validateScopeOptions(parsed);
  validateChunkOptions(parsed);
  validateRuntimeCycleGate(parsed);
  return cliOptionsFromParsed(parsed);
}
