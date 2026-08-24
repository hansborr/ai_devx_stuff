const OPTION_VALUE_ARG_SPAN = 2;

export class ProposeArgsUsageError extends Error {}

export interface ParsedProposeCliOptions {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
  readonly pluginModule?: string;
  readonly pluginExport?: string;
  readonly parserProfile?: string;
}

type ProposeOptionName =
  | "ignore"
  | "metric"
  | "parser-profile"
  | "plugin"
  | "plugin-export"
  | "rule-options";

interface MutableProposeOptions {
  readonly files: string[];
  readonly ignores: string[];
  metric: string | undefined;
  ruleOptionsJson: string | undefined;
  pluginModule: string | undefined;
  pluginExport: string | undefined;
  parserProfile: string | undefined;
}

function requiredArgument(args: readonly string[], index: number, message: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new ProposeArgsUsageError(message);
  return value;
}

function inlineOption(
  arg: string,
): { readonly name: ProposeOptionName; readonly value: string } | undefined {
  if (arg.startsWith("--ignore=")) return { name: "ignore", value: arg.slice("--ignore=".length) };
  if (arg.startsWith("--metric=")) return { name: "metric", value: arg.slice("--metric=".length) };
  if (arg.startsWith("--rule-options=")) {
    return { name: "rule-options", value: arg.slice("--rule-options=".length) };
  }
  if (arg.startsWith("--plugin=")) return { name: "plugin", value: arg.slice("--plugin=".length) };
  if (arg.startsWith("--plugin-export=")) {
    return { name: "plugin-export", value: arg.slice("--plugin-export=".length) };
  }
  if (arg.startsWith("--parser-profile=")) {
    return { name: "parser-profile", value: arg.slice("--parser-profile=".length) };
  }
  return undefined;
}

function assignOption(
  options: MutableProposeOptions,
  name: ProposeOptionName,
  value: string,
): void {
  switch (name) {
    case "ignore":
      options.ignores.push(value);
      return;
    case "metric":
      options.metric = value;
      return;
    case "rule-options":
      options.ruleOptionsJson = value;
      return;
    case "plugin":
      options.pluginModule = value;
      return;
    case "plugin-export":
      options.pluginExport = value;
      return;
    case "parser-profile":
      options.parserProfile = value;
      return;
  }
}

function optionValueMessage(name: ProposeOptionName): string {
  switch (name) {
    case "ignore":
      return "--ignore requires a glob";
    case "metric":
      return "--metric requires a metric";
    case "rule-options":
      return "--rule-options requires a JSON array";
    case "plugin":
      return "--plugin requires a package name";
    case "plugin-export":
      return "--plugin-export requires default or plugin";
    case "parser-profile":
      return "--parser-profile requires minimal-ts or type-aware-ts";
  }
}

function optionName(arg: string): ProposeOptionName {
  if (arg === "--ignore") return "ignore";
  if (arg === "--metric") return "metric";
  if (arg === "--rule-options") return "rule-options";
  if (arg === "--plugin") return "plugin";
  if (arg === "--plugin-export") return "plugin-export";
  if (arg === "--parser-profile") return "parser-profile";
  throw new ProposeArgsUsageError(`Unknown --propose option: ${arg}`);
}

function parsedProposeOptions(
  ruleId: string,
  options: MutableProposeOptions,
): ParsedProposeCliOptions {
  return {
    ruleId,
    files: options.files,
    ...(options.ignores.length === 0 ? {} : { ignores: options.ignores }),
    ...(options.metric === undefined ? {} : { metric: options.metric }),
    ...(options.ruleOptionsJson === undefined ? {} : { ruleOptionsJson: options.ruleOptionsJson }),
    ...(options.pluginModule === undefined ? {} : { pluginModule: options.pluginModule }),
    ...(options.pluginExport === undefined ? {} : { pluginExport: options.pluginExport }),
    ...(options.parserProfile === undefined ? {} : { parserProfile: options.parserProfile }),
  };
}

export function parseProposeCliOptions(args: readonly string[]): ParsedProposeCliOptions {
  const ruleId = args[0];
  if (ruleId === undefined || ruleId.startsWith("--")) {
    throw new ProposeArgsUsageError("--propose requires <ruleId> <glob...>");
  }

  const options: MutableProposeOptions = {
    files: [],
    ignores: [],
    metric: undefined,
    ruleOptionsJson: undefined,
    pluginModule: undefined,
    pluginExport: undefined,
    parserProfile: undefined,
  };
  let cursor = 1;
  while (cursor < args.length) {
    const arg = args[cursor] ?? "";
    const inline = inlineOption(arg);
    if (inline !== undefined) {
      assignOption(options, inline.name, inline.value);
      cursor += 1;
    } else if (arg.startsWith("--")) {
      const name = optionName(arg);
      assignOption(options, name, requiredArgument(args, cursor, optionValueMessage(name)));
      cursor += OPTION_VALUE_ARG_SPAN;
    } else {
      options.files.push(arg);
      cursor += 1;
    }
  }

  if (options.files.length === 0) {
    throw new ProposeArgsUsageError("--propose requires <ruleId> <glob...>");
  }
  return parsedProposeOptions(ruleId, options);
}
