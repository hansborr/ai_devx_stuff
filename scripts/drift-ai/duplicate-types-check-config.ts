import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicateTypesConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  parsePositiveInt,
  readStringArray,
} from "./config-readers.js";
import { DEFAULT_DUPLICATE_TYPES_MIN_PROPS } from "./duplicate-shapes-config-values.js";
import { uniqSorted } from "./path-util.js";

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
    minProps:
      record["minProps"] === undefined
        ? DEFAULT_DUPLICATE_TYPES_CONFIG.minProps
        : parsePositiveInt(record["minProps"], `${keyPath}.minProps`),
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_DUPLICATE_TYPES_CONFIG.excludeGlobs
        : uniqSorted(
            readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ),
  };
}
