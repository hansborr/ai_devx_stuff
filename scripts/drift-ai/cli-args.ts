import { DriftAiError } from "./errors.js";
import {
  ALL_CHECKS,
  type CliOptions,
  DEFAULT_BASE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCOPE_MODE,
  type DriftCheckId,
} from "./types.js";

export class DriftAiHelp extends Error {
  constructor() {
    super(usage());
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
    "  bun run drift:ai harness-freshness",
    "  bun run drift:ai --scope <changed|current>",
    "  bun run drift:ai --base <ref>",
    "  bun run drift:ai --check <duplicates|ghost-files|comments|suppressions|all> [--check <...>]",
    "  bun run drift:ai --root <path> [--root <path>]",
    "  bun run drift:ai --config <path>",
    "  bun run drift:ai --format <text|json>",
    "  bun run drift:ai --output <path>",
    "  bun run drift:ai --chunk-dir <path> [--chunk-size <count>]",
    "",
    "Report-only. Changed scope is the default; current scope audits the working tree.",
  ].join("\n");
}

function readOptionValue(
  arg: string,
  argv: readonly string[],
  index: number,
): {
  value: string;
  nextIndex: number;
} {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined) throw new DriftAiError(`${arg} requires a value.\n${usage()}`);
  return { value: next, nextIndex: index + 1 };
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
  requested: DriftCheckId[];
  allRequested: boolean;
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
  };
}

function optionNameFor(arg: string): string {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex < 0 ? arg : arg.slice(0, equalsIndex);
}

function parseScopeOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const option = readOptionValue(arg, argv, index);
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
  const optionName = optionNameFor(arg);
  const option = readOptionValue(arg, argv, index);
  if (!option.value) {
    throw new DriftAiError(
      optionName === "--base" ? "--base requires a ref." : `${optionName} requires a path.`,
    );
  }
  if (optionName === "--base") {
    parsed.base = option.value;
    parsed.baseExplicit = true;
  } else if (optionName === "--root") {
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
  if (optionNameFor(arg) === "--format") {
    const option = readOptionValue(arg, argv, index);
    if (option.value !== "text" && option.value !== "json") {
      throw new DriftAiError("--format requires text or json.");
    }
    parsed.format = option.value;
    return option.nextIndex;
  }
  const option = readOptionValue(arg, argv, index);
  if (!option.value) throw new DriftAiError("--output requires a path.");
  parsed.outputPath = option.value;
  return option.nextIndex;
}

function parseChunkOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  if (optionNameFor(arg) === "--chunk-dir") {
    const option = readOptionValue(arg, argv, index);
    if (!option.value) throw new DriftAiError("--chunk-dir requires a path.");
    parsed.chunkDir = option.value;
    return option.nextIndex;
  }
  const option = readOptionValue(arg, argv, index);
  if (!/^[1-9]\d*$/u.test(option.value)) {
    throw new DriftAiError("--chunk-size requires a positive integer.");
  }
  parsed.chunkSize = Number(option.value);
  return option.nextIndex;
}

function parseCheckOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  const option = readOptionValue(arg, argv, index);
  if (!option.value) {
    throw new DriftAiError(
      "--check requires duplicates, ghost-files, comments, suppressions, or all.",
    );
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
};

function parseKnownOption(
  arg: string,
  argv: readonly string[],
  index: number,
  parsed: ParsedCliOptions,
): number | undefined {
  return OPTION_PARSERS[optionNameFor(arg)]?.(arg, argv, index, parsed);
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

function cliOptionsFromParsed(parsed: ParsedCliOptions): CliOptions {
  return {
    scopeMode: parsed.scopeMode,
    base: parsed.base,
    baseExplicit: parsed.baseExplicit,
    checks:
      parsed.allRequested || parsed.requested.length === 0 ? [...ALL_CHECKS] : parsed.requested,
    format: parsed.format,
    roots: parsed.roots,
    ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
    ...(parsed.outputPath === undefined ? {} : { outputPath: parsed.outputPath }),
    ...(parsed.chunkDir === undefined
      ? {}
      : { chunkDir: parsed.chunkDir, chunkSize: parsed.chunkSize ?? DEFAULT_CHUNK_SIZE }),
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
  return cliOptionsFromParsed(parsed);
}
