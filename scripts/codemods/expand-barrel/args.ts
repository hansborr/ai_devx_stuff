import { requireArg } from "../../cli-option-values.js";
import { contextForBarrel, contextForPackage } from "./barrel-context.js";
import { fail, usage } from "./errors.js";
import type { CliArgs } from "./types.js";

type ParsedArgTokens = {
  readonly barrelArg?: string;
  readonly packageArg?: string;
  readonly dryRun: boolean;
  readonly all: boolean;
  readonly check: boolean;
};

type ScanResult = {
  readonly tokens: ParsedArgTokens;
  readonly consumedNext: boolean;
};

const emptyTokens: ParsedArgTokens = {
  dryRun: false,
  all: false,
  check: false,
};

function nextValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value)
    fail(`${flag} requires ${flag === "--barrel" ? "an index.ts path" : "a package subpath"}.`);
  return value;
}

function scanArgToken(argv: readonly string[], index: number, tokens: ParsedArgTokens): ScanResult {
  const arg = requireArg(argv[index], fail);

  switch (arg) {
    case "--dry-run":
      return { tokens: { ...tokens, dryRun: true }, consumedNext: false };
    case "--all":
      return { tokens: { ...tokens, all: true }, consumedNext: false };
    case "--check":
      return { tokens: { ...tokens, check: true }, consumedNext: false };
    case "--barrel":
      return {
        tokens: { ...tokens, barrelArg: nextValue(argv, index, "--barrel") },
        consumedNext: true,
      };
    case "--package":
      return {
        tokens: { ...tokens, packageArg: nextValue(argv, index, "--package") },
        consumedNext: true,
      };
    default:
      return scanInlineArgToken(arg, tokens);
  }
}

function scanInlineArgToken(arg: string, tokens: ParsedArgTokens): ScanResult {
  if (arg.startsWith("--barrel=")) {
    return {
      tokens: { ...tokens, barrelArg: arg.slice("--barrel=".length) },
      consumedNext: false,
    };
  }
  if (arg.startsWith("--package=")) {
    return {
      tokens: { ...tokens, packageArg: arg.slice("--package=".length) },
      consumedNext: false,
    };
  }
  fail(`Unknown argument: ${arg}\n${usage()}`);
}

function scanArgs(argv: readonly string[]): ParsedArgTokens {
  let tokens = emptyTokens;
  for (let index = 0; index < argv.length; index += 1) {
    const result = scanArgToken(argv, index, tokens);
    tokens = result.tokens;
    if (result.consumedNext) index += 1;
  }
  return tokens;
}

function selectedModeCount(tokens: ParsedArgTokens): number {
  return [tokens.check, tokens.all, Boolean(tokens.barrelArg), Boolean(tokens.packageArg)].filter(
    Boolean,
  ).length;
}

export function parseArgs(argv: string[], root: string): CliArgs {
  const tokens = scanArgs(argv);
  if (selectedModeCount(tokens) !== 1) fail(usage());
  if (tokens.check) {
    if (tokens.dryRun) fail("--check cannot be combined with --dry-run.");
    return { mode: "check" };
  }
  if (tokens.all) return { mode: "all", dryRun: tokens.dryRun };
  if (tokens.packageArg) {
    return {
      mode: "single",
      context: contextForPackage(root, tokens.packageArg),
      dryRun: tokens.dryRun,
    };
  }
  if (tokens.barrelArg) {
    return {
      mode: "single",
      context: contextForBarrel(root, tokens.barrelArg),
      dryRun: tokens.dryRun,
    };
  }
  fail(usage());
}
