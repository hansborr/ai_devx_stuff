import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicateTypesConfig } from "./config.js";
import {
  assertConfigObject,
  assertKnownKeys,
  readExcludeGlobsOrDefault,
  readPositiveIntOrDefault,
} from "./config-readers.js";
import { DEFAULT_DUPLICATE_TYPES_MIN_PROPS } from "./duplicate-shapes-config-values.js";

const DEFAULT_DUPLICATE_TYPES_CONFIG: DriftAiDuplicateTypesConfig = {
  minProps: DEFAULT_DUPLICATE_TYPES_MIN_PROPS,
  excludeGlobs: [],
};

export const duplicateTypesCheckConfig: CheckConfigMetadata<
  DriftAiDuplicateTypesConfig,
  "duplicate-types"
> = {
  id: "duplicate-types",
  usage: "duplicate-types",
  defaultConfig: DEFAULT_DUPLICATE_TYPES_CONFIG,
  parseConfig: parseDuplicateTypesConfig,
  selectConfig: (config) => config.checks["duplicate-types"],
  // Opt-in: canonicalizing every interface/type literal is whole-project work even
  // when the final report is changed-scope-filtered.
  runByDefault: false,
};

function parseDuplicateTypesConfig(raw: unknown, keyPath: string): DriftAiDuplicateTypesConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["minProps", "excludeGlobs"], keyPath);
  return {
    minProps: readPositiveIntOrDefault(
      record,
      "minProps",
      DEFAULT_DUPLICATE_TYPES_CONFIG.minProps,
      keyPath,
    ),
    excludeGlobs: readExcludeGlobsOrDefault(
      record,
      DEFAULT_DUPLICATE_TYPES_CONFIG.excludeGlobs,
      keyPath,
    ),
  };
}
