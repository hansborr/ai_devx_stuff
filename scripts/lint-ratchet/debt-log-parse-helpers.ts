import { isNormalizedLintRatchetPath } from "./baseline-item-parse.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  failures: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) failures.push(`${path}: unknown key "${key}"`);
  }
}

export function requireNonEmptyString(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return value;
}

export function requireNormalizedPath(
  value: unknown,
  path: string,
  failures: string[],
): string | undefined {
  const parsed = requireNonEmptyString(value, path, failures);
  if (parsed === undefined) return undefined;
  if (!isNormalizedLintRatchetPath(parsed)) {
    failures.push(`${path} must be normalized`);
    return undefined;
  }
  return parsed;
}

export function requireNonNegativeInteger(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path} must be a non-negative integer`);
    return undefined;
  }
  return value;
}

export function parseOptionalNonNegativeInteger(
  value: unknown,
  path: string,
  failures: string[],
): number | undefined {
  if (value === undefined) return undefined;
  if (!isNonNegativeInteger(value)) {
    failures.push(`${path} must be a non-negative integer`);
    return undefined;
  }
  return value;
}

export function parseArrayOf<T>(
  value: unknown,
  path: string,
  failures: string[],
  parseItem: (item: unknown, itemPath: string, itemFailures: string[]) => T | undefined,
): readonly T[] | undefined {
  if (!Array.isArray(value)) {
    failures.push(`${path} must be an array`);
    return undefined;
  }
  const parsed: T[] = [];
  let ok = true;
  for (const [index, entry] of value.entries()) {
    const item = parseItem(entry, `${path}[${String(index)}]`, failures);
    if (item === undefined) ok = false;
    else parsed.push(item);
  }
  return ok ? parsed : undefined;
}
