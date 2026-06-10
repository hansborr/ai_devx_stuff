import type { CheckConfigMetadata } from "./check-plugin.js";
import { DEFAULT_COMMENTED_OUT_CODE_MIN_LINES } from "./commented-out-code-config-values.js";
import type { DriftAiCommentedOutCodeConfig } from "./config.js";
import { normalizePrefix } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  mergeNormalizedStringArray,
  parsePositiveInt,
} from "./config-readers.js";
import { DriftAiError } from "./errors.js";

const DEFAULT_COMMENTED_OUT_CODE_CONFIG: DriftAiCommentedOutCodeConfig = {
  minLines: DEFAULT_COMMENTED_OUT_CODE_MIN_LINES,
  excludePrefixes: [],
};

export const commentedOutCodeCheckConfig: CheckConfigMetadata<
  DriftAiCommentedOutCodeConfig,
  "commented-out-code"
> = {
  id: "commented-out-code",
  usage: "commented-out-code",
  defaultConfig: DEFAULT_COMMENTED_OUT_CODE_CONFIG,
  parseConfig: parseCommentedOutCodeConfig,
  selectConfig: (config) => config.checks["commented-out-code"],
  // Opt-in: it parses every comment block across the scanned files, which is more
  // work (and noisier) than the routine changed-scope default set warrants.
  runByDefault: false,
};

function parseCommentedOutCodeConfig(raw: unknown, keyPath: string): DriftAiCommentedOutCodeConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["minLines", "excludePrefixes"], keyPath);
  return {
    minLines: parseMinLines(record["minLines"], `${keyPath}.minLines`),
    excludePrefixes:
      record["excludePrefixes"] === undefined
        ? DEFAULT_COMMENTED_OUT_CODE_CONFIG.excludePrefixes
        : mergeNormalizedStringArray(
            record["excludePrefixes"],
            DEFAULT_COMMENTED_OUT_CODE_CONFIG.excludePrefixes,
            `${keyPath}.excludePrefixes`,
            normalizePrefix,
          ),
  };
}

// `minLines` must be at least 2: a single commented-out line is a debug toggle,
// not a tombstoned block, and that is all this sensor is about.
function parseMinLines(raw: unknown, keyPath: string): number {
  if (raw === undefined) return DEFAULT_COMMENTED_OUT_CODE_CONFIG.minLines;
  const value = parsePositiveInt(raw, keyPath);
  if (value < 2) throw new DriftAiError(`drift:ai config '${keyPath}' must be at least 2.`);
  return value;
}
