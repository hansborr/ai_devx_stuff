import { hashFeature } from "./feature-hash.js";
import {
  buildNearDuplicatePair,
  type NearDuplicateFunction,
  type NearDuplicateFunctionRef,
  type NearDuplicatePair,
} from "./near-duplicates.js";
import {
  EXACT_NEAR_DUPLICATE_MAX_EQUALITY_GROUP,
  EXACT_NEAR_DUPLICATE_MAX_PROJECTED_PAIRS,
  EXACT_NEAR_DUPLICATE_MIN_LINES,
  EXACT_NEAR_DUPLICATE_MIN_TOKENS,
  isExactCloneFileEligible,
} from "./near-duplicates-exact-config.js";

type NearDuplicateTier = "exact" | "fuzzy";

export type NearDuplicateOccurrencePair = NearDuplicatePair & {
  readonly tiers: readonly NearDuplicateTier[];
  readonly primaryTier: NearDuplicateTier;
};

type ExactCloneAudit = {
  readonly eligibleFunctions: number;
  readonly hashBuckets: number;
  readonly maximumRawHashBucketSize: number;
  readonly maximumEqualityGroupSize: number;
  readonly projectedPairs: number;
  readonly postOverlapPairs: number;
};

export type ExactCloneResult =
  | {
      readonly ok: true;
      readonly pairs: readonly NearDuplicateOccurrencePair[];
      readonly audit: ExactCloneAudit;
    }
  | { readonly ok: false; readonly error: string; readonly audit: ExactCloneAudit };

export type ExactCloneOptions = {
  readonly hashSequence?: (encodedSequence: string) => string;
};

type EqualityGroup = {
  readonly hash: string;
  readonly functions: readonly NearDuplicateFunction[];
};

type EncodedFunction = {
  readonly item: NearDuplicateFunction;
  readonly sequence: string;
};

export function findExactFunctionClonePairs(
  functions: readonly NearDuplicateFunction[],
  options: ExactCloneOptions = {},
): ExactCloneResult {
  const eligible = functions.filter(isExactEligible);
  const hashSequence = options.hashSequence ?? hashFeature;
  const hashed = hashBuckets(eligible, hashSequence);
  const groups = equalityGroups(hashed);
  const rawMaximum = maximumSize([...hashed.values()]);
  const equalityMaximum = maximumSize(groups.map((group) => group.functions));
  let projectedPairs = 0;
  for (const group of groups) {
    const projected = pairProjection(group.functions.length);
    projectedPairs += projected;
    const audit = buildAudit(
      eligible.length,
      hashed.size,
      rawMaximum,
      equalityMaximum,
      projectedPairs,
      0,
    );
    if (group.functions.length > EXACT_NEAR_DUPLICATE_MAX_EQUALITY_GROUP) {
      return {
        ok: false,
        error: `exact clone bucket ${group.hash.slice(0, 16)} has ${String(group.functions.length)} functions and ${String(projected)} projected pairs (maximum group ${String(EXACT_NEAR_DUPLICATE_MAX_EQUALITY_GROUP)})`,
        audit,
      };
    }
    if (projectedPairs > EXACT_NEAR_DUPLICATE_MAX_PROJECTED_PAIRS) {
      return {
        ok: false,
        error: `exact clone groups project ${String(projectedPairs)} pairs (maximum ${String(EXACT_NEAR_DUPLICATE_MAX_PROJECTED_PAIRS)})`,
        audit,
      };
    }
  }
  const pairs = materializePairs(groups);
  return {
    ok: true,
    pairs,
    audit: buildAudit(
      eligible.length,
      hashed.size,
      rawMaximum,
      equalityMaximum,
      projectedPairs,
      pairs.length,
    ),
  };
}

function isExactEligible(item: NearDuplicateFunction): boolean {
  return (
    isExactCloneFileEligible(item.filePath) &&
    item.lineCount >= EXACT_NEAR_DUPLICATE_MIN_LINES &&
    item.exactTokens.length >= EXACT_NEAR_DUPLICATE_MIN_TOKENS
  );
}

function hashBuckets(
  functions: readonly NearDuplicateFunction[],
  hashSequence: (encodedSequence: string) => string,
): Map<string, EncodedFunction[]> {
  const buckets = new Map<string, EncodedFunction[]>();
  for (const item of functions) {
    const sequence = encodeTokenSequence(item.exactTokens);
    const hash = hashSequence(sequence);
    const bucket = buckets.get(hash) ?? [];
    bucket.push({ item, sequence });
    buckets.set(hash, bucket);
  }
  return buckets;
}

function equalityGroups(buckets: ReadonlyMap<string, readonly EncodedFunction[]>): EqualityGroup[] {
  const groups: EqualityGroup[] = [];
  for (const [hash, bucket] of buckets) {
    const bySequence = new Map<string, NearDuplicateFunction[]>();
    for (const encoded of bucket) {
      const group = bySequence.get(encoded.sequence) ?? [];
      group.push(encoded.item);
      bySequence.set(encoded.sequence, group);
    }
    for (const functions of bySequence.values()) {
      groups.push({ hash, functions });
    }
  }
  return groups;
}

function encodeTokenSequence(tokens: readonly string[]): string {
  return tokens.map((token) => `${String(token.length)}:${token}`).join("");
}

function pairProjection(size: number): number {
  return (size * (size - 1)) / 2;
}

function maximumSize(groups: readonly (readonly unknown[])[]): number {
  let maximum = 0;
  for (const group of groups) maximum = Math.max(maximum, group.length);
  return maximum;
}

function materializePairs(groups: readonly EqualityGroup[]): NearDuplicateOccurrencePair[] {
  const pairs: NearDuplicateOccurrencePair[] = [];
  for (const group of groups) {
    for (let leftIndex = 0; leftIndex < group.functions.length; leftIndex += 1) {
      const left = group.functions[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < group.functions.length; rightIndex += 1) {
        const right = group.functions[rightIndex];
        if (right === undefined || occurrencesOverlap(left, right)) continue;
        pairs.push(exactPair(left, right));
      }
    }
  }
  return pairs.sort((left, right) =>
    occurrencePairIdentity(left.left, left.right).localeCompare(
      occurrencePairIdentity(right.left, right.right),
      "en",
    ),
  );
}

function occurrencesOverlap(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
): boolean {
  if (left.filePath !== right.filePath) return false;
  if (left.startOffset === null || left.endOffset === null) return false;
  if (right.startOffset === null || right.endOffset === null) return false;
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function exactPair(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
): NearDuplicateOccurrencePair {
  return {
    ...buildNearDuplicatePair(left, right, 1),
    tiers: ["exact"],
    primaryTier: "exact",
  };
}

export function occurrencePairIdentity(
  left: NearDuplicateFunctionRef | undefined,
  right: NearDuplicateFunctionRef | undefined,
): string {
  if (left === undefined || right === undefined) return "";
  const leftKey = occurrenceSideIdentity(left);
  const rightKey = occurrenceSideIdentity(right);
  return encodeIdentityParts(leftKey <= rightKey ? [leftKey, rightKey] : [rightKey, leftKey]);
}

function occurrenceSideIdentity(item: NearDuplicateFunctionRef): string {
  if (item.startOffset === null || item.endOffset === null) {
    throw new Error(`near-duplicates occurrence lacks offsets: ${item.filePath}#${item.name}`);
  }
  return encodeIdentityParts([
    item.filePath,
    item.enclosingContext,
    item.name,
    String(item.startOffset),
    String(item.endOffset),
  ]);
}

function encodeIdentityParts(parts: readonly string[]): string {
  return parts.map((part) => `${String(part.length)}:${part}`).join("");
}

export function unionNearDuplicateOccurrencePairs(
  fuzzyPairs: readonly NearDuplicateOccurrencePair[],
  exactPairs: readonly NearDuplicateOccurrencePair[],
): NearDuplicateOccurrencePair[] {
  const byIdentity = new Map<string, NearDuplicateOccurrencePair>();
  for (const pair of [...fuzzyPairs, ...exactPairs]) {
    const identity = occurrencePairIdentity(pair.left, pair.right);
    const existing = byIdentity.get(identity);
    if (existing === undefined) {
      byIdentity.set(identity, pair);
      continue;
    }
    byIdentity.set(identity, {
      ...(pair.primaryTier === "exact" ? pair : existing),
      tiers: ["exact", "fuzzy"],
      primaryTier: "exact",
    });
  }
  return [...byIdentity.values()].sort((left, right) =>
    occurrencePairIdentity(left.left, left.right).localeCompare(
      occurrencePairIdentity(right.left, right.right),
      "en",
    ),
  );
}

export function markFuzzyOccurrencePairs(
  pairs: readonly NearDuplicatePair[],
): NearDuplicateOccurrencePair[] {
  return pairs.map((pair) => ({
    ...pair,
    tiers: ["fuzzy"],
    primaryTier: "fuzzy",
  }));
}

function buildAudit(
  eligibleFunctions: number,
  hashBucketsCount: number,
  maximumRawHashBucketSize: number,
  maximumEqualityGroupSize: number,
  projectedPairs: number,
  postOverlapPairs: number,
): ExactCloneAudit {
  return {
    eligibleFunctions,
    hashBuckets: hashBucketsCount,
    maximumRawHashBucketSize,
    maximumEqualityGroupSize,
    projectedPairs,
    postOverlapPairs,
  };
}
