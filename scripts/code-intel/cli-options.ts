import { CodeIntelError } from "./errors.js";

export type ParsedOption = {
  name: string;
  raw: string;
  value?: string;
};

export type OptionValue = {
  nextIndex: number;
  value: string;
};

export function parseOption(arg: string): ParsedOption | undefined {
  if (!arg.startsWith("-")) return undefined;
  const separator = arg.indexOf("=");
  if (separator < 0) return { name: arg, raw: arg };
  return {
    name: arg.slice(0, separator),
    raw: arg,
    value: arg.slice(separator + 1),
  };
}

export function readOptionValue(
  option: ParsedOption,
  args: string[],
  index: number,
  message: string,
): OptionValue {
  if (option.value !== undefined) return { nextIndex: index, value: option.value };
  const value = args[index + 1];
  if (!value) throw new CodeIntelError(message);
  return { nextIndex: index + 1, value };
}

export function ensureFlagHasNoValue(option: ParsedOption): void {
  if (option.value !== undefined) throw unknownArgument(option.raw);
}

export function requireArg(arg: string | undefined): string {
  if (!arg) throw new CodeIntelError("Empty arguments are not supported.");
  return arg;
}

export function unknownArgument(arg: string): CodeIntelError {
  return new CodeIntelError(`Unknown argument: ${arg}`);
}
