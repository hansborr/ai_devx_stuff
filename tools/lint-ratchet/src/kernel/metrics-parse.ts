import type { LintRatchetComplexityFunction, LintRatchetMetricItem } from "./metrics-types.js";

const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

interface ParsedComplexityFunctionFields {
  readonly line?: number;
  readonly label?: string;
  readonly complexity?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSha256Hash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HASH_PATTERN.test(value);
}

function parseMessagesFingerprint(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  if (value === undefined) return undefined;
  if (isSha256Hash(value)) return value;
  failures.push(`${path}.messagesFingerprint must be a sha256 hash`);
  return undefined;
}

function parseComplexityFunctionLine(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path}.line must be a non-negative integer`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionLabel(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${path}.label must be a non-empty string`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionComplexity(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path}.complexity must be a non-negative integer`);
    return undefined;
  }
  return value;
}

function parseComplexityFunctionFields(
  value: Record<string, unknown>,
  path: string,
  failures: string[],
): ParsedComplexityFunctionFields {
  return {
    line: parseComplexityFunctionLine(value.line, path, failures),
    label: parseComplexityFunctionLabel(value.label, path, failures),
    complexity: parseComplexityFunctionComplexity(value.complexity, path, failures),
  };
}

function isCompleteComplexityFunction(
  fields: ParsedComplexityFunctionFields,
): fields is LintRatchetComplexityFunction {
  return fields.line !== undefined && fields.label !== undefined && fields.complexity !== undefined;
}

function parseComplexityFunction(
  value: unknown,
  path: string,
  failures: string[],
): LintRatchetComplexityFunction | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  const fields = parseComplexityFunctionFields(value, path, failures);
  if (!isCompleteComplexityFunction(fields)) return undefined;
  return fields;
}

function parseComplexityFunctions(
  value: unknown,
  path: string,
  failures: string[],
): readonly LintRatchetComplexityFunction[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  const parsed: LintRatchetComplexityFunction[] = [];
  for (const [index, entry] of value.entries()) {
    const item = parseComplexityFunction(entry, `${path}[${String(index)}]`, failures);
    if (item !== undefined) parsed.push(item);
  }
  return parsed;
}

export function parseMetricFields(
  rawItem: Record<string, unknown>,
  path: string,
  failures: string[],
): Omit<LintRatchetMetricItem, "count"> | undefined {
  const lines = rawItem.lines;
  if (lines !== undefined && !isNonNegativeInteger(lines)) {
    failures.push(`${path}.lines must be a non-negative integer`);
    return undefined;
  }
  const maxComplexity = rawItem.maxComplexity;
  if (maxComplexity !== undefined && !isNonNegativeInteger(maxComplexity)) {
    failures.push(`${path}.maxComplexity must be a non-negative integer`);
    return undefined;
  }
  const messagesFingerprint = parseMessagesFingerprint(rawItem.messagesFingerprint, path, failures);
  const perFunction =
    rawItem.perFunction === undefined
      ? undefined
      : parseComplexityFunctions(rawItem.perFunction, `${path}.perFunction`, failures);
  return {
    ...(lines === undefined ? {} : { lines }),
    ...(maxComplexity === undefined ? {} : { maxComplexity }),
    ...(perFunction === undefined ? {} : { perFunction }),
    ...(messagesFingerprint === undefined ? {} : { messagesFingerprint }),
  };
}
