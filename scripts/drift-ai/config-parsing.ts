import { CHECK_METADATA } from "./check-metadata.js";
import type { DriftAiChecksConfig, DriftAiConfig, DriftAiIgnoreConfig } from "./config.js";
import { makeDefaultDriftAiConfig } from "./config-defaults.js";
import {
  normalizeExtension,
  normalizeGlob,
  normalizePrefix,
  normalizeRoot,
  normalizeSegment,
} from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  isRecord,
  mergeNormalizedStringArray,
  readStringArray,
} from "./config-readers.js";
import { parseCoverageConfig } from "./coverage-config.js";
import { parseEnvDefineConfig } from "./env-define-matrix-config.js";
export { DEFAULT_DRIFT_AI_CONFIG, makeDefaultDriftAiConfig } from "./config-defaults.js";
export { collapseRepoPath, pathEscapesRepo } from "./config-paths.js";
import { DriftAiError } from "./errors.js";
import { uniqSorted } from "./path-util.js";

export function parseDriftAiConfig(raw: unknown, displayPath = "config"): DriftAiConfig {
  if (!isRecord(raw)) {
    throw new DriftAiError(`drift:ai config '${displayPath}' must be a JSON object.`);
  }
  assertKnownKeys(
    raw,
    ["roots", "additionalSourceExtensions", "ignore", "checks", "coverage", "envDefine"],
    displayPath,
  );

  let config = makeDefaultDriftAiConfig();
  if (raw["roots"] !== undefined) {
    config = {
      ...config,
      roots: readStringArray(raw["roots"], `${displayPath}.roots`).map(normalizeRoot),
    };
  }
  if (raw["additionalSourceExtensions"] !== undefined) {
    config = {
      ...config,
      additionalSourceExtensions: uniqSorted(
        readStringArray(
          raw["additionalSourceExtensions"],
          `${displayPath}.additionalSourceExtensions`,
        ).map((value) => normalizeExtension(value, `${displayPath}.additionalSourceExtensions`)),
      ),
    };
  }
  if (raw["ignore"] !== undefined) {
    config = {
      ...config,
      ignore: parseIgnoreConfig(raw["ignore"], `${displayPath}.ignore`, config.ignore),
    };
  }
  if (raw["checks"] !== undefined) {
    config = {
      ...config,
      checks: parseChecksConfig(raw["checks"], `${displayPath}.checks`),
    };
  }
  if (raw["coverage"] !== undefined) {
    config = {
      ...config,
      coverage: parseCoverageConfig(raw["coverage"], `${displayPath}.coverage`),
    };
  }
  if (raw["envDefine"] !== undefined) {
    config = {
      ...config,
      envDefine: parseEnvDefineConfig(raw["envDefine"], `${displayPath}.envDefine`),
    };
  }
  return config;
}

function parseIgnoreConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiIgnoreConfig,
): DriftAiIgnoreConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["segments", "prefixes", "globs"], keyPath);
  return {
    segments:
      record["segments"] === undefined
        ? defaults.segments
        : mergeNormalizedStringArray(
            record["segments"],
            defaults.segments,
            `${keyPath}.segments`,
            normalizeSegment,
          ),
    prefixes:
      record["prefixes"] === undefined
        ? defaults.prefixes
        : mergeNormalizedStringArray(
            record["prefixes"],
            defaults.prefixes,
            `${keyPath}.prefixes`,
            normalizePrefix,
          ),
    globs:
      record["globs"] === undefined
        ? defaults.globs
        : mergeNormalizedStringArray(
            record["globs"],
            defaults.globs,
            `${keyPath}.globs`,
            normalizeGlob,
          ),
  };
}

function parseChecksConfig(raw: unknown, keyPath: string): DriftAiChecksConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(
    record,
    CHECK_METADATA.map((meta) => meta.id),
    keyPath,
  );
  const entries = CHECK_METADATA.map((meta) => {
    const rawConfig = record[meta.id];
    return [
      meta.id,
      rawConfig === undefined
        ? structuredClone(meta.defaultConfig)
        : meta.parseConfig(rawConfig, keyPathForPlugin(meta.id, keyPath)),
    ];
  });
  // type-assertion-boundary: json - registry preserves id/config correlation; Object.fromEntries widens computed keys.
  return Object.fromEntries(entries) as DriftAiChecksConfig;
}

function keyPathForPlugin(id: string, keyPath: string): string {
  return `${keyPath}.${id}`;
}
