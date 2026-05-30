import path from "node:path";

import { GHOST_FILES_BUCKET_CAP } from "./ghost-files-constants.js";
import { oversizedBucketHint } from "./ghost-files-findings.js";
import type { GhostFileTuning } from "./ghost-files-match.js";
import { normalizedTokens, strongTokens } from "./ghost-files-tokens.js";
import { uniqSorted } from "./path-util.js";
import type { DriftFinding } from "./types.js";

type TokenBucket = {
  readonly key: string;
  readonly files: readonly string[];
};

type OversizedBucket = {
  readonly key: string;
  readonly size: number;
};

type TokenizedFile = {
  readonly filePath: string;
  readonly normalized: string;
  readonly strong: readonly string[];
};

export function runBucketedDirectory(
  directory: string,
  siblings: readonly string[],
  sourceExtensions: ReadonlySet<string>,
  tuning: GhostFileTuning,
  allowedPairKeys: ReadonlySet<string>,
  runPairwise: (
    siblings: readonly string[],
    sourceExtensions: ReadonlySet<string>,
    tuning: GhostFileTuning,
    emittedPairs: Set<string>,
    allowedPairKeys: ReadonlySet<string>,
  ) => DriftFinding[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const emittedPairs = new Set<string>();
  const oversized: OversizedBucket[] = [];
  for (const bucket of tokenBuckets(siblings, tuning.weakTokens)) {
    if (bucket.files.length <= GHOST_FILES_BUCKET_CAP) {
      findings.push(
        ...runPairwise(bucket.files, sourceExtensions, tuning, emittedPairs, allowedPairKeys),
      );
    } else {
      oversized.push({ key: bucket.key, size: bucket.files.length });
    }
  }
  findings.push(...oversizedBucketFindings(directory, oversized));
  return findings;
}

function tokenBuckets(siblings: readonly string[], weakTokens: ReadonlySet<string>): TokenBucket[] {
  const buckets = new Map<string, Set<string>>();
  for (const file of siblings.map((sibling) => tokenizeFileForBuckets(sibling, weakTokens))) {
    addTokenBucketMember(buckets, `identical-normalized:${file.normalized}`, file.filePath);
    for (const token of uniqSorted(file.strong)) {
      addTokenBucketMember(buckets, `strong:${token}`, file.filePath);
    }
  }
  return [...buckets.entries()].map(toTokenBucket).sort(compareBucket);
}

function tokenizeFileForBuckets(filePath: string, weakTokens: ReadonlySet<string>): TokenizedFile {
  const tokens = normalizedTokens(path.posix.basename(filePath));
  return {
    filePath,
    normalized: tokens.join("-"),
    strong: strongTokens(tokens, weakTokens),
  };
}

function addTokenBucketMember(
  buckets: Map<string, Set<string>>,
  key: string,
  filePath: string,
): void {
  if (key.endsWith(":")) return;
  const bucket = buckets.get(key) ?? new Set<string>();
  bucket.add(filePath);
  buckets.set(key, bucket);
}

function toTokenBucket([key, files]: readonly [string, Set<string>]): TokenBucket {
  return { key, files: uniqSorted([...files]) };
}

function compareBucket(left: TokenBucket, right: TokenBucket): number {
  return left.key.localeCompare(right.key, "en");
}

function oversizedBucketFindings(
  directory: string,
  oversized: readonly OversizedBucket[],
): DriftFinding[] {
  if (oversized.length === 0) return [];
  if (oversized.length >= 3) return [collapsedOversizedBucketFinding(directory, oversized)];
  return [...oversized]
    .sort(compareOversizedBucket)
    .map((bucket) => oversizedBucketFinding(directory, bucket));
}

function oversizedBucketFinding(directory: string, bucket: OversizedBucket): DriftFinding {
  return {
    check: "ghost-files",
    file: directory,
    message: `directory ${directory} has bucket '${bucket.key}' with ${bucket.size} entries (cap ${GHOST_FILES_BUCKET_CAP}); skipping pairwise comparison.`,
    hint: oversizedBucketHint(),
  };
}

function collapsedOversizedBucketFinding(
  directory: string,
  oversized: readonly OversizedBucket[],
): DriftFinding {
  return {
    check: "ghost-files",
    file: directory,
    message: `directory ${directory} has ${oversized.length} oversized buckets (cap ${GHOST_FILES_BUCKET_CAP}); largest: ${largestBucketSummary(oversized)}.`,
    hint: oversizedBucketHint(),
  };
}

function largestBucketSummary(oversized: readonly OversizedBucket[]): string {
  return [...oversized]
    .sort(compareLargestOversizedBucket)
    .slice(0, 5)
    .map((bucket) => `${bucket.key}(${bucket.size})`)
    .join(", ");
}

function compareOversizedBucket(left: OversizedBucket, right: OversizedBucket): number {
  return left.key.localeCompare(right.key, "en");
}

function compareLargestOversizedBucket(left: OversizedBucket, right: OversizedBucket): number {
  return right.size - left.size || left.key.localeCompare(right.key, "en");
}
