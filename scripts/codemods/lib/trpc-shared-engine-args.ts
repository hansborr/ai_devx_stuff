import { requireArg } from "../../cli-option-values.js";
import { fail as failWithName } from "./codemod-errors.js";
import type {
  SharedSchemaCodemodCliArgs,
  SharedSchemaCodemodConfig,
} from "./trpc-shared-engine-types.js";

type ParsedCliFlags = {
  all: boolean;
  check: boolean;
  dryRun: boolean;
  positional: string[];
  targetSource?: string;
};

function fail(config: SharedSchemaCodemodConfig, message: string): never {
  failWithName(config.codemodName, message);
}

function initialParsedFlags(): ParsedCliFlags {
  return {
    all: false,
    check: false,
    dryRun: false,
    positional: [],
  };
}

function targetValue(config: SharedSchemaCodemodConfig, args: string[], index: number): string {
  const value = args[index + 1];
  if (!value) fail(config, "--target requires a shared schema module source.");
  return value;
}

function readFlagArg(
  config: SharedSchemaCodemodConfig,
  args: string[],
  index: number,
  parsed: ParsedCliFlags,
): number {
  const arg = requireArg(args[index], (message) => fail(config, message));
  if (config.supportsAll && arg === "--all") {
    parsed.all = true;
    return index;
  }
  if (arg === "--check") {
    parsed.check = true;
    return index;
  }
  if (arg === "--dry-run") {
    parsed.dryRun = true;
    return index;
  }
  if (arg === "--target") {
    parsed.targetSource = targetValue(config, args, index);
    return index + 1;
  }
  if (arg.startsWith("--target=")) {
    parsed.targetSource = arg.slice("--target=".length);
    return index;
  }
  if (arg.startsWith("-")) fail(config, `Unknown argument: ${arg}`);
  parsed.positional.push(arg);
  return index;
}

function checkModeArgs(
  config: SharedSchemaCodemodConfig,
  parsed: ParsedCliFlags,
): SharedSchemaCodemodCliArgs | undefined {
  if (!parsed.check) return undefined;
  if (parsed.positional.length !== 0 || parsed.targetSource || parsed.dryRun) {
    fail(config, config.usage.check);
  }
  return { mode: "check" };
}

function allModeArgs(
  config: SharedSchemaCodemodConfig,
  parsed: ParsedCliFlags,
): SharedSchemaCodemodCliArgs | undefined {
  if (!parsed.all) return undefined;
  if (parsed.positional.length !== 0 || parsed.targetSource) {
    fail(config, config.usage.all ?? config.usage.single);
  }
  return { mode: "all", dryRun: parsed.dryRun };
}

function singleModeArgs(
  config: SharedSchemaCodemodConfig,
  parsed: ParsedCliFlags,
): SharedSchemaCodemodCliArgs {
  if (parsed.positional.length !== 1) {
    fail(config, config.usage.single);
  }
  const routerFile = parsed.positional[0];
  if (!routerFile) fail(config, "Router file argument is required.");
  return {
    mode: "single",
    routerFile,
    targetSource: parsed.targetSource,
    dryRun: parsed.dryRun,
  };
}

function finalizeArgs(
  config: SharedSchemaCodemodConfig,
  parsed: ParsedCliFlags,
): SharedSchemaCodemodCliArgs {
  if (config.supportsAll && parsed.all && parsed.check) {
    fail(config, "--all and --check cannot be combined.");
  }
  return (
    checkModeArgs(config, parsed) ??
    (config.supportsAll ? allModeArgs(config, parsed) : undefined) ??
    singleModeArgs(config, parsed)
  );
}

export function parseSharedSchemaCodemodArgs(
  config: SharedSchemaCodemodConfig,
  args: string[],
): SharedSchemaCodemodCliArgs {
  const parsed = initialParsedFlags();
  for (let index = 0; index < args.length; index += 1) {
    index = readFlagArg(config, args, index, parsed);
  }
  return finalizeArgs(config, parsed);
}
