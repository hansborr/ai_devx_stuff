import { describe, expect, it } from "vitest";

import {
  type CloneCandidate,
  DEFAULT_CLONE_CANDIDATE_MAX_FUNCTIONS,
  evaluateCloneCorpusCandidates,
  generateCloneCandidates,
} from "./clone-candidates.js";
import { extractCloneCorpusNearDuplicateFunctions } from "./clone-corpus.js";

describe("evaluateCloneCorpusCandidates baseline", () => {
  // RECORDED baseline for the MinHash/LSH candidate generator (defaults:
  // shingleSize 3, 24 bands x 4 rows = 96-length signature). Like the ts-morph
  // baseline in clone-corpus.test.ts this is a measurement, not a quality target;
  // update it deliberately so an engine/corpus shift shows up in review.
  //
  // The shortlist recovers the same structural clones as the ts-morph engine
  // (exact/renamed/reordered) and misses extracted-helper and semantic. It matches
  // the ts-morph engine's recall (0.6) but is fuzzier on precision (0.75 vs 1.0):
  // it also flags the labeled near-miss precision trap (manhattan vs. chebyshev),
  // which the precise engine rejects. That recall-first-with-a-cheap-shortlist
  // tradeoff is what this benchmark exists to make visible before integration.
  it("recovers structural clones and records its false positives", () => {
    const evaluation = evaluateCloneCorpusCandidates();
    expect(evaluation.unknownFunctionRefs).toEqual([]);
    expect(evaluation.counts).toEqual({
      clonePairs: 5,
      nonPairs: 2,
      truePositives: 3,
      falseNegatives: 2,
      falsePositives: 1,
    });
    expect(evaluation.precision).toBe(0.75);
    expect(evaluation.recall).toBe(0.6);
    expect(evaluation.recallByCategory).toEqual({
      exact: { detected: 1, total: 1 },
      renamed: { detected: 1, total: 1 },
      reordered: { detected: 1, total: 1 },
      "extracted-helper": { detected: 0, total: 1 },
      semantic: { detected: 0, total: 1 },
    });
  });

  it("recovers the same true-positive structural clones as the ts-morph baseline", () => {
    const evaluation = evaluateCloneCorpusCandidates();
    expect(evaluation.truePositives).toEqual([
      "exact-clones.ts#sumDiagonalGrid <=> exact-clones.ts#sumDiagonalMatrix",
      "renamed-clones.ts#totalForInvoice <=> renamed-clones.ts#totalForLedger",
      "reordered-left.ts#buildDispatchPayload <=> reordered-right.ts#makeDispatchPayload",
    ]);
  });

  it("flags the labeled near-miss trap as its only false positive", () => {
    const evaluation = evaluateCloneCorpusCandidates();
    expect(evaluation.flaggedNonPairs).toEqual([
      "near-miss-distances.ts#chebyshevDistance <=> near-miss-distances.ts#manhattanDistance",
    ]);
    expect(evaluation.unexpectedPairs).toEqual([]);
  });

  it("discloses a complete (non-truncated) run with the default caps", () => {
    const evaluation = evaluateCloneCorpusCandidates();
    expect(evaluation.truncation).toEqual({
      eligibleFunctions: 15,
      consideredFunctions: 15,
      functionsTruncated: false,
      shingleTruncatedFunctions: 0,
      candidatePairsTruncated: false,
    });
    expect(evaluation.caps).toEqual({
      maxFunctions: DEFAULT_CLONE_CANDIDATE_MAX_FUNCTIONS,
      maxShinglesPerFunction: 4_096,
      maxCandidatePairs: 50_000,
    });
    expect(evaluation.minhashConfig.signatureLength).toBe(96);
  });
});

describe("evaluateCloneCorpusCandidates shortlist shape", () => {
  it("ranks the exact clone first at estimated similarity 1 and stays ordered", () => {
    const { candidates } = evaluateCloneCorpusCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    const sims = candidates.map((candidate) => candidate.estimatedSimilarity);
    expect([...sims].sort((left, right) => right - left)).toEqual(sims);
    const top = candidates[0];
    expect(top?.left.filePath).toBe("exact-clones.ts");
    expect(top?.estimatedSimilarity).toBe(1);
  });

  it("orders each candidate's two sides by source location", () => {
    const { candidates } = evaluateCloneCorpusCandidates();
    for (const candidate of candidates) {
      expect(
        locationKey(candidate.left).localeCompare(locationKey(candidate.right), "en"),
      ).toBeLessThanOrEqual(0);
      expect(candidate.estimatedSimilarity).toBeGreaterThan(0);
      expect(candidate.estimatedSimilarity).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across runs", () => {
    expect(evaluateCloneCorpusCandidates().candidates).toEqual(
      evaluateCloneCorpusCandidates().candidates,
    );
  });
});

describe("generateCloneCandidates caps", () => {
  const functions = extractCloneCorpusNearDuplicateFunctions();

  it("caps the function inventory and discloses the truncation", () => {
    const result = generateCloneCandidates(functions, { maxFunctions: 4 });
    expect(result.truncation.eligibleFunctions).toBe(15);
    expect(result.truncation.consideredFunctions).toBe(4);
    expect(result.truncation.functionsTruncated).toBe(true);
    expect(result.caps.maxFunctions).toBe(4);
  });

  it("caps the candidate-pair count and flags the partial shortlist", () => {
    const result = generateCloneCandidates(functions, { minhash: { maxCandidatePairs: 1 } });
    expect(result.candidates).toHaveLength(1);
    expect(result.truncation.candidatePairsTruncated).toBe(true);
  });

  it("returns an empty, non-truncated result for no functions", () => {
    const result = generateCloneCandidates([]);
    expect(result.candidates).toEqual([]);
    expect(result.truncation).toEqual({
      eligibleFunctions: 0,
      consideredFunctions: 0,
      functionsTruncated: false,
      shingleTruncatedFunctions: 0,
      candidatePairsTruncated: false,
    });
  });

  it("drops functions below the size floors", () => {
    const result = generateCloneCandidates(functions, { minLines: 1_000, minTokens: 1_000 });
    expect(result.truncation.eligibleFunctions).toBe(0);
    expect(result.candidates).toEqual([]);
  });
});

function locationKey(ref: CloneCandidate["left"]): string {
  return `${ref.filePath}:${String(ref.startLine).padStart(8, "0")}`;
}
