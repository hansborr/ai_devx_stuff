// Near-duplicate function comparison, ranking, scope filtering, and finding
// construction. Fingerprint extraction lives in near-duplicates-fingerprint.ts.

import {
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
} from "./near-duplicates-config-values.js";
import { toPosix } from "./path-util.js";
import { changedFilesFromScope, type DetectorScope } from "./scope.js";
import type { DriftFinding, FindingProvenance } from "./types.js";

export {
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  NEAR_DUPLICATE_TOOL,
  type NearDuplicateEngine,
  SIMILARITY_TS_TOOL,
} from "./near-duplicates-config-values.js";

export type NearDuplicateFunctionRef = {
  readonly filePath: string;
  readonly name: string;
  readonly enclosingContext: string;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly tokenCount: number;
};

export type NearDuplicateFunction = NearDuplicateFunctionRef & {
  readonly features: readonly string[];
  readonly statementFeatures: readonly string[];
  readonly exactTokens: readonly string[];
};

export type NearDuplicatePair = {
  readonly left: NearDuplicateFunctionRef;
  readonly right: NearDuplicateFunctionRef;
  readonly similarity: number;
  readonly lineImpact: number;
  readonly score: number;
};

export type NearDuplicateCompareOptions = {
  readonly minLines?: number;
  readonly minTokens?: number;
  readonly similarityThreshold?: number;
  readonly tokenBandRatio?: number;
};

export { extractNearDuplicateFunctions } from "./near-duplicates-fingerprint.js";

export function findNearDuplicatePairs(
  functions: readonly NearDuplicateFunction[],
  options: NearDuplicateCompareOptions = {},
): NearDuplicatePair[] {
  const config = compareConfig(options);
  validateCompareConfig(config);
  const candidates = functions
    .filter((item) => item.lineCount >= config.minLines && item.tokenCount >= config.minTokens)
    .sort(compareByTokenThenLocation);
  const pairs: NearDuplicatePair[] = [];
  for (const bucket of candidateBuckets(candidates)) {
    addPairsForBucket(bucket, config, pairs);
  }
  return sortNearDuplicatePairs(pairs);
}

export function sortNearDuplicatePairs(pairs: readonly NearDuplicatePair[]): NearDuplicatePair[] {
  return [...pairs].sort(
    (left, right) =>
      right.score - left.score ||
      left.left.filePath.localeCompare(right.left.filePath, "en") ||
      left.left.startLine - right.left.startLine ||
      left.right.filePath.localeCompare(right.right.filePath, "en") ||
      left.right.startLine - right.right.startLine,
  );
}

export function buildNearDuplicatePair(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
  similarity: number,
): NearDuplicatePair {
  return canonicalPair(left, right, similarity);
}

export function compareNearDuplicateFunctions(
  left: NearDuplicateFunction,
  right: NearDuplicateFunction,
): NearDuplicatePair | null {
  if (rangesOverlapInSameFile(left, right)) return null;
  return canonicalPair(left, right, compareFunctionFingerprints(left, right));
}

export function buildNearDuplicateFindings(
  pairs: readonly NearDuplicatePair[],
  detectorScope: DetectorScope,
  provenance: FindingProvenance,
): DriftFinding[] {
  const changed = changedFileSet(detectorScope);
  return sortNearDuplicatePairs(pairs)
    .filter((pair) => pairTouchesScope(pair, detectorScope, changed))
    .map((pair) => pairFinding(pair, changed, provenance));
}

export function buildNearDuplicateDiagnosticFinding(message: string): DriftFinding {
  return {
    check: "near-duplicates",
    file: ".",
    message: `near-duplicates could not extract function fingerprints (${message})`,
    hint: "report-only: re-run drift:ai locally to inspect the failure; near-duplicates is otherwise not reported for this run.",
  };
}

export type ResolvedCompareConfig = {
  readonly minLines: number;
  readonly minTokens: number;
  readonly similarityThreshold: number;
  readonly tokenBandRatio: number;
};

function compareConfig(options: NearDuplicateCompareOptions): ResolvedCompareConfig {
  return {
    minLines: options.minLines ?? DEFAULT_NEAR_DUPLICATE_MIN_LINES,
    minTokens: options.minTokens ?? DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
    similarityThreshold: options.similarityThreshold ?? DEFAULT_NEAR_DUPLICATE_SIMILARITY,
    tokenBandRatio: options.tokenBandRatio ?? DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  };
}

// NaN compares false against every bound, so range checks alone would let
// non-finite values through silently.
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function requireUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`near-duplicates: ${name} must be within [0, 1]`);
  }
}

function validateCompareConfig(config: ResolvedCompareConfig): void {
  if (!isPositiveInteger(config.minLines) || !isPositiveInteger(config.minTokens)) {
    throw new RangeError("near-duplicates: minLines and minTokens must be integers >= 1");
  }
  requireUnitInterval("similarityThreshold", config.similarityThreshold);
  requireUnitInterval("tokenBandRatio", config.tokenBandRatio);
}

function candidateBuckets(candidates: readonly NearDuplicateFunction[]): NearDuplicateFunction[][] {
  const buckets = new Map<string, NearDuplicateFunction[]>();
  for (const candidate of candidates) {
    const key = statementBucketKey(candidate);
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].filter((bucket) => bucket.length > 1);
}

function statementBucketKey(candidate: NearDuplicateFunction): string {
  return [...candidate.statementFeatures]
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("|");
}

function addPairsForBucket(
  candidates: readonly NearDuplicateFunction[],
  config: ResolvedCompareConfig,
  pairs: NearDuplicatePair[],
): void {
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    addPairsForCandidate(candidates, leftIndex, config, pairs);
  }
}

function addPairsForCandidate(
  candidates: readonly NearDuplicateFunction[],
  leftIndex: number,
  config: ResolvedCompareConfig,
  pairs: NearDuplicatePair[],
): void {
  const left = candidates[leftIndex];
  if (left === undefined) return;
  for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
    const right = candidates[rightIndex];
    if (right === undefined) continue;
    if (!withinTokenBand(left, right, config.tokenBandRatio)) break;
    addPairIfSimilar(left, right, config.similarityThreshold, pairs);
  }
}

function addPairIfSimilar(
  left: NearDuplicateFunction,
  right: NearDuplicateFunction,
  threshold: number,
  pairs: NearDuplicatePair[],
): void {
  if (rangesOverlapInSameFile(left, right)) return;
  const similarity = compareFunctionFingerprints(left, right);
  if (similarity >= threshold) pairs.push(canonicalPair(left, right, similarity));
}

function compareByTokenThenLocation(
  left: NearDuplicateFunction,
  right: NearDuplicateFunction,
): number {
  return (
    left.tokenCount - right.tokenCount ||
    left.filePath.localeCompare(right.filePath, "en") ||
    left.startLine - right.startLine
  );
}

function withinTokenBand(
  left: NearDuplicateFunction,
  right: NearDuplicateFunction,
  tokenBandRatio: number,
): boolean {
  const lower = Math.min(left.tokenCount, right.tokenCount);
  const upper = Math.max(left.tokenCount, right.tokenCount);
  if (upper === 0) return false;
  return lower / upper >= 1 - tokenBandRatio;
}

function rangesOverlapInSameFile(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
): boolean {
  if (left.filePath !== right.filePath) return false;
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function compareFunctionFingerprints(
  left: NearDuplicateFunction,
  right: NearDuplicateFunction,
): number {
  const featureSimilarity = multisetDice(left.features, right.features);
  const statementSimilarity = multisetDice(left.statementFeatures, right.statementFeatures);
  return roundSimilarity(featureSimilarity * 0.75 + statementSimilarity * 0.25);
}

function multisetDice(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  let intersection = 0;
  for (const item of right) {
    const count = counts.get(item) ?? 0;
    if (count === 0) continue;
    intersection += 1;
    counts.set(item, count - 1);
  }
  return (2 * intersection) / (left.length + right.length);
}

function canonicalPair(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
  similarity: number,
): NearDuplicatePair {
  const [first, second] = locationKey(left) <= locationKey(right) ? [left, right] : [right, left];
  const rounded = roundSimilarity(similarity);
  const lineImpact = Math.max(first.lineCount, second.lineCount);
  return {
    left: first,
    right: second,
    similarity: rounded,
    lineImpact,
    score: roundScore(lineImpact * rounded),
  };
}

function changedFileSet(detectorScope: DetectorScope): ReadonlySet<string> | null {
  if (detectorScope.scopeMode === "current") return null;
  return new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
}

function pairTouchesScope(
  pair: NearDuplicatePair,
  detectorScope: DetectorScope,
  changed: ReadonlySet<string> | null,
): boolean {
  if (detectorScope.scopeMode === "current") return true;
  if (changed === null) return false;
  return changed.has(pair.left.filePath) || changed.has(pair.right.filePath);
}

function pairFinding(
  pair: NearDuplicatePair,
  changed: ReadonlySet<string> | null,
  provenance: FindingProvenance,
): DriftFinding {
  const primary = primarySide(pair, changed);
  const other = primary === pair.left ? pair.right : pair.left;
  const percent = Math.round(pair.similarity * 100);
  return {
    check: "near-duplicates",
    file: formatLocation(primary),
    message: `near-duplicates ${other.name} (${percent}% similar, ${String(pair.lineImpact)} lines)`,
    hint: "compare the two functions and extract the shared decision flow when the duplication is intentional; otherwise keep the clearer implementation and delete the clone.",
    relatedFiles: [formatLocation(other)],
    details: {
      similarity: pair.similarity,
      lineImpact: pair.lineImpact,
      score: pair.score,
      primaryFunction: primary.name,
      duplicateFunction: other.name,
      ...(hasTierDetails(pair) ? { tiers: pair.tiers, primaryTier: pair.primaryTier } : {}),
    },
    provenance,
  };
}

function hasTierDetails(pair: NearDuplicatePair): pair is NearDuplicatePair & {
  readonly tiers: readonly string[];
  readonly primaryTier: string;
} {
  return "tiers" in pair && "primaryTier" in pair;
}

function primarySide(
  pair: NearDuplicatePair,
  changed: ReadonlySet<string> | null,
): NearDuplicateFunctionRef {
  if (changed !== null) {
    const leftChanged = changed.has(pair.left.filePath);
    const rightChanged = changed.has(pair.right.filePath);
    if (leftChanged && !rightChanged) return pair.left;
    if (rightChanged && !leftChanged) return pair.right;
  }
  return locationKey(pair.left) <= locationKey(pair.right) ? pair.left : pair.right;
}

function formatLocation(item: NearDuplicateFunctionRef): string {
  return `${item.filePath}:${String(item.startLine)}-${String(item.endLine)}`;
}

function locationKey(item: NearDuplicateFunctionRef): string {
  return `${item.filePath}:${String(item.startLine).padStart(8, "0")}`;
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
