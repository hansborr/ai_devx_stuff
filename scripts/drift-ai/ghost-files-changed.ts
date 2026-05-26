import path from "node:path";

import { matchesAnyGlob } from "./config.js";
import type { DirectoryListing, RunGhostFilesCheckOptions } from "./ghost-files.js";
import { ghostMessage, pairKey, relatedFiles, repairHint } from "./ghost-files-findings.js";
import { findGhostMatches } from "./ghost-files-match.js";
import { isSourceLike, toPosix } from "./ghost-files-tokens.js";
import type { DetectorScope } from "./scope.js";
import type { ChangedFile, DriftFinding } from "./types.js";

export function runChangedGhostFilesCheck(
  options: RunGhostFilesCheckOptions,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): DriftFinding[] {
  const listDirectory = options.listDirectory;
  if (listDirectory === undefined) {
    throw new Error("runGhostFilesCheck requires listDirectory for changed scope.");
  }
  return runChangedGhostFiles({
    detectorScope: options.detectorScope,
    excludeGlobs,
    listDirectory,
    sourceExtensions,
  });
}

type ChangedGhostFilesOptions = {
  readonly detectorScope: DetectorScope;
  readonly excludeGlobs: readonly string[];
  readonly listDirectory: DirectoryListing;
  readonly sourceExtensions: ReadonlySet<string>;
};

function runChangedGhostFiles(options: ChangedGhostFilesOptions): DriftFinding[] {
  const changedFiles = changedFilesFromScope(options.detectorScope);
  const newFiles = changedFiles
    .filter((file) => file.status === "added" || file.status === "copied")
    .map((file) => file.path)
    .filter((filePath) => isSourceLike(path.basename(filePath), options.sourceExtensions))
    .filter((filePath) => !matchesAnyGlob(filePath, options.excludeGlobs));
  if (newFiles.length === 0) return [];
  const newFileSet = new Set(newFiles);
  const ordered = [...newFiles].sort((left, right) => left.localeCompare(right, "en"));

  const findings: DriftFinding[] = [];
  const emittedPairs = new Set<string>();
  for (const newPath of ordered) {
    const directory = toPosix(path.dirname(newPath));
    const peerPaths = peerPathsForDirectory(
      directory,
      options.listDirectory,
      options.excludeGlobs,
      options.sourceExtensions,
    );
    for (const match of findGhostMatches(newPath, peerPaths, options.sourceExtensions)) {
      if (newFileSet.has(match.peerPath) && match.peerPath < match.newPath) continue;
      const key = pairKey(match.newPath, match.peerPath);
      if (emittedPairs.has(key)) continue;
      emittedPairs.add(key);
      findings.push({
        check: "ghost-files",
        file: match.newPath,
        message: ghostMessage(match),
        hint: repairHint(match.peerPath),
        relatedFiles: relatedFiles(match.newPath, match.peerPath),
      });
    }
  }
  return findings;
}

function peerPathsForDirectory(
  directory: string,
  listDirectory: DirectoryListing,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): string[] {
  return listDirectory(directory)
    .map((name) => (directory === "." ? name : `${directory}/${name}`))
    .filter((filePath) => isSourceLike(path.basename(filePath), sourceExtensions))
    .filter((filePath) => !matchesAnyGlob(filePath, excludeGlobs))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function changedFilesFromScope(detectorScope: DetectorScope): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "changed") continue;
    files.push({
      path: file.path,
      status: file.status,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    });
  }
  return files;
}
