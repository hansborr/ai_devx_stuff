const OPTION_VALUE_ARG_SPAN = 2;

export class ProposeArgsUsageError extends Error {}

export interface ParsedProposeCliOptions {
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores?: readonly string[];
  readonly metric?: string;
  readonly ruleOptionsJson?: string;
}

type ProposeOptionName = "ignore" | "metric" | "rule-options";

interface MutableProposeOptions {
  readonly files: string[];
  readonly ignores: string[];
  metric: string | undefined;
  ruleOptionsJson: string | undefined;
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
  }
}

function optionName(arg: string): ProposeOptionName {
  if (arg === "--ignore") return "ignore";
  if (arg === "--metric") return "metric";
  if (arg === "--rule-options") return "rule-options";
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
