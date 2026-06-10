import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  evaluateDolosCloneCorpusCandidates,
  parseDolosCsvReport,
  parseDolosVersionOutput,
} from "./dolos-output.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function parseFixtureReport() {
  return parseDolosCsvReport({
    filesCsv: readFixture("dolos-report/files.csv"),
    metadataCsv: readFixture("dolos-report/metadata.csv"),
    pairsCsv: readFixture("dolos-report/pairs.csv"),
  });
}

describe("parseDolosVersionOutput", () => {
  it("extracts the CLI semantic version when Dolos prints companion runtime versions", () => {
    expect(parseDolosVersionOutput("Dolos 2.9.3\nNode.js v20.12.2\nTree-sitter 0.22.6\n")).toBe(
      "2.9.3",
    );
  });

  it("returns undefined when the version banner is not recognizable", () => {
    expect(parseDolosVersionOutput("unknown tool\n")).toBeUndefined();
  });
});

describe("parseDolosCsvReport", () => {
  it("parses CSV report files into sorted Dolos candidates with full-file ranges", () => {
    const parsed = parseFixtureReport();

    expect(parsed.metadata).toEqual({
      engine: "dolos",
      languageMode: "typescript",
      threshold: 0.3,
    });
    expect(parsed.candidates.map((candidate) => candidate.score)).toEqual([0.98, 0.42]);
    expect(parsed.candidates[0]?.left).toEqual({
      filePath: "exact-clones.ts#sumDiagonalGrid",
      startLine: 1,
      endLine: 3,
      lineCount: 3,
    });
    expect(parsed.candidates[0]?.metrics).toEqual({
      similarity: 0.98,
      totalOverlap: 120,
      longestFragment: 60,
      leftCovered: 0.98,
      rightCovered: 0.96,
    });
    expect(parsed.truncation).toEqual({
      parsedPairs: 3,
      candidatePairsTruncated: false,
      reportedPairsTruncated: false,
      missingFileRanges: [],
    });
  });

  it("honors parser-level candidate and reported-pair caps without losing disclosure", () => {
    const parsed = parseDolosCsvReport(
      {
        filesCsv: readFixture("dolos-report/files.csv"),
        metadataCsv: readFixture("dolos-report/metadata.csv"),
        pairsCsv: readFixture("dolos-report/pairs.csv"),
      },
      {
        maxCandidatePairs: 2,
        maxReportedPairs: 1,
        threshold: 0,
      },
    );

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.truncation).toMatchObject({
      parsedPairs: 3,
      candidatePairsTruncated: true,
      reportedPairsTruncated: true,
    });
  });
});

describe("evaluateDolosCloneCorpusCandidates", () => {
  it("scores parsed fixture rows against the clone corpus labels", () => {
    const evaluation = evaluateDolosCloneCorpusCandidates(parseFixtureReport().candidates);

    expect(evaluation.counts).toEqual({
      clonePairs: 5,
      nonPairs: 2,
      truePositives: 1,
      falseNegatives: 4,
      falsePositives: 1,
    });
    expect(evaluation.precision).toBe(0.5);
    expect(evaluation.recall).toBe(0.2);
    expect(evaluation.flaggedNonPairs).toEqual([
      "near-miss-distances.ts#chebyshevDistance <=> near-miss-distances.ts#manhattanDistance",
    ]);
    expect(evaluation.recallByCategory.exact).toEqual({ detected: 1, total: 1 });
  });
});
