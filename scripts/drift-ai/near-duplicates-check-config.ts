import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiIgnoreConfig, DriftAiNearDuplicatesConfig } from "./config.js";
import { globsForIgnoredPaths } from "./config-match.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  parsePositiveInt,
  readStringArray,
} from "./config-readers.js";
import { DriftAiError } from "./errors.js";
import {
  DEFAULT_NEAR_DUPLICATE_IGNORE_GLOBS,
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  NEAR_DUPLICATE_TOOL,
  type NearDuplicateEngine,
} from "./near-duplicates-config-values.js";
import { uniqSorted } from "./path-util.js";

const DEFAULT_NEAR_DUPLICATES_CONFIG: DriftAiNearDuplicatesConfig = {
  engine: NEAR_DUPLICATE_TOOL,
  minLines: DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  minTokens: DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  similarityThreshold: DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  tokenBandRatio: DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  excludeGlobs: [],
};

export const nearDuplicatesCheckConfig: CheckConfigMetadata<
  DriftAiNearDuplicatesConfig,
  "near-duplicates"
> = {
  id: "near-duplicates",
  usage: "near-duplicates",
  defaultConfig: DEFAULT_NEAR_DUPLICATES_CONFIG,
  parseConfig: parseNearDuplicatesConfig,
  selectConfig: (config) => config.checks["near-duplicates"],
  // Opt-in: comparing function fingerprints is whole-project work even when the
  // final report is changed-scope-filtered.
  runByDefault: false,
};

export function nearDuplicateExcludeGlobs(
  ignore: DriftAiIgnoreConfig,
  config: DriftAiNearDuplicatesConfig,
): readonly string[] {
  return [
    ...DEFAULT_NEAR_DUPLICATE_IGNORE_GLOBS,
    ...globsForIgnoredPaths(ignore),
    ...config.excludeGlobs,
  ];
}

function parseNearDuplicatesConfig(raw: unknown, keyPath: string): DriftAiNearDuplicatesConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(
    record,
    ["engine", "minLines", "minTokens", "similarityThreshold", "tokenBandRatio", "excludeGlobs"],
    keyPath,
  );
  return {
    engine:
      record["engine"] === undefined
        ? DEFAULT_NEAR_DUPLICATES_CONFIG.engine
        : parseNearDuplicateEngine(record["engine"], `${keyPath}.engine`),
    minLines: parseOptionalPositiveInt(record["minLines"], `${keyPath}.minLines`, "minLines"),
    minTokens: parseOptionalPositiveInt(record["minTokens"], `${keyPath}.minTokens`, "minTokens"),
    similarityThreshold: parseOptionalRatio(
      record["similarityThreshold"],
      `${keyPath}.similarityThreshold`,
      "similarityThreshold",
      DEFAULT_NEAR_DUPLICATE_SIMILARITY,
      true,
    ),
    tokenBandRatio: parseOptionalRatio(
      record["tokenBandRatio"],
      `${keyPath}.tokenBandRatio`,
      "tokenBandRatio",
      0,
      false,
    ),
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_NEAR_DUPLICATES_CONFIG.excludeGlobs
        : uniqSorted(
            readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ),
  };
}

function parseNearDuplicateEngine(raw: unknown, keyPath: string): NearDuplicateEngine {
  if (raw === "ts-morph" || raw === "similarity-ts") return raw;
  throw new DriftAiError(`drift:ai config '${keyPath}' must be one of: ts-morph, similarity-ts.`);
}

function parseOptionalPositiveInt(
  raw: unknown,
  keyPath: string,
  field: "minLines" | "minTokens",
): number {
  if (raw === undefined) return DEFAULT_NEAR_DUPLICATES_CONFIG[field];
  return parsePositiveInt(raw, keyPath);
}

function parseOptionalRatio(
  raw: unknown,
  keyPath: string,
  field: "similarityThreshold" | "tokenBandRatio",
  min: number,
  allowEqualMin: boolean,
): number {
  if (raw === undefined) return DEFAULT_NEAR_DUPLICATES_CONFIG[field];
  if (!isAllowedRatio(raw, min, allowEqualMin)) {
    throw new DriftAiError(
      `drift:ai config '${keyPath}' must be a number ${ratioBoundText(
        min,
        allowEqualMin,
      )} and <= 1.`,
    );
  }
  return raw;
}

function isAllowedRatio(raw: unknown, min: number, allowEqualMin: boolean): raw is number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw > 1) return false;
  return allowEqualMin ? raw >= min : raw > min;
}

function ratioBoundText(min: number, allowEqualMin: boolean): string {
  return `${allowEqualMin ? "at least" : "greater than"} ${String(min)}`;
}
