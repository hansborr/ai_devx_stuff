// Public facade for the ghost-file detector. Pure matching, current-scope
// pairing, changed-scope pairing, and bucket fallback live in sibling modules.

import type { GhostFileAllowedPair } from "./config.js";
import { runChangedGhostFilesCheck } from "./ghost-files-changed.js";
import { runCurrentGhostFilesCheck } from "./ghost-files-current.js";
import { DEFAULT_DEPENDENTS_HINT } from "./ghost-files-findings.js";
import { DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS, type GhostFileTuning } from "./ghost-files-match.js";
import { DEFAULT_GHOST_FILE_ROLE_MARKER_TOKENS } from "./ghost-files-role-family.js";
import { DEFAULT_GHOST_FILE_WEAK_TOKENS } from "./ghost-files-tokens.js";
import type { DirectoryListing as RepoDirectoryListing } from "./repo-io.js";
import {
  BUILT_IN_SOURCE_EXTENSIONS,
  type ChangedDetectorScope,
  type CurrentDetectorScope,
  type DetectorScope,
} from "./scope.js";
import type { DriftFinding } from "./types.js";

export {
  GHOST_FILES_BUCKET_CAP,
  GHOST_FILES_DIRECTORY_PAIR_THRESHOLD,
} from "./ghost-files-constants.js";
export { DEFAULT_DEPENDENTS_HINT, GHOST_FILES_REPAIR_HINT_PREFIX } from "./ghost-files-findings.js";
export { DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS, findGhostMatches } from "./ghost-files-match.js";
export {
  DEFAULT_GHOST_FILE_ROLE_MARKER_TOKENS,
  isRoleSplitFamilyPair,
} from "./ghost-files-role-family.js";
export {
  DEFAULT_GHOST_FILE_WEAK_TOKENS,
  isExcludedSibling,
  singularize,
  tokenize,
} from "./ghost-files-tokens.js";
export { defaultDirectoryListing } from "./repo-io.js";

export type DirectoryListing = RepoDirectoryListing;

type SharedGhostFilesCheckOptions = {
  readonly sourceExtensions?: ReadonlySet<string>;
  readonly excludeGlobs?: readonly string[];
  readonly dependentsHint?: string;
  readonly weakTokens?: ReadonlySet<string>;
  readonly entryPointStems?: ReadonlySet<string>;
};

type RunChangedGhostFilesCheckOptions = SharedGhostFilesCheckOptions & {
  readonly detectorScope: ChangedDetectorScope;
  readonly listDirectory: DirectoryListing;
  readonly currentAllowedPairs?: never;
  readonly roleMarkerTokens?: never;
  readonly inventoryByDir?: never;
};

type RunCurrentGhostFilesCheckOptions = SharedGhostFilesCheckOptions & {
  readonly detectorScope: CurrentDetectorScope;
  readonly inventoryByDir: ReadonlyMap<string, readonly string[]>;
  readonly currentAllowedPairs?: readonly GhostFileAllowedPair[];
  readonly roleMarkerTokens?: ReadonlySet<string>;
  readonly listDirectory?: never;
};

export type RunGhostFilesCheckOptions =
  | RunChangedGhostFilesCheckOptions
  | RunCurrentGhostFilesCheckOptions;

type GhostFilesExecutionOptions = SharedGhostFilesCheckOptions & {
  readonly detectorScope: DetectorScope;
  readonly currentAllowedPairs?: readonly GhostFileAllowedPair[];
  readonly roleMarkerTokens?: ReadonlySet<string>;
  readonly listDirectory?: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
};

export function runGhostFilesCheck(options: RunGhostFilesCheckOptions): DriftFinding[];
export function runGhostFilesCheck(options: GhostFilesExecutionOptions): DriftFinding[] {
  const excludeGlobs = options.excludeGlobs ?? [];
  const sourceExtensions = options.sourceExtensions ?? BUILT_IN_SOURCE_EXTENSIONS;
  const dependentsHint = options.dependentsHint ?? DEFAULT_DEPENDENTS_HINT;
  const tuning = ghostFileTuning(options);
  if (options.detectorScope.scopeMode === "current") {
    if (options.inventoryByDir === undefined) {
      throw new Error("runGhostFilesCheck requires inventoryByDir for current scope.");
    }
    return runCurrentGhostFilesCheck({
      inventoryByDir: options.inventoryByDir,
      excludeGlobs,
      sourceExtensions,
      tuning,
      allowedPairs: options.currentAllowedPairs ?? [],
      dependentsHint,
      roleMarkerTokens: options.roleMarkerTokens ?? new Set(DEFAULT_GHOST_FILE_ROLE_MARKER_TOKENS),
    });
  }
  if (options.listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  return runChangedGhostFilesCheck(
    {
      detectorScope: options.detectorScope,
      listDirectory: options.listDirectory,
    },
    excludeGlobs,
    sourceExtensions,
    tuning,
    dependentsHint,
  );
}

function ghostFileTuning(options: SharedGhostFilesCheckOptions): GhostFileTuning {
  return {
    weakTokens: options.weakTokens ?? new Set(DEFAULT_GHOST_FILE_WEAK_TOKENS),
    entryPointStems: options.entryPointStems ?? new Set(DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS),
  };
}
