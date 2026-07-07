import { readRequiredOptionValue, requireArg as sharedRequireArg } from "../cli-option-values.js";
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
  return readRequiredOptionValue({
    arg: option.raw,
    argv: args,
    index,
    message,
    createError: (errorMessage) => new CodeIntelError(errorMessage),
  });
}

export function ensureFlagHasNoValue(option: ParsedOption): void {
  if (option.value !== undefined) throw unknownArgument(option.raw);
}

export function requireArg(arg: string | undefined): string {
  return sharedRequireArg(arg, (message) => {
    throw new CodeIntelError(message);
  });
}

export function unknownArgument(arg: string): CodeIntelError {
  return new CodeIntelError(`Unknown argument: ${arg}`);
}
