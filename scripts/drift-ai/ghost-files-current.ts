import path from "node:path";

import type { GhostFileAllowedPair } from "./config.js";
import { matchesAnyGlob } from "./config.js";
import { runBucketedDirectory } from "./ghost-files-buckets.js";
import { GHOST_FILES_DIRECTORY_PAIR_THRESHOLD } from "./ghost-files-constants.js";
import { currentPairFinding, pairKey, sortFindings } from "./ghost-files-findings.js";
import { findGhostMatches, type GhostFileMatch } from "./ghost-files-match.js";
import { isExcludedPath, isSourceLike, toPosix, uniqSorted } from "./ghost-files-tokens.js";
import type { DriftFinding } from "./types.js";

export function runCurrentGhostFilesCheck(
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  allowedPairs: readonly GhostFileAllowedPair[],
): DriftFinding[] {
  if (inventoryByDir === undefined) {
    throw new Error("runGhostFilesCheck requires inventoryByDir for current scope.");
  }
  const allowedPairKeys = currentAllowedPairKeys(allowedPairs);
  const findings: DriftFinding[] = [];
  for (const directory of currentInventoryDirectories(
    inventoryByDir,
    excludeGlobs,
    sourceExtensions,
  )) {
    findings.push(
      ...runCurrentDirectoryCheck(
        directory.path,
        directory.siblings,
        sourceExtensions,
        allowedPairKeys,
      ),
    );
  }
  return sortFindings(findings);
}

function currentAllowedPairKeys(allowedPairs: readonly GhostFileAllowedPair[]): Set<string> {
  return new Set(
    allowedPairs.map((pair) => pairKey(toPosix(pair.files[0]), toPosix(pair.files[1]))),
  );
}

type CurrentDirectoryInventory = {
  readonly path: string;
  readonly siblings: readonly string[];
};

function currentInventoryDirectories(
  inventoryByDir: ReadonlyMap<string, readonly string[]>,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): CurrentDirectoryInventory[] {
  const grouped = new Map<string, string[]>();
  for (const filePaths of inventoryByDir.values()) {
    addCurrentInventoryFiles(grouped, filePaths, excludeGlobs, sourceExtensions);
  }
  return [...grouped.entries()]
    .map(([directory, siblings]) => ({ path: directory, siblings: uniqSorted(siblings) }))
    .filter((directory) => directory.siblings.length > 1)
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function addCurrentInventoryFiles(
  grouped: Map<string, string[]>,
  filePaths: readonly string[],
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): void {
  for (const filePath of filePaths) {
    const normalized = toPosix(filePath);
    if (!isCurrentInventoryCandidate(normalized, excludeGlobs, sourceExtensions)) continue;
    const directory = path.posix.dirname(normalized);
    const siblings = grouped.get(directory) ?? [];
    siblings.push(normalized);
    grouped.set(directory, siblings);
  }
}

function isCurrentInventoryCandidate(
  filePath: string,
  excludeGlobs: readonly string[],
  sourceExtensions: ReadonlySet<string>,
): boolean {
  if (matchesAnyGlob(filePath, excludeGlobs)) return false;
  if (isExcludedPath(filePath)) return false;
  return isSourceLike(path.posix.basename(filePath), sourceExtensions);
}

function runCurrentDirectoryCheck(
  directory: string,
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  allowedPairKeys: ReadonlySet<string>,
): DriftFinding[] {
  if (siblings.length <= GHOST_FILES_DIRECTORY_PAIR_THRESHOLD) {
    return runPairwise(siblings, sourceExtensions, new Set<string>(), allowedPairKeys);
  }
  return runBucketedDirectory(directory, siblings, sourceExtensions, allowedPairKeys, runPairwise);
}

function runPairwise(
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  emittedPairs: Set<string>,
  allowedPairKeys: ReadonlySet<string>,
): DriftFinding[] {
  const ordered = uniqSorted(siblings);
  const findings: DriftFinding[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      addCurrentPairFinding(
        findings,
        ordered[leftIndex] ?? "",
        ordered[rightIndex] ?? "",
        sourceExtensions,
        emittedPairs,
        allowedPairKeys,
      );
    }
  }
  return findings;
}

function addCurrentPairFinding(
  findings: DriftFinding[],
  left: string,
  right: string,
  sourceExtensions: ReadonlySet<string>,
  emittedPairs: Set<string>,
  allowedPairKeys: ReadonlySet<string>,
): void {
  if (left.length === 0 || right.length === 0) return;
  const key = pairKey(left, right);
  if (allowedPairKeys.has(key)) return;
  if (emittedPairs.has(key)) return;
  const match = tryFindGhostMatchEitherDirection(left, right, sourceExtensions);
  if (match === undefined) return;
  emittedPairs.add(key);
  findings.push(currentPairFinding(match));
}

function tryFindGhostMatchEitherDirection(
  left: string,
  right: string,
  sourceExtensions: ReadonlySet<string>,
): GhostFileMatch | undefined {
  const [leftMatch] = findGhostMatches(left, [right], sourceExtensions);
  if (leftMatch !== undefined) return leftMatch;
  const [rightMatch] = findGhostMatches(right, [left], sourceExtensions);
  return rightMatch;
}
