import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiChecksConfig, GhostFileAllowedPair } from "./config.js";
import { normalizeGlob, normalizePairPath } from "./config-paths.js";
import { DriftAiError } from "./errors.js";
import { uniqSorted } from "./path-util.js";
import type { DriftCheckId } from "./types.js";

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

// The check ids whose `checks` config slot is the empty `Record<string, never>`
// (adapters that take no options). Derived from `DriftAiChecksConfig` so it stays
// in sync automatically: adding an empty-config check to the config type makes it a
// valid `makeEmptyCheckConfig` id, and a non-empty-config id is a compile error
// (the indexed access below would not be assignable to `Record<string, never>`).
export type EmptyConfigCheckId = {
  [K in DriftCheckId]: DriftAiChecksConfig[K] extends Record<string, never>
    ? Record<string, never> extends DriftAiChecksConfig[K]
      ? K
      : never
    : never;
}[DriftCheckId];

// Factory for the no-options check-config metadata literal. Collapses the repeated
// `Record<string,never>` ceremony (empty default, `parseEmptyCheckConfig`, an
// id-keyed `selectConfig`) to a single call. `runByDefault` is only emitted when
// passed, preserving the "treated as true when omitted" default for opt-in-by-
// default checks (e.g. suppressions). Lives next to `parseEmptyCheckConfig` so the
// metadata-registry import boundary (check-metadata.test.ts) stays intact —
// `CheckConfigMetadata` is a type-only import.
export function makeEmptyCheckConfig<Id extends EmptyConfigCheckId>(
  id: Id,
  options?: { usage?: string; runByDefault?: boolean },
): CheckConfigMetadata<Record<string, never>, Id> {
  return {
    id,
    usage: options?.usage ?? id,
    defaultConfig: {},
    parseConfig: parseEmptyCheckConfig,
    selectConfig: (config) => config.checks[id],
    ...(options?.runByDefault === undefined ? {} : { runByDefault: options.runByDefault }),
  };
}

// Positive-int field with a default when the key is absent. Shared by the
// `duplicate-schemas`/`duplicate-types` parse bodies (fields `minKeys`/`minProps`).
export function readPositiveIntOrDefault(
  record: UnknownRecord,
  field: string,
  fallback: number,
  keyPath: string,
): number {
  return record[field] === undefined
    ? fallback
    : parsePositiveInt(record[field], `${keyPath}.${field}`);
}

// `excludeGlobs` array with a default when absent: normalized and deduped/sorted,
// mirroring the identical block both duplicate-shape parsers carried.
export function readExcludeGlobsOrDefault(
  record: UnknownRecord,
  fallback: readonly string[],
  keyPath: string,
): readonly string[] {
  return record["excludeGlobs"] === undefined
    ? fallback
    : uniqSorted(
        readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
      );
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
