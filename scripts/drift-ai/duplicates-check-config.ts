import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiDuplicatesConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  mergeNormalizedStringArray,
  parsePositiveInt,
} from "./config-readers.js";
import {
  DEFAULT_DUPLICATES_MIN_LINES,
  DEFAULT_DUPLICATES_MIN_TOKENS,
  DEFAULT_DUPLICATES_MODE,
} from "./duplicates.js";

const DEFAULT_DUPLICATES_CONFIG: DriftAiDuplicatesConfig = {
  minLines: DEFAULT_DUPLICATES_MIN_LINES,
  minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
  mode: DEFAULT_DUPLICATES_MODE,
  excludeGlobs: [],
};

export const duplicatesCheckConfig: CheckConfigMetadata<DriftAiDuplicatesConfig, "duplicates"> = {
  id: "duplicates",
  usage: "duplicates",
  defaultConfig: DEFAULT_DUPLICATES_CONFIG,
  parseConfig: parseDuplicatesConfig,
  selectConfig: (config) => config.checks.duplicates,
};

function parseDuplicatesConfig(raw: unknown, keyPath: string): DriftAiDuplicatesConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["minLines", "minTokens", "mode", "excludeGlobs"], keyPath);
  const minLines =
    record["minLines"] === undefined
      ? DEFAULT_DUPLICATES_CONFIG.minLines
      : parsePositiveInt(record["minLines"], `${keyPath}.minLines`);
  const minTokens =
    record["minTokens"] === undefined
      ? DEFAULT_DUPLICATES_CONFIG.minTokens
      : parsePositiveInt(record["minTokens"], `${keyPath}.minTokens`);
  const mode = parseMode(record["mode"], `${keyPath}.mode`);
  return {
    ...(minLines === undefined ? {} : { minLines }),
    ...(minTokens === undefined ? {} : { minTokens }),
    ...(mode === undefined ? {} : { mode }),
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

function parseMode(raw: unknown, keyPath: string): "mild" | "weak" | undefined {
  if (raw === undefined) return DEFAULT_DUPLICATES_CONFIG.mode;
  if (raw === "mild" || raw === "weak") return raw;
  throw new Error(`drift:ai config '${keyPath}' must be 'mild' or 'weak'.`);
}
