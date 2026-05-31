import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicateConstantsConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  parsePositiveInt,
  readStringArray,
} from "./config-readers.js";
import {
  DEFAULT_DUPLICATE_CONSTANTS_MIN_DISTINCT_FILES,
  DEFAULT_DUPLICATE_CONSTANTS_MIN_LENGTH,
  DEFAULT_DUPLICATE_CONSTANTS_MIN_NUMBER_DIGITS,
} from "./duplicate-shapes-config-values.js";
import { DriftAiError } from "./errors.js";
import { uniqSorted } from "./path-util.js";

const DEFAULT_DUPLICATE_CONSTANTS_CONFIG: DriftAiDuplicateConstantsConfig = {
  minDistinctFiles: DEFAULT_DUPLICATE_CONSTANTS_MIN_DISTINCT_FILES,
  minLength: DEFAULT_DUPLICATE_CONSTANTS_MIN_LENGTH,
  minNumberDigits: DEFAULT_DUPLICATE_CONSTANTS_MIN_NUMBER_DIGITS,
  excludeGlobs: [],
};

export const duplicateConstantsCheckConfig: CheckConfigMetadata<
  DriftAiDuplicateConstantsConfig,
  "duplicate-constants"
> = {
  id: "duplicate-constants",
  usage: "duplicate-constants",
  defaultConfig: DEFAULT_DUPLICATE_CONSTANTS_CONFIG,
  parseConfig: parseDuplicateConstantsConfig,
  selectConfig: (config) => config.checks["duplicate-constants"],
  // Opt-in: scanning every module-level const across the whole project is
  // whole-project work even when the final report is changed-scope-filtered.
  runByDefault: false,
};

function parseDuplicateConstantsConfig(
  raw: unknown,
  keyPath: string,
): DriftAiDuplicateConstantsConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(
    record,
    ["minDistinctFiles", "minLength", "minNumberDigits", "excludeGlobs"],
    keyPath,
  );
  return {
    minDistinctFiles: parseMinDistinctFiles(
      record["minDistinctFiles"],
      `${keyPath}.minDistinctFiles`,
    ),
    minLength:
      record["minLength"] === undefined
        ? DEFAULT_DUPLICATE_CONSTANTS_CONFIG.minLength
        : parsePositiveInt(record["minLength"], `${keyPath}.minLength`),
    minNumberDigits:
      record["minNumberDigits"] === undefined
        ? DEFAULT_DUPLICATE_CONSTANTS_CONFIG.minNumberDigits
        : parsePositiveInt(record["minNumberDigits"], `${keyPath}.minNumberDigits`),
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_DUPLICATE_CONSTANTS_CONFIG.excludeGlobs
        : uniqSorted(
            readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ),
  };
}

// `minDistinctFiles` must be at least 2: a single-file repeat is not the missed
// shared constant this check is about.
function parseMinDistinctFiles(raw: unknown, keyPath: string): number {
  if (raw === undefined) return DEFAULT_DUPLICATE_CONSTANTS_CONFIG.minDistinctFiles;
  const value = parsePositiveInt(raw, keyPath);
  if (value < 2) throw new DriftAiError(`drift:ai config '${keyPath}' must be at least 2.`);
  return value;
}
