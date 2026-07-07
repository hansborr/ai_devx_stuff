type CliOptionValue = {
  readonly value: string;
  readonly nextIndex: number;
};

type RequiredOptionValueInput = {
  readonly arg: string;
  readonly argv: readonly string[];
  readonly index: number;
  readonly usage?: string;
  readonly message?: string;
  readonly createError: (message: string) => Error;
};

function optionName(arg: string): string {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex < 0 ? arg : arg.slice(0, equalsIndex);
}

function requireCliArg(
  arg: string | undefined,
  fail: (message: string) => never,
  allowEmpty: boolean,
): string {
  if (arg === undefined || (!allowEmpty && arg === "")) {
    fail("Empty arguments are not supported.");
  }
  return arg;
}

// Guard a positional or loop argument against being missing or empty. Callers
// pass their own thrower so error identity stays local while text stays shared.
export function requireArg(arg: string | undefined, fail: (message: string) => never): string {
  return requireCliArg(arg, fail, false);
}

// Legacy parsers that only rejected missing array slots still need "" to flow
// into their own unknown-argument or positional-file handling.
export function requireArgAllowingEmpty(
  arg: string | undefined,
  fail: (message: string) => never,
): string {
  return requireCliArg(arg, fail, true);
}

export function readRequiredOptionValue(input: RequiredOptionValueInput): CliOptionValue {
  const { arg, argv, index, usage, message, createError } = input;
  const name = optionName(arg);
  const equalsIndex = arg.indexOf("=");
  const value = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    const errorMessage =
      message ?? `${name} requires a value.${usage === undefined ? "" : `\n${usage}`}`;
    throw createError(errorMessage);
  }
  return { value, nextIndex: equalsIndex >= 0 ? index : index + 1 };
}
