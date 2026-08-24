import { describe, expect, it } from "vitest";

import {
  hasWorkerCounts,
  isExactAudit,
  parseSampleCount,
  parseWorkerAudit,
} from "./benchmark-near-duplicates.js";

// Characterization tests (code-quality-2026-08-01 leaf 143): these pin the
// CURRENT command boundaries without spawning the expensive benchmark.
// Notable pinned quirks: samples must be positive odd integers, extra argv
// always yields usage, and worker shape/count failures use distinct messages.

const VALID_COUNTS = {
  functionCount: 10,
  tokenizedFunctionCount: 9,
  fuzzyPairs: 3,
  exactPairs: 2,
  unionPairs: 4,
  newBaselineIdentities: 1,
};

const VALID_EXACT_AUDIT = {
  eligibleFunctions: 9,
  hashBuckets: 7,
  maximumRawHashBucketSize: 3,
  maximumEqualityGroupSize: 2,
  projectedPairs: 4,
  postOverlapPairs: 2,
};

describe("parseSampleCount", () => {
  it("defaults to five samples and accepts an explicit positive odd count", () => {
    expect(parseSampleCount([])).toBe(5);
    expect(parseSampleCount(["--samples", "7"])).toBe(7);
  });

  it.each([
    { argv: ["--help"] },
    { argv: ["--samples"] },
    { argv: ["--samples=3"] },
    { argv: ["--samples", "3", "extra"] },
  ])("reports usage for unsupported argv $argv", ({ argv }) => {
    expect(() => parseSampleCount(argv)).toThrow(
      "usage: bun scripts/benchmark-near-duplicates.ts [--samples <positive odd integer>]",
    );
  });

  it.each(["0", "2", "-1", "1.5", "not-a-number"])(
    "rejects non-positive-odd sample count %s",
    (count) => {
      expect(() => parseSampleCount(["--samples", count])).toThrow(
        "--samples must be a positive odd integer",
      );
    },
  );
});

describe("parseWorkerAudit", () => {
  it("distinguishes an invalid worker envelope from invalid counts", () => {
    expect(() => parseWorkerAudit(JSON.stringify({ state: "unexpected" }))).toThrow(
      "benchmark worker returned invalid JSON",
    );
    expect(() => parseWorkerAudit(JSON.stringify({ state: "fuzzy", functionCount: 10 }))).toThrow(
      "benchmark worker returned invalid counts",
    );
  });

  it("returns valid counts and preserves a valid exact audit", () => {
    const raw = {
      state: "fuzzy-exact",
      ...VALID_COUNTS,
      exactAudit: VALID_EXACT_AUDIT,
    };

    expect(parseWorkerAudit(JSON.stringify(raw))).toEqual(raw);
  });
});

describe("worker audit guards", () => {
  it("accepts complete numeric worker counts and rejects incomplete counts", () => {
    expect(hasWorkerCounts(VALID_COUNTS)).toBe(true);
    expect(hasWorkerCounts({ ...VALID_COUNTS, exactPairs: "2" })).toBe(false);
  });

  it("accepts a complete numeric exact audit and rejects incomplete audit data", () => {
    expect(isExactAudit(VALID_EXACT_AUDIT)).toBe(true);
    expect(isExactAudit({ ...VALID_EXACT_AUDIT, projectedPairs: undefined })).toBe(false);
  });
});
