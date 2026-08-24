// MinHash/LSH clone-candidate generation over near-duplicate function
// fingerprints, plus a benchmark that scores the shortlist against the labeled
// clone corpus.
//
// This is prototype-lane tooling (task 41a). The generator is high-recall by
// design: its job is to produce a short list of likely clone pairs for a later,
// more precise verifier — not to be a finished clone check. It is the candidate
// generator beneath the registered `clone-candidates` command and its advisory
// layer; the live near-duplicates check remains distinct and untouched. The
// corpus benchmark is exercised only by tests and is not part of that command.
//
// Caps for function count (here), per-function shingle count, and candidate-pair
// count (both in minhash-lsh) are surfaced in the result's truncation block so a
// capped/partial run can be disclosed rather than read as complete.

import {
  cloneCorpusFunctionId,
  type CloneCorpusLabels,
  DEFAULT_CLONE_CORPUS_DIR,
  extractCloneCorpusNearDuplicateFunctions,
  type LabeledPairScore,
  loadCloneCorpusLabels,
  scoreDetectedPairsAgainstLabels,
} from "./clone-corpus.js";
import {
  findLshCandidatePairs,
  type LshCandidatePair,
  type MinHashConfig,
  type MinHashDocument,
  type ResolvedMinHashConfig,
} from "./minhash-lsh.js";
import {
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  type NearDuplicateFunction,
  type NearDuplicateFunctionRef,
} from "./near-duplicates.js";

export const DEFAULT_CLONE_CANDIDATE_MAX_FUNCTIONS = 5_000;

export type CloneCandidateOptions = {
  // Size floors, defaulting to the live near-duplicates floors so the candidate
  // shortlist is comparable to that engine's baseline on the same corpus.
  readonly minLines?: number;
  readonly minTokens?: number;
  readonly maxFunctions?: number;
  readonly minhash?: Partial<MinHashConfig>;
};

export type CloneCandidate = {
  // Ordered by source location (filePath then start line), mirroring the
  // near-duplicates engine's canonical pair ordering.
  readonly left: NearDuplicateFunctionRef;
  readonly right: NearDuplicateFunctionRef;
  readonly estimatedSimilarity: number;
};

type CloneCandidateCaps = {
  readonly maxFunctions: number;
  readonly maxShinglesPerFunction: number;
  readonly maxCandidatePairs: number;
};

type CloneCandidateTruncation = {
  // Functions at or above the size floors, before the maxFunctions cap.
  readonly eligibleFunctions: number;
  // Functions actually fed to MinHash (== eligibleFunctions unless capped).
  readonly consideredFunctions: number;
  readonly functionsTruncated: boolean;
  readonly shingleTruncatedFunctions: number;
  readonly candidatePairsTruncated: boolean;
};

export type CloneCandidateResult = {
  readonly candidates: readonly CloneCandidate[];
  readonly caps: CloneCandidateCaps;
  readonly minhashConfig: ResolvedMinHashConfig;
  readonly truncation: CloneCandidateTruncation;
};

export function generateCloneCandidates(
  functions: readonly NearDuplicateFunction[],
  options: CloneCandidateOptions = {},
): CloneCandidateResult {
  const minLines = options.minLines ?? DEFAULT_NEAR_DUPLICATE_MIN_LINES;
  const minTokens = options.minTokens ?? DEFAULT_NEAR_DUPLICATE_MIN_TOKENS;
  const maxFunctions = positiveCap(options.maxFunctions, DEFAULT_CLONE_CANDIDATE_MAX_FUNCTIONS);

  const eligible = functions
    .filter((fn) => fn.lineCount >= minLines && fn.tokenCount >= minTokens)
    .sort(compareByLocation);
  const considered = eligible.slice(0, maxFunctions);

  const byId = new Map<string, NearDuplicateFunction>();
  const documents: MinHashDocument[] = [];
  for (const fn of considered) {
    const id = documentId(fn);
    byId.set(id, fn);
    documents.push({ id, features: fn.features });
  }

  const lsh = findLshCandidatePairs(documents, options.minhash);
  const candidates = lsh.candidates
    .map((pair) => toCandidate(pair, byId))
    .filter((candidate): candidate is CloneCandidate => candidate !== null);

  return {
    candidates,
    caps: {
      maxFunctions,
      maxShinglesPerFunction: lsh.config.maxShinglesPerDocument,
      maxCandidatePairs: lsh.config.maxCandidatePairs,
    },
    minhashConfig: lsh.config,
    truncation: {
      eligibleFunctions: eligible.length,
      consideredFunctions: considered.length,
      functionsTruncated: eligible.length > considered.length,
      shingleTruncatedFunctions: lsh.shingleTruncatedDocuments,
      candidatePairsTruncated: lsh.candidatePairsTruncated,
    },
  };
}

export type CloneCandidateCorpusEvaluation = LabeledPairScore & {
  readonly labels: CloneCorpusLabels;
  readonly candidates: readonly CloneCandidate[];
  readonly caps: CloneCandidateCaps;
  readonly minhashConfig: ResolvedMinHashConfig;
  readonly truncation: CloneCandidateTruncation;
};

// Run the MinHash candidate generator over the clone corpus and score its
// shortlist against the engine-agnostic labels, reusing the same confusion-matrix
// scoring as the ts-morph baseline (clone-corpus.ts) so the two are comparable.
export function evaluateCloneCorpusCandidates(
  corpusDir = DEFAULT_CLONE_CORPUS_DIR,
  options: CloneCandidateOptions = {},
): CloneCandidateCorpusEvaluation {
  const labels = loadCloneCorpusLabels(corpusDir);
  const functions = extractCloneCorpusNearDuplicateFunctions(corpusDir);
  const result = generateCloneCandidates(functions, options);
  const detected = result.candidates.map((candidate) => ({
    a: cloneCorpusFunctionId(candidate.left.filePath, candidate.left.name),
    b: cloneCorpusFunctionId(candidate.right.filePath, candidate.right.name),
  }));
  const known = new Set(functions.map((fn) => cloneCorpusFunctionId(fn.filePath, fn.name)));
  return {
    labels,
    candidates: result.candidates,
    caps: result.caps,
    minhashConfig: result.minhashConfig,
    truncation: result.truncation,
    ...scoreDetectedPairsAgainstLabels(detected, labels, known),
  };
}

function toCandidate(
  pair: LshCandidatePair,
  byId: ReadonlyMap<string, NearDuplicateFunction>,
): CloneCandidate | null {
  const first = byId.get(pair.a);
  const second = byId.get(pair.b);
  if (first === undefined || second === undefined) return null;
  const [left, right] = compareByLocation(first, second) <= 0 ? [first, second] : [second, first];
  return { left: toRef(left), right: toRef(right), estimatedSimilarity: pair.estimatedSimilarity };
}

function toRef(fn: NearDuplicateFunction): NearDuplicateFunctionRef {
  return {
    filePath: fn.filePath,
    name: fn.name,
    enclosingContext: fn.enclosingContext,
    startOffset: fn.startOffset,
    endOffset: fn.endOffset,
    startLine: fn.startLine,
    endLine: fn.endLine,
    lineCount: fn.lineCount,
    tokenCount: fn.tokenCount,
  };
}

// A unique id per function (one function per start line in a file), independent of
// the corpus `path#name` label id, so two same-named functions never collide
// inside the MinHash run.
function documentId(fn: NearDuplicateFunctionRef): string {
  return `${fn.filePath}#${fn.name}#${String(fn.startLine)}`;
}

function compareByLocation(
  left: NearDuplicateFunctionRef,
  right: NearDuplicateFunctionRef,
): number {
  return left.filePath.localeCompare(right.filePath, "en") || left.startLine - right.startLine;
}

function positiveCap(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}
