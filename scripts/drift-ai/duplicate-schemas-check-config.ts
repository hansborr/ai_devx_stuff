import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicateSchemasConfig } from "./config.js";
import {
  assertConfigObject,
  assertKnownKeys,
  readExcludeGlobsOrDefault,
  readPositiveIntOrDefault,
} from "./config-readers.js";
import { DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS } from "./duplicate-shapes-config-values.js";

const DEFAULT_DUPLICATE_SCHEMAS_CONFIG: DriftAiDuplicateSchemasConfig = {
  minKeys: DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS,
  excludeGlobs: [],
};

export const duplicateSchemasCheckConfig: CheckConfigMetadata<
  DriftAiDuplicateSchemasConfig,
  "duplicate-schemas"
> = {
  id: "duplicate-schemas",
  usage: "duplicate-schemas",
  defaultConfig: DEFAULT_DUPLICATE_SCHEMAS_CONFIG,
  parseConfig: parseDuplicateSchemasConfig,
  selectConfig: (config) => config.checks["duplicate-schemas"],
  // Opt-in: normalizing every z.object schema is whole-project work even when the
  // final report is changed-scope-filtered.
  runByDefault: false,
};

function parseDuplicateSchemasConfig(raw: unknown, keyPath: string): DriftAiDuplicateSchemasConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["minKeys", "excludeGlobs"], keyPath);
  return {
    minKeys: readPositiveIntOrDefault(
      record,
      "minKeys",
      DEFAULT_DUPLICATE_SCHEMAS_CONFIG.minKeys,
      keyPath,
    ),
    excludeGlobs: readExcludeGlobsOrDefault(
      record,
      DEFAULT_DUPLICATE_SCHEMAS_CONFIG.excludeGlobs,
      keyPath,
    ),
  };
}
