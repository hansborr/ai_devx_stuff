// Public facade for the ghost-file detector. Pure matching, current-scope
// pairing, changed-scope pairing, and bucket fallback live in sibling modules.

import type { GhostFileAllowedPair } from "./config.js";
import { runChangedGhostFilesCheck } from "./ghost-files-changed.js";
import { runCurrentGhostFilesCheck } from "./ghost-files-current.js";
import { DEFAULT_DEPENDENTS_HINT } from "./ghost-files-findings.js";
import { DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS, type GhostFileTuning } from "./ghost-files-match.js";
import { DEFAULT_GHOST_FILE_WEAK_TOKENS, SOURCE_LIKE_EXTS } from "./ghost-files-tokens.js";
import type { DirectoryListing as RepoDirectoryListing } from "./repo-io.js";
import type { DetectorScope } from "./scope.js";
import type { DriftFinding } from "./types.js";

export {
  GHOST_FILES_BUCKET_CAP,
  GHOST_FILES_DIRECTORY_PAIR_THRESHOLD,
} from "./ghost-files-constants.js";
export { DEFAULT_DEPENDENTS_HINT, GHOST_FILES_REPAIR_HINT_PREFIX } from "./ghost-files-findings.js";
export {
  DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
  findGhostMatches,
  type GhostFileMatch,
  type GhostFileMatchKind,
} from "./ghost-files-match.js";
export {
  DEFAULT_GHOST_FILE_WEAK_TOKENS,
  isExcludedSibling,
  singularize,
  tokenize,
} from "./ghost-files-tokens.js";
export { defaultDirectoryListing } from "./repo-io.js";

export type DirectoryListing = RepoDirectoryListing;

export type RunGhostFilesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly sourceExtensions?: ReadonlySet<string>;
  readonly excludeGlobs?: readonly string[];
  readonly currentAllowedPairs?: readonly GhostFileAllowedPair[];
  readonly dependentsHint?: string;
  readonly weakTokens?: ReadonlySet<string>;
  readonly entryPointStems?: ReadonlySet<string>;
  readonly listDirectory?: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
};

export function runGhostFilesCheck(options: RunGhostFilesCheckOptions): DriftFinding[] {
  const excludeGlobs = options.excludeGlobs ?? [];
  const sourceExtensions = options.sourceExtensions ?? SOURCE_LIKE_EXTS;
  const dependentsHint = options.dependentsHint ?? DEFAULT_DEPENDENTS_HINT;
  const tuning = ghostFileTuning(options);
  if (options.detectorScope.scopeMode === "current") {
    return runCurrentGhostFilesCheck(
      options.inventoryByDir,
      excludeGlobs,
      sourceExtensions,
      tuning,
      options.currentAllowedPairs ?? [],
      dependentsHint,
    );
  }
  if (options.listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  return runChangedGhostFilesCheck(options, excludeGlobs, sourceExtensions, tuning, dependentsHint);
}

function ghostFileTuning(options: RunGhostFilesCheckOptions): GhostFileTuning {
  return {
    weakTokens: options.weakTokens ?? new Set(DEFAULT_GHOST_FILE_WEAK_TOKENS),
    entryPointStems: options.entryPointStems ?? new Set(DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS),
  };
}
