import { DriftAiError } from "./errors.js";

export type ArgValue = {
  readonly value: string;
  readonly nextIndex: number;
};

export type OutputFormat = "text" | "json";

export function optionName(arg: string): string {
  const equalsIndex = arg.indexOf("=");
  return equalsIndex < 0 ? arg : arg.slice(0, equalsIndex);
}

export function readValue(
  arg: string,
  argv: readonly string[],
  index: number,
  usage: string,
): ArgValue {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  const next = argv[index + 1];
  if (next === undefined) {
    throw new DriftAiError(`${optionName(arg)} requires a value.\n${usage}`);
  }
  return { value: next, nextIndex: index + 1 };
}

export function readFormat(value: string): OutputFormat {
  if (value !== "text" && value !== "json") {
    throw new DriftAiError("--format requires text or json.");
  }
  return value;
}

export function readPath(option: string, value: string): string {
  if (!value) throw new DriftAiError(`${option} requires a path.`);
  return value;
}
