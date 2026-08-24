// Parser for the top-level `envDefine` config block. It validates the assumed-value
// matrix consumed by the prototype `env-branches` advisory: one optional shared
// fallback table plus the provider tables declared in the metadata registry. Each
// maps a key to a `{ value, source? }` assumption. `value` is a JSON scalar
// (string/number/boolean/null); `source` is free text describing where the value
// comes from and defaults to the config key path so provenance is never empty.
// Nothing here is inferred from deployment defaults — an unlisted key stays
// "unknown" downstream — so this parser only normalizes what the operator supplied.

import type { DriftAiEnvDefineConfig } from "./config.js";
import { assertConfigObject, assertKnownKeys } from "./config-readers.js";
import { ENV_DEFINE_MATRIX_KEYS, type EnvDefineMatrixKey } from "./env-define-provider-metadata.js";
import type { EnvDefineAssumedValue, EnvDefineAssumption } from "./env-define-types.js";
import { DriftAiError } from "./errors.js";

type EnvDefineTable = Readonly<Record<string, EnvDefineAssumption>>;

type MutableMatrix = Partial<Record<EnvDefineMatrixKey, EnvDefineTable>>;

export function parseEnvDefineConfig(raw: unknown, keyPath: string): DriftAiEnvDefineConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ENV_DEFINE_MATRIX_KEYS, keyPath);
  // Assign each table only when present, so an omitted table stays absent in the
  // matrix (distinct from a present-but-empty one) and never becomes `undefined`.
  const matrix: MutableMatrix = {};
  for (const tableKey of ENV_DEFINE_MATRIX_KEYS) {
    if (record[tableKey] !== undefined) {
      matrix[tableKey] = parseTable(record[tableKey], `${keyPath}.${tableKey}`);
    }
  }
  return matrix;
}

function parseTable(raw: unknown, keyPath: string): EnvDefineTable {
  const record = assertConfigObject(raw, keyPath);
  const table: Record<string, EnvDefineAssumption> = {};
  for (const key of Object.keys(record)) {
    table[key] = parseAssumption(record[key], `${keyPath}.${key}`);
  }
  return table;
}

function parseAssumption(raw: unknown, keyPath: string): EnvDefineAssumption {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["value", "source"], keyPath);
  if (!hasOwnKey(record, "value")) {
    throw new DriftAiError(`drift:ai config '${keyPath}.value' is required.`);
  }
  return {
    value: parseAssumedValue(record["value"], `${keyPath}.value`),
    source: parseSource(record["source"], `${keyPath}.source`, keyPath),
  };
}

function parseAssumedValue(raw: unknown, keyPath: string): EnvDefineAssumedValue {
  if (raw === null) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new DriftAiError(`drift:ai config '${keyPath}' must be a finite number.`);
    }
    return raw;
  }
  throw new DriftAiError(
    `drift:ai config '${keyPath}' must be a string, number, boolean, or null.`,
  );
}

// `source` is optional in config: an omitted source defaults to the assumption's
// config key path so an evidence row always names a concrete provenance.
function parseSource(raw: unknown, keyPath: string, defaultSource: string): string {
  if (raw === undefined) return defaultSource;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a non-empty string.`);
  }
  return raw.trim();
}

function hasOwnKey(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
