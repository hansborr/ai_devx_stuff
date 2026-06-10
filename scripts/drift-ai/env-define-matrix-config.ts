// Parser for the top-level `envDefine` config block (tasks 43a-43). It validates
// the assumed-value matrix consumed by the prototype `env-branches` advisory: up to
// five optional tables (`env`, `processEnv`, `importMetaEnv`, `bunEnv`, `defines`),
// each mapping a key to a `{ value, source? }` assumption. `value` is a JSON scalar
// (string/number/boolean/null); `source` is free text describing where the value
// comes from and defaults to the config key path so provenance is never empty.
// Nothing here is inferred from deployment defaults — an unlisted key stays
// "unknown" downstream — so this parser only normalizes what the operator supplied.

import type { DriftAiEnvDefineConfig } from "./config.js";
import { assertConfigObject, assertKnownKeys } from "./config-readers.js";
import type { EnvDefineAssumedValue, EnvDefineAssumption } from "./env-define-types.js";
import { DriftAiError } from "./errors.js";

const TABLE_KEYS = ["env", "processEnv", "importMetaEnv", "bunEnv", "defines"] as const;

type EnvDefineTable = Readonly<Record<string, EnvDefineAssumption>>;

type MutableMatrix = {
  env?: EnvDefineTable;
  processEnv?: EnvDefineTable;
  importMetaEnv?: EnvDefineTable;
  bunEnv?: EnvDefineTable;
  defines?: EnvDefineTable;
};

export function parseEnvDefineConfig(raw: unknown, keyPath: string): DriftAiEnvDefineConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, TABLE_KEYS, keyPath);
  // Assign each table only when present, so an omitted table stays absent in the
  // matrix (distinct from a present-but-empty one) and never becomes `undefined`.
  const matrix: MutableMatrix = {};
  if (record["env"] !== undefined) matrix.env = parseTable(record["env"], `${keyPath}.env`);
  if (record["processEnv"] !== undefined) {
    matrix.processEnv = parseTable(record["processEnv"], `${keyPath}.processEnv`);
  }
  if (record["importMetaEnv"] !== undefined) {
    matrix.importMetaEnv = parseTable(record["importMetaEnv"], `${keyPath}.importMetaEnv`);
  }
  if (record["bunEnv"] !== undefined) {
    matrix.bunEnv = parseTable(record["bunEnv"], `${keyPath}.bunEnv`);
  }
  if (record["defines"] !== undefined) {
    matrix.defines = parseTable(record["defines"], `${keyPath}.defines`);
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
