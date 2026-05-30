import type { GhostFileAllowedPair } from "./config.js";
import { normalizePairPath } from "./config-paths.js";
import { DriftAiError } from "./errors.js";
import { uniqSorted } from "./path-util.js";

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertKnownKeys(
  raw: UnknownRecord,
  allowed: readonly string[],
  keyPath: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!allowedSet.has(key)) {
      throw new DriftAiError(`drift:ai config '${keyPath}' has unknown key '${key}'.`);
    }
  }
}

export function assertConfigObject(raw: unknown, keyPath: string): UnknownRecord {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  return raw;
}

export function readStringArray(raw: unknown, keyPath: string): string[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return item;
  });
}

export function mergeNormalizedStringArray(
  raw: unknown,
  defaults: readonly string[],
  keyPath: string,
  normalize: (value: string) => string,
): string[] {
  return uniqSorted([...defaults, ...readStringArray(raw, keyPath).map(normalize)]);
}

export function readDependentsHintTemplate(raw: unknown, keyPath: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a non-empty string.`);
  }
  if (!raw.includes("{path}")) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must include a {path} placeholder.`);
  }
  return raw;
}

export function readAllowedPairs(raw: unknown, keyPath: string): GhostFileAllowedPair[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => readAllowedPair(item, `${keyPath}[${index}]`));
}

export function parsePositiveInt(raw: unknown, keyPath: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a positive integer.`);
  }
  return raw;
}

export function uniqAllowedPairs(values: readonly GhostFileAllowedPair[]): GhostFileAllowedPair[] {
  const byKey = new Map<string, GhostFileAllowedPair>();
  for (const pair of values) {
    byKey.set(`${pair.files[0]}\u0000${pair.files[1]}`, pair);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.files[0].localeCompare(right.files[0], "en") ||
      left.files[1].localeCompare(right.files[1], "en"),
  );
}

export function parseEmptyCheckConfig(raw: unknown, keyPath: string): Record<string, never> {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, [], keyPath);
  return {};
}

function readAllowedPair(raw: unknown, keyPath: string): GhostFileAllowedPair {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  const paths = raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return normalizePairPath(item, `${keyPath}[${index}]`);
  });
  const left = paths[0];
  const right = paths[1];
  if (left === undefined || right === undefined) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  if (left === right) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must contain two distinct paths.`);
  }
  return { files: left < right ? [left, right] : [right, left] };
}
