import { describe, expect, it } from "vitest";

import {
  buildSeeds,
  buildShingles,
  computeSignature,
  DEFAULT_MINHASH_CONFIG,
  estimateSimilarity,
  findLshCandidatePairs,
  type MinHashDocument,
  resolveMinHashConfig,
} from "./minhash-lsh.js";

describe("buildShingles", () => {
  it("emits the set of overlapping k-grams", () => {
    expect(buildShingles(["a1", "b2", "c3", "d4"], 2)).toEqual(["a1|b2", "b2|c3", "c3|d4"]);
  });

  it("dedupes repeated shingles", () => {
    expect(buildShingles(["x", "x", "x", "x"], 2)).toEqual(["x|x"]);
  });

  it("falls back to a single whole-sequence shingle when shorter than k", () => {
    expect(buildShingles(["a", "b"], 3)).toEqual(["a|b"]);
  });

  it("returns nothing for an empty feature sequence", () => {
    expect(buildShingles([], 3)).toEqual([]);
  });

  it("treats a non-positive k as 1", () => {
    expect(buildShingles(["p", "q"], 0)).toEqual(["p", "q"]);
  });
});

describe("computeSignature", () => {
  const seeds = buildSeeds(8);

  it("is deterministic for the same shingles and seeds", () => {
    const shingles = ["aa", "bb", "cc"];
    expect(computeSignature(shingles, seeds)).toEqual(computeSignature(shingles, seeds));
  });

  it("is order-independent (min over a set)", () => {
    expect(computeSignature(["aa", "bb", "cc"], seeds)).toEqual(
      computeSignature(["cc", "aa", "bb"], seeds),
    );
  });

  it("has one entry per seed", () => {
    expect(computeSignature(["aa", "bb"], seeds)).toHaveLength(seeds.length);
  });

  it("differs for clearly different shingle sets", () => {
    const left = computeSignature(["aa", "bb", "cc"], seeds);
    const right = computeSignature(["xx", "yy", "zz"], seeds);
    expect(left).not.toEqual(right);
  });
});

describe("estimateSimilarity", () => {
  it("scores identical signatures as 1", () => {
    expect(estimateSimilarity([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
  });

  it("scores fully disjoint signatures as 0", () => {
    expect(estimateSimilarity([1, 2, 3, 4], [5, 6, 7, 8])).toBe(0);
  });

  it("scores the fraction of agreeing positions", () => {
    expect(estimateSimilarity([1, 2, 3, 4], [1, 2, 9, 9])).toBe(0.5);
  });

  it("returns 0 for mismatched or empty lengths", () => {
    expect(estimateSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(estimateSimilarity([], [])).toBe(0);
  });
});

describe("buildSeeds", () => {
  it("is deterministic and one seed per signature position", () => {
    expect(buildSeeds(16)).toEqual(buildSeeds(16));
    expect(buildSeeds(16)).toHaveLength(16);
  });

  it("produces distinct seeds", () => {
    const seeds = buildSeeds(32);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("resolveMinHashConfig", () => {
  it("defaults to DEFAULT_MINHASH_CONFIG with a derived signature length", () => {
    const config = resolveMinHashConfig();
    expect(config).toMatchObject(DEFAULT_MINHASH_CONFIG);
    expect(config.signatureLength).toBe(
      DEFAULT_MINHASH_CONFIG.bands * DEFAULT_MINHASH_CONFIG.rowsPerBand,
    );
  });

  it("derives signature length from bands * rowsPerBand", () => {
    expect(resolveMinHashConfig({ bands: 6, rowsPerBand: 3 }).signatureLength).toBe(18);
  });

  it("falls back to defaults for non-positive or non-integer overrides", () => {
    const config = resolveMinHashConfig({ bands: 0, rowsPerBand: -1, shingleSize: 2.5 });
    expect(config.bands).toBe(24);
    expect(config.rowsPerBand).toBe(4);
    expect(config.shingleSize).toBe(3);
  });
});

describe("findLshCandidatePairs", () => {
  const identical = (id: string): MinHashDocument => ({
    id,
    features: ["alpha", "beta", "gamma", "delta", "epsilon"],
  });

  it("pairs identical documents at estimated similarity 1", () => {
    const result = findLshCandidatePairs([identical("a.ts#one"), identical("a.ts#two")]);
    expect(result.candidates).toEqual([{ a: "a.ts#one", b: "a.ts#two", estimatedSimilarity: 1 }]);
    expect(result.candidatePairsTruncated).toBe(false);
  });

  it("emits no candidates when no documents share a band", () => {
    const result = findLshCandidatePairs([
      identical("a.ts#one"),
      { id: "b.ts#two", features: ["one", "two", "three", "four", "five"] },
    ]);
    expect(result.candidates).toEqual([]);
  });

  it("returns identical results across runs", () => {
    const docs = [identical("a.ts#one"), identical("a.ts#two"), identical("a.ts#three")];
    expect(findLshCandidatePairs(docs)).toEqual(findLshCandidatePairs(docs));
  });

  it("orders candidate ids and sorts by descending estimated similarity", () => {
    const docs = [
      identical("z.ts#last"),
      identical("a.ts#first"),
      { id: "m.ts#partial", features: ["alpha", "beta", "gamma", "delta", "zeta"] },
    ];
    const result = findLshCandidatePairs(docs);
    for (const pair of result.candidates) {
      expect(pair.a.localeCompare(pair.b, "en")).toBeLessThanOrEqual(0);
    }
    const sims = result.candidates.map((pair) => pair.estimatedSimilarity);
    expect([...sims].sort((left, right) => right - left)).toEqual(sims);
  });

  it("excludes empty-feature documents from banding but counts them in the total", () => {
    const result = findLshCandidatePairs([
      identical("a.ts#one"),
      identical("a.ts#two"),
      { id: "c.ts#empty", features: [] },
    ]);
    expect(result.totalDocuments).toBe(3);
    expect(result.consideredDocuments).toBe(2);
    expect(result.candidates).toHaveLength(1);
  });

  it("caps the candidate-pair count and flags the partial run", () => {
    const docs = ["one", "two", "three", "four"].map((name) => identical(`a.ts#${name}`));
    const result = findLshCandidatePairs(docs, { maxCandidatePairs: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidatePairsTruncated).toBe(true);
  });

  it("caps per-document shingles deterministically and still pairs the survivors", () => {
    const wide = (id: string): MinHashDocument => ({
      id,
      features: ["a", "b", "c", "d", "e", "f", "g"],
    });
    const result = findLshCandidatePairs([wide("a.ts#one"), wide("a.ts#two")], {
      maxShinglesPerDocument: 2,
    });
    expect(result.shingleTruncatedDocuments).toBe(2);
    expect(result.candidates).toHaveLength(1);
  });
});
