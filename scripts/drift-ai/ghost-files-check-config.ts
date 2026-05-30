import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiGhostFilesConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import {
  assertConfigObject,
  assertKnownKeys,
  mergeNormalizedStringArray,
  readAllowedPairs,
  readDependentsHintTemplate,
  readStringArray,
  uniqAllowedPairs,
} from "./config-readers.js";
import { DriftAiError } from "./errors.js";
import { DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS } from "./ghost-files-match.js";
import { DEFAULT_GHOST_FILE_WEAK_TOKENS } from "./ghost-files-tokens.js";
import { uniqSorted } from "./path-util.js";

const DEFAULT_GHOST_FILES_CONFIG: DriftAiGhostFilesConfig = {
  excludeGlobs: [],
  currentAllowedPairs: [],
  weakTokens: DEFAULT_GHOST_FILE_WEAK_TOKENS,
  entryPointStems: DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
};

export const ghostFilesCheckConfig: CheckConfigMetadata<DriftAiGhostFilesConfig, "ghost-files"> = {
  id: "ghost-files",
  usage: "ghost-files",
  defaultConfig: DEFAULT_GHOST_FILES_CONFIG,
  parseConfig: parseGhostFilesConfig,
  selectConfig: (config) => config.checks["ghost-files"],
};

function parseGhostFilesConfig(raw: unknown, keyPath: string): DriftAiGhostFilesConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(
    record,
    ["excludeGlobs", "currentAllowedPairs", "dependentsHint", "weakTokens", "entryPointStems"],
    keyPath,
  );
  const dependentsHint =
    record["dependentsHint"] === undefined
      ? DEFAULT_GHOST_FILES_CONFIG.dependentsHint
      : readDependentsHintTemplate(record["dependentsHint"], `${keyPath}.dependentsHint`);
  return {
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_GHOST_FILES_CONFIG.excludeGlobs
        : mergeNormalizedStringArray(
            record["excludeGlobs"],
            DEFAULT_GHOST_FILES_CONFIG.excludeGlobs,
            `${keyPath}.excludeGlobs`,
            normalizeGlob,
          ),
    currentAllowedPairs:
      record["currentAllowedPairs"] === undefined
        ? DEFAULT_GHOST_FILES_CONFIG.currentAllowedPairs
        : uniqAllowedPairs([
            ...DEFAULT_GHOST_FILES_CONFIG.currentAllowedPairs,
            ...readAllowedPairs(record["currentAllowedPairs"], `${keyPath}.currentAllowedPairs`),
          ]),
    weakTokens:
      record["weakTokens"] === undefined
        ? DEFAULT_GHOST_FILES_CONFIG.weakTokens
        : readWeakTokens(record["weakTokens"], `${keyPath}.weakTokens`),
    entryPointStems:
      record["entryPointStems"] === undefined
        ? DEFAULT_GHOST_FILES_CONFIG.entryPointStems
        : readEntryPointStems(record["entryPointStems"], `${keyPath}.entryPointStems`),
    ...(dependentsHint === undefined ? {} : { dependentsHint }),
  };
}

function readWeakTokens(raw: unknown, keyPath: string): readonly string[] {
  return uniqSorted(
    readStringArray(raw, keyPath).map((value, index) =>
      normalizeWeakToken(value, `${keyPath}[${index}]`),
    ),
  );
}

function readEntryPointStems(raw: unknown, keyPath: string): readonly string[] {
  return uniqSorted(
    readStringArray(raw, keyPath).map((value, index) =>
      normalizeEntryPointStem(value, `${keyPath}[${index}]`),
    ),
  );
}

function normalizeWeakToken(value: string, keyPath: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+$/u.test(normalized)) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be an alphanumeric token.`);
  }
  return normalized;
}

function normalizeEntryPointStem(value: string, keyPath: string): string {
  const normalized = value.trim().toLowerCase();
  if (/[\\/\s]/u.test(normalized)) {
    throw new DriftAiError(
      `drift:ai config '${keyPath}' must be one filename stem, not a path or pattern.`,
    );
  }
  return normalized;
}
