import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicatesConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  mergeNormalizedStringArray,
  parsePositiveInt,
} from "./config-readers.js";

const DEFAULT_DUPLICATES_CONFIG: DriftAiDuplicatesConfig = { excludeGlobs: [] };

export const duplicatesCheckConfig: CheckConfigMetadata<DriftAiDuplicatesConfig, "duplicates"> = {
  id: "duplicates",
  usage: "duplicates",
  defaultConfig: DEFAULT_DUPLICATES_CONFIG,
  parseConfig: parseDuplicatesConfig,
  selectConfig: (config) => config.checks.duplicates,
};

function parseDuplicatesConfig(raw: unknown, keyPath: string): DriftAiDuplicatesConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["minLines", "excludeGlobs"], keyPath);
  const minLines =
    record["minLines"] === undefined
      ? DEFAULT_DUPLICATES_CONFIG.minLines
      : parsePositiveInt(record["minLines"], `${keyPath}.minLines`);
  return {
    ...(minLines === undefined ? {} : { minLines }),
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_DUPLICATES_CONFIG.excludeGlobs
        : mergeNormalizedStringArray(
            record["excludeGlobs"],
            DEFAULT_DUPLICATES_CONFIG.excludeGlobs,
            `${keyPath}.excludeGlobs`,
            normalizeGlob,
          ),
  };
}
