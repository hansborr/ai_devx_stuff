import type {
  DriftAiChecksConfig,
  DriftAiCommentsConfig,
  DriftAiConfig,
  DriftAiDuplicatesConfig,
  DriftAiGhostFilesConfig,
  DriftAiIgnoreConfig,
  GhostFileAllowedPair,
} from "./config.js";
import {
  cloneDefaultConfig,
  normalizeExtension,
  normalizeGlob,
  normalizePairPath,
  normalizePrefix,
  normalizeRoot,
  normalizeSegment,
} from "./config-paths.js";
export {
  cloneDefaultConfig,
  collapseRepoPath,
  DEFAULT_DRIFT_AI_CONFIG,
  normalizeRepoPath,
  pathEscapesRepo,
} from "./config-paths.js";
import { DriftAiError } from "./errors.js";

type UnknownRecord = Record<string, unknown>;

export function parseDriftAiConfig(raw: unknown, displayPath = "config"): DriftAiConfig {
  if (!isRecord(raw)) {
    throw new DriftAiError(`drift:ai config '${displayPath}' must be a JSON object.`);
  }
  assertKnownKeys(raw, ["roots", "additionalSourceExtensions", "ignore", "checks"], displayPath);

  let config = cloneDefaultConfig();
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
      checks: parseChecksConfig(raw["checks"], `${displayPath}.checks`, config.checks),
    };
  }
  return config;
}

function parseIgnoreConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiIgnoreConfig,
): DriftAiIgnoreConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["segments", "prefixes", "globs"], keyPath);
  return {
    segments:
      raw["segments"] === undefined
        ? defaults.segments
        : uniqSorted([
            ...defaults.segments,
            ...readStringArray(raw["segments"], `${keyPath}.segments`).map(normalizeSegment),
          ]),
    prefixes:
      raw["prefixes"] === undefined
        ? defaults.prefixes
        : uniqSorted([
            ...defaults.prefixes,
            ...readStringArray(raw["prefixes"], `${keyPath}.prefixes`).map(normalizePrefix),
          ]),
    globs:
      raw["globs"] === undefined
        ? defaults.globs
        : uniqSorted([
            ...defaults.globs,
            ...readStringArray(raw["globs"], `${keyPath}.globs`).map(normalizeGlob),
          ]),
  };
}

function parseChecksConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiChecksConfig,
): DriftAiChecksConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["duplicates", "comments", "ghost-files"], keyPath);
  return {
    duplicates:
      raw["duplicates"] === undefined
        ? defaults.duplicates
        : parseDuplicatesConfig(raw["duplicates"], `${keyPath}.duplicates`, defaults.duplicates),
    comments:
      raw["comments"] === undefined
        ? defaults.comments
        : parseCommentsConfig(raw["comments"], `${keyPath}.comments`, defaults.comments),
    "ghost-files":
      raw["ghost-files"] === undefined
        ? defaults["ghost-files"]
        : parseGhostFilesConfig(
            raw["ghost-files"],
            `${keyPath}.ghost-files`,
            defaults["ghost-files"],
          ),
  };
}

function parseDuplicatesConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiDuplicatesConfig,
): DriftAiDuplicatesConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["minLines", "excludeGlobs"], keyPath);
  const minLines =
    raw["minLines"] === undefined
      ? defaults.minLines
      : parsePositiveInt(raw["minLines"], `${keyPath}.minLines`);
  return {
    ...(minLines === undefined ? {} : { minLines }),
    excludeGlobs:
      raw["excludeGlobs"] === undefined
        ? defaults.excludeGlobs
        : uniqSorted([
            ...defaults.excludeGlobs,
            ...readStringArray(raw["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ]),
  };
}

function parseCommentsConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiCommentsConfig,
): DriftAiCommentsConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["excludePrefixes"], keyPath);
  return {
    excludePrefixes:
      raw["excludePrefixes"] === undefined
        ? defaults.excludePrefixes
        : uniqSorted([
            ...defaults.excludePrefixes,
            ...readStringArray(raw["excludePrefixes"], `${keyPath}.excludePrefixes`).map(
              normalizePrefix,
            ),
          ]),
  };
}

function parseGhostFilesConfig(
  raw: unknown,
  keyPath: string,
  defaults: DriftAiGhostFilesConfig,
): DriftAiGhostFilesConfig {
  if (!isRecord(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an object.`);
  assertKnownKeys(raw, ["excludeGlobs", "currentAllowedPairs"], keyPath);
  return {
    excludeGlobs:
      raw["excludeGlobs"] === undefined
        ? defaults.excludeGlobs
        : uniqSorted([
            ...defaults.excludeGlobs,
            ...readStringArray(raw["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ]),
    currentAllowedPairs:
      raw["currentAllowedPairs"] === undefined
        ? defaults.currentAllowedPairs
        : uniqAllowedPairs([
            ...defaults.currentAllowedPairs,
            ...readAllowedPairs(raw["currentAllowedPairs"], `${keyPath}.currentAllowedPairs`),
          ]),
  };
}

function assertKnownKeys(raw: UnknownRecord, allowed: readonly string[], keyPath: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!allowedSet.has(key)) {
      throw new DriftAiError(`drift:ai config '${keyPath}' has unknown key '${key}'.`);
    }
  }
}

function readStringArray(raw: unknown, keyPath: string): string[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return item;
  });
}

function readAllowedPairs(raw: unknown, keyPath: string): GhostFileAllowedPair[] {
  if (!Array.isArray(raw)) throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  return raw.map((item, index) => readAllowedPair(item, `${keyPath}[${index}]`));
}

function readAllowedPair(raw: unknown, keyPath: string): GhostFileAllowedPair {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  const paths = raw.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new DriftAiError(`drift:ai config '${keyPath}[${index}]' must be a non-empty string.`);
    }
    return normalizePairPath(item, `${keyPath}[${index}]`);
  });
  const left = paths[0];
  const right = paths[1];
  if (left === undefined || right === undefined) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a two-path array.`);
  }
  if (left === right) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must contain two distinct paths.`);
  }
  return { files: left < right ? [left, right] : [right, left] };
}

function parsePositiveInt(raw: unknown, keyPath: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a positive integer.`);
  }
  return raw;
}


function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function uniqAllowedPairs(values: readonly GhostFileAllowedPair[]): GhostFileAllowedPair[] {
  const byKey = new Map<string, GhostFileAllowedPair>();
  for (const pair of values) {
    byKey.set(`${pair.files[0]}\u0000${pair.files[1]}`, pair);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.files[0].localeCompare(right.files[0], "en") ||
      left.files[1].localeCompare(right.files[1], "en"),
  );
}
