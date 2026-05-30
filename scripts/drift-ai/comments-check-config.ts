import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiCommentsConfig } from "./config.js";
import { normalizePrefix } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  mergeNormalizedStringArray,
} from "./config-readers.js";

const DEFAULT_COMMENTS_CONFIG: DriftAiCommentsConfig = { excludePrefixes: [] };

export const commentsCheckConfig: CheckConfigMetadata<DriftAiCommentsConfig, "comments"> = {
  id: "comments",
  usage: "comments",
  defaultConfig: DEFAULT_COMMENTS_CONFIG,
  parseConfig: parseCommentsConfig,
  selectConfig: (config) => config.checks.comments,
};

function parseCommentsConfig(raw: unknown, keyPath: string): DriftAiCommentsConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["excludePrefixes"], keyPath);
  return {
    excludePrefixes:
      record["excludePrefixes"] === undefined
        ? DEFAULT_COMMENTS_CONFIG.excludePrefixes
        : mergeNormalizedStringArray(
            record["excludePrefixes"],
            DEFAULT_COMMENTS_CONFIG.excludePrefixes,
            `${keyPath}.excludePrefixes`,
            normalizePrefix,
          ),
  };
}
