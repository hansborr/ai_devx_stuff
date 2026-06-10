import type { CoverageParseNote } from "./coverage-types.js";

export function toPositiveInt(raw: string | undefined): number | null {
  const value = toInteger(raw);
  if (value === null || value <= 0) return null;
  return value;
}

export function toNonNegativeInt(raw: string | undefined): number | null {
  const value = toInteger(raw);
  if (value === null || value < 0) return null;
  return value;
}

export function toInteger(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^-?\d+$/u.test(trimmed)) return null;
  return Number(trimmed);
}

export function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 37)}...`;
}

export function malformed(line: number | undefined, detail: string): CoverageParseNote {
  return line === undefined
    ? { kind: "malformed-record", detail }
    : { kind: "malformed-record", detail, line };
}

export function missingEor(file: string): CoverageParseNote {
  return { kind: "missing-end-of-record", detail: `source file '${file}' had no end_of_record` };
}
