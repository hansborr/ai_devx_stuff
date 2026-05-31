import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicateLiteralsConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  parsePositiveInt,
  readStringArray,
} from "./config-readers.js";
import {
  DEFAULT_DUPLICATE_LITERALS_INCLUDE_NUMBERS,
  DEFAULT_DUPLICATE_LITERALS_MIN_DISTINCT_FILES,
  DEFAULT_DUPLICATE_LITERALS_MIN_LENGTH,
  DEFAULT_DUPLICATE_LITERALS_MIN_NUMBER_DIGITS,
} from "./duplicate-shapes-config-values.js";
import { DriftAiError } from "./errors.js";
import { uniqSorted } from "./path-util.js";

const DEFAULT_DUPLICATE_LITERALS_CONFIG: DriftAiDuplicateLiteralsConfig = {
  minDistinctFiles: DEFAULT_DUPLICATE_LITERALS_MIN_DISTINCT_FILES,
  minLength: DEFAULT_DUPLICATE_LITERALS_MIN_LENGTH,
  includeNumbers: DEFAULT_DUPLICATE_LITERALS_INCLUDE_NUMBERS,
  minNumberDigits: DEFAULT_DUPLICATE_LITERALS_MIN_NUMBER_DIGITS,
  skipTestTitleStrings: true,
  excludeGlobs: [],
};

export const duplicateLiteralsCheckConfig: CheckConfigMetadata<
  DriftAiDuplicateLiteralsConfig,
  "duplicate-literals"
> = {
  id: "duplicate-literals",
  usage: "duplicate-literals",
  defaultConfig: DEFAULT_DUPLICATE_LITERALS_CONFIG,
  parseConfig: parseDuplicateLiteralsConfig,
  selectConfig: (config) => config.checks["duplicate-literals"],
  // Opt-in: scanning every literal across the whole project is expensive and noisy
  // relative to the routine changed-scope run.
  runByDefault: false,
};

function parseDuplicateLiteralsConfig(
  raw: unknown,
  keyPath: string,
): DriftAiDuplicateLiteralsConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(
    record,
    [
      "minDistinctFiles",
      "minLength",
      "includeNumbers",
      "minNumberDigits",
      "skipTestTitleStrings",
      "excludeGlobs",
    ],
    keyPath,
  );
  return {
    minDistinctFiles: parseMinDistinctFiles(
      record["minDistinctFiles"],
      `${keyPath}.minDistinctFiles`,
    ),
    minLength:
      record["minLength"] === undefined
        ? DEFAULT_DUPLICATE_LITERALS_CONFIG.minLength
        : parsePositiveInt(record["minLength"], `${keyPath}.minLength`),
    includeNumbers: parseBoolean(
      record["includeNumbers"],
      `${keyPath}.includeNumbers`,
      DEFAULT_DUPLICATE_LITERALS_CONFIG.includeNumbers,
    ),
    minNumberDigits:
      record["minNumberDigits"] === undefined
        ? DEFAULT_DUPLICATE_LITERALS_CONFIG.minNumberDigits
        : parsePositiveInt(record["minNumberDigits"], `${keyPath}.minNumberDigits`),
    skipTestTitleStrings: parseBoolean(
      record["skipTestTitleStrings"],
      `${keyPath}.skipTestTitleStrings`,
      DEFAULT_DUPLICATE_LITERALS_CONFIG.skipTestTitleStrings,
    ),
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_DUPLICATE_LITERALS_CONFIG.excludeGlobs
        : uniqSorted(
            readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ),
  };
}

// `minDistinctFiles` must be at least 2: a single-file repeat is not cross-file
// duplication, which is all this check is about.
function parseMinDistinctFiles(raw: unknown, keyPath: string): number {
  if (raw === undefined) return DEFAULT_DUPLICATE_LITERALS_CONFIG.minDistinctFiles;
  const value = parsePositiveInt(raw, keyPath);
  if (value < 2) throw new DriftAiError(`drift:ai config '${keyPath}' must be at least 2.`);
  return value;
}

function parseBoolean(raw: unknown, keyPath: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a boolean.`);
  }
  return raw;
}
