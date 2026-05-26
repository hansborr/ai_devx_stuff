// Public facade for the ghost-file detector. Pure matching, current-scope
// pairing, changed-scope pairing, and bucket fallback live in sibling modules.

import { readdirSync } from "node:fs";
import path from "node:path";

import type { GhostFileAllowedPair } from "./config.js";
import { runChangedGhostFilesCheck } from "./ghost-files-changed.js";
import { runCurrentGhostFilesCheck } from "./ghost-files-current.js";
import { SOURCE_LIKE_EXTS } from "./ghost-files-tokens.js";
import type { DetectorScope } from "./scope.js";
import type { DriftFinding } from "./types.js";

export {
  GHOST_FILES_BUCKET_CAP,
  GHOST_FILES_DIRECTORY_PAIR_THRESHOLD,
} from "./ghost-files-constants.js";
export { GHOST_FILES_REPAIR_HINT_PREFIX } from "./ghost-files-findings.js";
export {
  findGhostMatches,
  type GhostFileMatch,
  type GhostFileMatchKind,
} from "./ghost-files-match.js";
export { isExcludedSibling, singularize, tokenize } from "./ghost-files-tokens.js";

export type DirectoryListing = (directory: string) => readonly string[];

export function defaultDirectoryListing(repoRoot: string): DirectoryListing {
  const root = path.resolve(repoRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return (directory) => {
    const target = path.resolve(root, directory);
    if (target !== root && !target.startsWith(rootWithSep)) return [];
    try {
      const entries = readdirSync(target, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "en"));
    } catch {
      return [];
    }
  };
}

export type RunGhostFilesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly sourceExtensions?: ReadonlySet<string>;
  readonly excludeGlobs?: readonly string[];
  readonly currentAllowedPairs?: readonly GhostFileAllowedPair[];
  readonly listDirectory?: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
};

export function runGhostFilesCheck(options: RunGhostFilesCheckOptions): DriftFinding[] {
  const excludeGlobs = options.excludeGlobs ?? [];
  const sourceExtensions = options.sourceExtensions ?? SOURCE_LIKE_EXTS;
  if (options.detectorScope.scopeMode === "current") {
    return runCurrentGhostFilesCheck(
      options.inventoryByDir,
      excludeGlobs,
      sourceExtensions,
      options.currentAllowedPairs ?? [],
    );
  }
  if (options.listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  return runChangedGhostFilesCheck(options, excludeGlobs, sourceExtensions);
}
