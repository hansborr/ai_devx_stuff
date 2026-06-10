// Deterministic MinHash + LSH candidate-pair generation over string-feature
// documents. This is a generic, prototype-lane primitive: it knows nothing about
// functions, the clone corpus, or the drift report. It estimates Jaccard
// similarity of each document's shingle set via a fixed, seeded hash family, then
// uses LSH banding to emit only the document pairs likely to be similar, so a
// later (more precise) verifier never has to compare every pair.
//
// Determinism is a hard requirement (task 41a): the hash family is derived from a
// fixed seed string, shingles are order-independent for the signature and sorted
// for any capped selection, and the candidate list is sorted before return. Same
// input -> identical candidate list and estimated similarities across runs and
// platforms.
//
// Caps (shingles-per-document and candidate-pair count) bound memory and let a
// caller disclose a partial run rather than presenting a truncated shortlist as a
// complete one.

import { hashFeature32 } from "./feature-hash.js";

export type MinHashConfig = {
  // Number of consecutive features per shingle. Larger k is more specific (fewer
  // accidental collisions) but less tolerant of small edits/reorderings.
  readonly shingleSize: number;
  // LSH banding. Signature length is bands * rowsPerBand. The approximate Jaccard
  // similarity at which a pair becomes a likely candidate is ~ (1/bands)^(1/rows).
  readonly bands: number;
  readonly rowsPerBand: number;
  // Per-document shingle cap. A document above the cap keeps a deterministic
  // (lexicographically first) subset and is reported as shingle-truncated.
  readonly maxShinglesPerDocument: number;
  // Global candidate-pair cap. Generation stops once this many distinct pairs
  // exist; the result is flagged truncated so a partial run is never mistaken for
  // a complete one.
  readonly maxCandidatePairs: number;
};

export type ResolvedMinHashConfig = MinHashConfig & {
  readonly signatureLength: number;
};

export const DEFAULT_MINHASH_CONFIG: MinHashConfig = {
  shingleSize: 3,
  bands: 24,
  rowsPerBand: 4,
  maxShinglesPerDocument: 4_096,
  maxCandidatePairs: 50_000,
};

export type MinHashDocument = {
  readonly id: string;
  readonly features: readonly string[];
};

export type LshCandidatePair = {
  // Document ids, ordered so a <= b by locale comparison.
  readonly a: string;
  readonly b: string;
  // Fraction of signature positions that agree, an unbiased Jaccard estimate
  // rounded to 3 decimals. Read as "how similar", not a precise verdict.
  readonly estimatedSimilarity: number;
};

export type LshCandidateResult = {
  readonly candidates: readonly LshCandidatePair[];
  readonly config: ResolvedMinHashConfig;
  // Documents that contributed at least one shingle (empty-feature docs cannot
  // collide and are dropped before banding).
  readonly consideredDocuments: number;
  readonly totalDocuments: number;
  readonly shingleTruncatedDocuments: number;
  // True when generation hit maxCandidatePairs and stopped early; the returned
  // candidates are then a deterministic but partial prefix, not the global top.
  readonly candidatePairsTruncated: boolean;
};

const SHINGLE_SEPARATOR = "|";
const PAIR_SEPARATOR = "|";
const MAX_UINT32 = 0xff_ff_ff_ff;

// Split a feature sequence into the set of its overlapping k-grams. Order does not
// affect the MinHash signature (min over a set is commutative), so the only reason
// to keep ordering stable is deterministic truncation, handled by the caller.
export function buildShingles(features: readonly string[], shingleSize: number): string[] {
  if (features.length === 0) return [];
  const size = Math.max(1, Math.floor(shingleSize));
  const shingles = new Set<string>();
  if (features.length <= size) {
    shingles.add(features.join(SHINGLE_SEPARATOR));
    return [...shingles];
  }
  for (let index = 0; index + size <= features.length; index += 1) {
    shingles.add(features.slice(index, index + size).join(SHINGLE_SEPARATOR));
  }
  return [...shingles];
}

// MinHash signature: for each seeded hash function, the minimum hash over all
// shingles. An empty shingle set yields an all-MAX signature (it agrees with no
// non-empty document), which is why empty documents are excluded from banding.
export function computeSignature(shingles: readonly string[], seeds: readonly number[]): number[] {
  const signature = new Array<number>(seeds.length).fill(MAX_UINT32);
  for (const shingle of shingles) {
    const base = hashFeature32(shingle);
    for (let index = 0; index < seeds.length; index += 1) {
      const candidate = mix32((base ^ (seeds[index] ?? 0)) >>> 0);
      if (candidate < (signature[index] ?? MAX_UINT32)) signature[index] = candidate;
    }
  }
  return signature;
}

export function estimateSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let agreements = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) agreements += 1;
  }
  return Math.round((agreements / left.length) * 1_000) / 1_000;
}

// Deterministic per-position seeds for the hash family. fmix32 avalanches the
// shingle hash so an XOR with the seed is enough to decorrelate positions.
export function buildSeeds(signatureLength: number): number[] {
  const seeds = new Array<number>(signatureLength);
  for (let index = 0; index < signatureLength; index += 1) {
    seeds[index] = hashFeature32(`minhash-seed:${String(index)}`);
  }
  return seeds;
}

export function resolveMinHashConfig(options: Partial<MinHashConfig> = {}): ResolvedMinHashConfig {
  const bands = positiveInt(options.bands, DEFAULT_MINHASH_CONFIG.bands);
  const rowsPerBand = positiveInt(options.rowsPerBand, DEFAULT_MINHASH_CONFIG.rowsPerBand);
  return {
    shingleSize: positiveInt(options.shingleSize, DEFAULT_MINHASH_CONFIG.shingleSize),
    bands,
    rowsPerBand,
    maxShinglesPerDocument: positiveInt(
      options.maxShinglesPerDocument,
      DEFAULT_MINHASH_CONFIG.maxShinglesPerDocument,
    ),
    maxCandidatePairs: positiveInt(
      options.maxCandidatePairs,
      DEFAULT_MINHASH_CONFIG.maxCandidatePairs,
    ),
    signatureLength: bands * rowsPerBand,
  };
}

export function findLshCandidatePairs(
  documents: readonly MinHashDocument[],
  options: Partial<MinHashConfig> = {},
): LshCandidateResult {
  const config = resolveMinHashConfig(options);
  const seeds = buildSeeds(config.signatureLength);
  const prepared = prepareDocuments(documents, config, seeds);
  const buckets = bandBuckets(prepared, config);
  const { pairs, truncated } = collectCandidatePairs(prepared, buckets, config);
  return {
    candidates: [...pairs.values()].sort(compareCandidatePairs),
    config,
    consideredDocuments: prepared.signatures.length,
    totalDocuments: documents.length,
    shingleTruncatedDocuments: prepared.shingleTruncatedDocuments,
    candidatePairsTruncated: truncated,
  };
}

type PreparedDocuments = {
  // Parallel arrays, sorted by document id for deterministic bucketing.
  readonly ids: readonly string[];
  readonly signatures: readonly number[][];
  readonly shingleTruncatedDocuments: number;
};

function prepareDocuments(
  documents: readonly MinHashDocument[],
  config: ResolvedMinHashConfig,
  seeds: readonly number[],
): PreparedDocuments {
  const ids: string[] = [];
  const signatures: number[][] = [];
  let shingleTruncatedDocuments = 0;
  const ordered = [...documents].sort((left, right) => left.id.localeCompare(right.id, "en"));
  for (const document of ordered) {
    const built = buildShingles(document.features, config.shingleSize);
    const shingles = cappedShingles(built, config.maxShinglesPerDocument);
    if (shingles.length < built.length) shingleTruncatedDocuments += 1;
    if (shingles.length === 0) continue;
    ids.push(document.id);
    signatures.push(computeSignature(shingles, seeds));
  }
  return { ids, signatures, shingleTruncatedDocuments };
}

function cappedShingles(shingles: readonly string[], cap: number): string[] {
  if (shingles.length <= cap) return [...shingles];
  return [...shingles].sort((left, right) => left.localeCompare(right, "en")).slice(0, cap);
}

function bandBuckets(
  prepared: PreparedDocuments,
  config: ResolvedMinHashConfig,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (let document = 0; document < prepared.signatures.length; document += 1) {
    const signature = prepared.signatures[document];
    if (signature === undefined) continue;
    for (let band = 0; band < config.bands; band += 1) {
      const start = band * config.rowsPerBand;
      const rows = signature.slice(start, start + config.rowsPerBand);
      const key = `${String(band)}#${rows.join(",")}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(document);
      buckets.set(key, bucket);
    }
  }
  return buckets;
}

function collectCandidatePairs(
  prepared: PreparedDocuments,
  buckets: Map<string, number[]>,
  config: ResolvedMinHashConfig,
): { pairs: Map<string, LshCandidatePair>; truncated: boolean } {
  const pairs = new Map<string, LshCandidatePair>();
  for (const indices of buckets.values()) {
    if (indices.length < 2) continue;
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i + 1; j < indices.length; j += 1) {
        const truncated = addCandidatePair(prepared, indices[i], indices[j], config, pairs);
        if (truncated) return { pairs, truncated: true };
      }
    }
  }
  return { pairs, truncated: false };
}

// Returns true when the cap was hit and generation must stop.
function addCandidatePair(
  prepared: PreparedDocuments,
  leftIndex: number | undefined,
  rightIndex: number | undefined,
  config: ResolvedMinHashConfig,
  pairs: Map<string, LshCandidatePair>,
): boolean {
  if (leftIndex === undefined || rightIndex === undefined) return false;
  const leftId = prepared.ids[leftIndex];
  const rightId = prepared.ids[rightIndex];
  const leftSig = prepared.signatures[leftIndex];
  const rightSig = prepared.signatures[rightIndex];
  if (
    leftId === undefined ||
    rightId === undefined ||
    leftSig === undefined ||
    rightSig === undefined
  ) {
    return false;
  }
  const [a, b] = leftId.localeCompare(rightId, "en") <= 0 ? [leftId, rightId] : [rightId, leftId];
  const key = `${a}${PAIR_SEPARATOR}${b}`;
  if (pairs.has(key)) return false;
  if (pairs.size >= config.maxCandidatePairs) return true;
  pairs.set(key, { a, b, estimatedSimilarity: estimateSimilarity(leftSig, rightSig) });
  return false;
}

function compareCandidatePairs(left: LshCandidatePair, right: LshCandidatePair): number {
  return (
    right.estimatedSimilarity - left.estimatedSimilarity ||
    left.a.localeCompare(right.a, "en") ||
    left.b.localeCompare(right.b, "en")
  );
}

// Murmur3 fmix32 finalizer: avalanches a 32-bit value so seeded hash positions
// are well-distributed and stay within 32-bit integer math (no BigInt needed).
function mix32(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85_eb_ca_6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2_b2_ae_35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}
