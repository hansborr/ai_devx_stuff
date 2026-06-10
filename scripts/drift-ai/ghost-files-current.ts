import path from "node:path";

import type { GhostFileAllowedPair } from "./config.js";
import { matchesAnyGlob } from "./config-match.js";
import { runBucketedDirectory } from "./ghost-files-buckets.js";
import { GHOST_FILES_DIRECTORY_PAIR_THRESHOLD } from "./ghost-files-constants.js";
import { currentPairFinding, pairKey, sortFindings } from "./ghost-files-findings.js";
import {
  findGhostMatches,
  type GhostFileMatch,
  type GhostFileTuning,
} from "./ghost-files-match.js";
import { isRoleSplitFamilyPair } from "./ghost-files-role-family.js";
import { isExcludedPath } from "./ghost-files-tokens.js";
import { isSourceLike, toPosix, uniqSorted } from "./path-util.js";
import type { DriftFinding } from "./types.js";

type PairwiseRunner = (
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  tuning: GhostFileTuning,
  emittedPairs: Set<string>,
  allowedPairKeys: ReadonlySet<string>,
) => DriftFinding[];

export type RunCurrentGhostFilesOptions = {
  readonly inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined;
  readonly excludeGlobs: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly tuning: GhostFileTuning;
  readonly allowedPairs: readonly GhostFileAllowedPair[];
  readonly dependentsHint: string;
  readonly roleMarkerTokens: ReadonlySet<string>;
};

export function runCurrentGhostFilesCheck(options: RunCurrentGhostFilesOptions): DriftFinding[] {
  const { inventoryByDir, excludeGlobs, sourceExtensions, tuning } = options;
  if (inventoryByDir === undefined) {
    throw new Error("runGhostFilesCheck requires inventoryByDir for current scope.");
  }
  const allowedPairKeys = currentAllowedPairKeys(options.allowedPairs);
  // Capture dependentsHint and roleMarkerTokens in the pairwise runner so the bucket
  // fallback callback signature stays unchanged (it only needs to forward, not know
  // either value).
  const pairwise: PairwiseRunner = (siblings, extensions, pairTuning, emittedPairs, pairKeys) =>
    runPairwise(siblings, extensions, pairTuning, emittedPairs, pairKeys, {
      dependentsHint: options.dependentsHint,
      roleMarkerTokens: options.roleMarkerTokens,
    });
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
        tuning,
        allowedPairKeys,
        pairwise,
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
  tuning: GhostFileTuning,
  allowedPairKeys: ReadonlySet<string>,
  pairwise: PairwiseRunner,
): DriftFinding[] {
  if (siblings.length <= GHOST_FILES_DIRECTORY_PAIR_THRESHOLD) {
    return pairwise(siblings, sourceExtensions, tuning, new Set<string>(), allowedPairKeys);
  }
  return runBucketedDirectory(
    directory,
    siblings,
    sourceExtensions,
    tuning,
    allowedPairKeys,
    pairwise,
  );
}

type CurrentPairLabeling = {
  readonly dependentsHint: string;
  readonly roleMarkerTokens: ReadonlySet<string>;
};

type CurrentPairContext = CurrentPairLabeling & {
  readonly sourceExtensions: ReadonlySet<string>;
  readonly tuning: GhostFileTuning;
  readonly emittedPairs: Set<string>;
  readonly allowedPairKeys: ReadonlySet<string>;
};

function runPairwise(
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  tuning: GhostFileTuning,
  emittedPairs: Set<string>,
  allowedPairKeys: ReadonlySet<string>,
  labeling: CurrentPairLabeling,
): DriftFinding[] {
  const ordered = uniqSorted(siblings);
  const context: CurrentPairContext = {
    sourceExtensions,
    tuning,
    emittedPairs,
    allowedPairKeys,
    ...labeling,
  };
  const findings: DriftFinding[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      addCurrentPairFinding(findings, ordered[leftIndex] ?? "", ordered[rightIndex] ?? "", context);
    }
  }
  return findings;
}

function addCurrentPairFinding(
  findings: DriftFinding[],
  left: string,
  right: string,
  context: CurrentPairContext,
): void {
  if (left.length === 0 || right.length === 0) return;
  const key = pairKey(left, right);
  if (context.allowedPairKeys.has(key)) return;
  if (context.emittedPairs.has(key)) return;
  const match = tryFindGhostMatchEitherDirection(
    left,
    right,
    context.sourceExtensions,
    context.tuning,
  );
  if (match === undefined) return;
  // Current-scope only: an established role-split family (parallel `duplicate-*`
  // detectors, a `foo-types.ts` companion) is intentional, not a sibling that
  // should have extended the other. Changed scope still reports a freshly added
  // companion. A `weak-suffix-variant` already shares its strong-token set, so only
  // here can a role marker or repeated token be the whole difference.
  if (
    match.kind === "weak-suffix-variant" &&
    isRoleSplitFamilyPair(left, right, context.roleMarkerTokens)
  ) {
    return;
  }
  context.emittedPairs.add(key);
  findings.push(currentPairFinding(match, context.dependentsHint));
}

function tryFindGhostMatchEitherDirection(
  left: string,
  right: string,
  sourceExtensions: ReadonlySet<string>,
  tuning: GhostFileTuning,
): GhostFileMatch | undefined {
  const [leftMatch] = findGhostMatches(left, [right], sourceExtensions, tuning);
  if (leftMatch !== undefined) return leftMatch;
  const [rightMatch] = findGhostMatches(right, [left], sourceExtensions, tuning);
  return rightMatch;
}
