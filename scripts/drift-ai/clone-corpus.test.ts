import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectCloneCorpusPairs,
  evaluateCloneCorpus,
  extractCloneCorpusFunctions,
  loadCloneCorpusLabels,
} from "./clone-corpus.js";
import { DriftAiError } from "./errors.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function writeLabels(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "clone-corpus-labels-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "labels.json"), contents);
  return dir;
}

describe("loadCloneCorpusLabels", () => {
  it("parses the shipped corpus labels into the expected clone families", () => {
    const labels = loadCloneCorpusLabels();
    expect(labels.version).toBe(1);
    expect(labels.clonePairs.map((pair) => pair.category)).toEqual([
      "exact",
      "renamed",
      "reordered",
      "extracted-helper",
      "semantic",
    ]);
    expect(labels.nonPairs.map((pair) => pair.category)).toEqual(["unrelated", "near-miss"]);
  });

  it("rejects labels that are not a JSON object", () => {
    const dir = writeLabels("[]");
    expect(() => loadCloneCorpusLabels(dir)).toThrow(DriftAiError);
  });

  it("rejects a pair missing a required field", () => {
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        clonePairs: [{ a: "f.ts#one", b: "f.ts#two" }],
        nonPairs: [],
      }),
    );
    expect(() => loadCloneCorpusLabels(dir)).toThrow(/clonePairs\[0\]\.category/u);
  });

  it("rejects a pair that references the same function twice", () => {
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        clonePairs: [{ a: "f.ts#one", b: "f.ts#one", category: "exact" }],
        nonPairs: [],
      }),
    );
    expect(() => loadCloneCorpusLabels(dir)).toThrow(DriftAiError);
  });

  it("rejects the same pair labeled both a clone and a non-clone", () => {
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        // Same pair, sides swapped — pairKey canonicalization still catches it.
        clonePairs: [{ a: "f.ts#one", b: "f.ts#two", category: "exact" }],
        nonPairs: [{ a: "f.ts#two", b: "f.ts#one", category: "unrelated" }],
      }),
    );
    expect(() => loadCloneCorpusLabels(dir)).toThrow(/more than once/u);
  });
});

describe("clone corpus contents", () => {
  it("extracts every labeled function from the corpus sources", () => {
    const functions = extractCloneCorpusFunctions();
    const labels = loadCloneCorpusLabels();
    const known = new Set(functions.map((fn) => fn.id));
    const referenced = [...labels.clonePairs, ...labels.nonPairs].flatMap((pair) => [
      pair.a,
      pair.b,
    ]);
    for (const ref of referenced) expect(known).toContain(ref);
  });

  it("keeps every labeled-pair function at or above the engine size floors", () => {
    const functions = extractCloneCorpusFunctions();
    const labels = loadCloneCorpusLabels();
    const labeled = new Set(
      [...labels.clonePairs, ...labels.nonPairs].flatMap((pair) => [pair.a, pair.b]),
    );
    for (const fn of functions.filter((candidate) => labeled.has(candidate.id))) {
      // Default near-duplicate floors: minLines 8, minTokens 45. A labeled pair
      // that fell below them would be skipped for reasons unrelated to clone
      // structure, muddying the baseline.
      expect(fn.lineCount, fn.id).toBeGreaterThanOrEqual(8);
      expect(fn.tokenCount, fn.id).toBeGreaterThanOrEqual(45);
    }
  });
});

describe("detectCloneCorpusPairs", () => {
  it("maps each detected side back to a `<path>#<name>` id", () => {
    const pairs = detectCloneCorpusPairs();
    for (const pair of pairs) {
      expect(pair.a).toMatch(/^[\w./-]+#[\w<>]+$/u);
      expect(pair.b).toMatch(/^[\w./-]+#[\w<>]+$/u);
      expect(pair.a.localeCompare(pair.b, "en")).toBeLessThanOrEqual(0);
    }
  });
});

describe("evaluateCloneCorpus baseline", () => {
  // This is a RECORDED baseline for the current in-process ts-morph engine, not a
  // quality target. The labels are engine-agnostic ground truth; if the engine
  // changes (or the corpus grows), update these expectations deliberately so the
  // shift is visible in review.
  it("recovers exact/renamed/reordered clones and misses extracted-helper/semantic", () => {
    const evaluation = evaluateCloneCorpus();
    expect(evaluation.unknownFunctionRefs).toEqual([]);
    expect(evaluation.counts).toEqual({
      clonePairs: 5,
      nonPairs: 2,
      truePositives: 3,
      falseNegatives: 2,
      falsePositives: 0,
    });
    expect(evaluation.precision).toBe(1);
    expect(evaluation.recall).toBe(0.6);
    expect(evaluation.recallByCategory).toEqual({
      exact: { detected: 1, total: 1 },
      renamed: { detected: 1, total: 1 },
      reordered: { detected: 1, total: 1 },
      "extracted-helper": { detected: 0, total: 1 },
      semantic: { detected: 0, total: 1 },
    });
  });

  it("flags no false positives, including the labeled non-pair traps", () => {
    const evaluation = evaluateCloneCorpus();
    expect(evaluation.falsePositives).toEqual([]);
    expect(evaluation.flaggedNonPairs).toEqual([]);
    expect(evaluation.unexpectedPairs).toEqual([]);
  });

  it("ranks the recovered structural clones above the engine similarity threshold", () => {
    const evaluation = evaluateCloneCorpus();
    expect(evaluation.detected).toHaveLength(3);
    for (const pair of evaluation.detected) {
      expect(pair.similarity).toBeGreaterThanOrEqual(0.85);
    }
    const exact = evaluation.detected.find((pair) => pair.a.startsWith("exact-clones.ts#"));
    expect(exact?.similarity).toBe(1);
  });
});
