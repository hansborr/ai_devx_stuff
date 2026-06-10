import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildDolosAdvisory,
  formatDolosAdvisoryJson,
  formatDolosAdvisoryText,
} from "./dolos-advisory.js";
import { evaluateDolosCloneCorpusCandidates, parseDolosCsvReport } from "./dolos-output.js";
import type { DolosRunnerCaps, DolosRunnerResult } from "./dolos-runner.js";
import type { DolosCandidatePair } from "./dolos-types.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const CAPS: DolosRunnerCaps = {
  timeoutMs: 600_000,
  maxFiles: 2000,
  maxCandidatePairs: 50_000,
  maxReportedPairs: 200,
};

function candidate(overrides: Partial<DolosCandidatePair> = {}): DolosCandidatePair {
  return {
    engine: "dolos",
    engineVersion: "2.9.3",
    languageMode: "typescript",
    threshold: 0.3,
    score: 0.92,
    left: { filePath: "src/a.ts", startLine: 1, endLine: 20, lineCount: 20 },
    right: { filePath: "src/b.ts", startLine: 1, endLine: 22, lineCount: 22 },
    metrics: {
      similarity: 0.92,
      totalOverlap: 120,
      longestFragment: 60,
      leftCovered: 0.9,
      rightCovered: 0.88,
    },
    ...overrides,
  };
}

function okResult(
  candidates: readonly DolosCandidatePair[],
  truncation?: Partial<DolosRunnerResult & { ok: true }>,
): DolosRunnerResult {
  return {
    ok: true,
    tool: { command: "dolos", source: "path", version: "2.9.3" },
    metadata: {
      engine: "dolos",
      engineVersion: "2.9.3",
      languageMode: "typescript",
      threshold: 0.3,
    },
    candidates,
    caps: CAPS,
    truncation: {
      parsedPairs: candidates.length,
      candidatePairsTruncated: false,
      reportedPairsTruncated: false,
      missingFileRanges: [],
      eligibleFiles: candidates.length + 1,
      consideredFiles: candidates.length + 1,
      filesTruncated: false,
    },
    ...truncation,
  };
}

describe("buildDolosAdvisory", () => {
  it("wraps populated Dolos rows in the prototype advisory contract", () => {
    const advisory = buildDolosAdvisory(
      okResult([
        candidate(),
        candidate({
          score: 0.5,
          left: { filePath: "src/c.ts", startLine: 1, endLine: 8, lineCount: 8 },
        }),
      ]),
      { top: 5 },
    );
    const section = advisory.sections[0];

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("dolos-candidates");
    expect("findings" in advisory).toBe(false);
    expect(section?.candidateKind).toBe("Dolos fragment-level clone candidates");
    expect(section?.totalCandidates).toBe(2);
    expect(section?.entries).toHaveLength(2);
    expect(section?.entries[0]).toMatchObject({
      rank: 1,
      candidateSource: "dolos",
      engineVersion: "2.9.3",
      languageMode: "typescript",
      score: 0.92,
      threshold: 0.3,
    });
  });

  it("renders engine/version, language, score-vs-threshold, fragment metrics, and provenance", () => {
    const text = formatDolosAdvisoryText(buildDolosAdvisory(okResult([candidate()])));

    expect(text).toContain("drift:ai dolos-candidates (advisory, prototype lane)");
    expect(text).toContain("prerequisite dolos engine: ok -- dolos@2.9.3 ('dolos' on PATH)");
    expect(text).toContain("cap files: within limit 2000");
    expect(text).toContain("cap wall-clock (ms): within limit 600000");
    expect(text).toContain("#1 src/a.ts:1-20 <=> src/b.ts:1-22");
    expect(text).toContain(
      "source dolos@2.9.3 (typescript): similarity 92.0% >= threshold 30.0%; overlap 120 tokens, longest fragment 60, coverage L 90.0% / R 88.0%",
    );
    expect(text).toContain("inspect: review the shared fragment before extracting common code.");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("explains an empty run without pretending the repo was clear", () => {
    const advisory = buildDolosAdvisory(okResult([]));

    expect(advisory.sections[0]).toMatchObject({
      totalCandidates: 0,
      entries: [],
      emptyReason: "no Dolos pairs reached the 30.0% similarity threshold.",
    });
    expect(advisory.prerequisites[0]).toMatchObject({ name: "dolos engine", satisfied: true });
  });

  it("reports a missing Dolos binary as an unmet prerequisite, not a failure", () => {
    const advisory = buildDolosAdvisory({
      ok: false,
      reason: "tool-unavailable",
      error: "spawn dolos ENOENT",
      tool: { command: "dolos", source: "path" },
      caps: CAPS,
      truncation: { consideredFiles: 0, eligibleFiles: 4, filesTruncated: false },
    });
    const text = formatDolosAdvisoryText(advisory);

    expect(advisory.prerequisites[0]).toMatchObject({ name: "dolos engine", satisfied: false });
    expect(advisory.degradations).toEqual([]);
    expect(text).toContain(
      "prerequisite dolos engine: unmet -- dolos ('dolos' on PATH) unavailable: spawn dolos ENOENT",
    );
    expect(advisory.sections[0]?.emptyReason).toBe(
      "Dolos produced no candidate pairs (run tool-unavailable).",
    );
  });

  it("discloses a timed-out run as a HIT wall-clock cap while keeping the binary present", () => {
    const timedOut = buildDolosAdvisory({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
      tool: { command: "/opt/dolos", source: "override", version: "2.9.3" },
      caps: { ...CAPS, timeoutMs: 1234 },
      truncation: { consideredFiles: 6, eligibleFiles: 6, filesTruncated: false },
    });

    expect(timedOut.prerequisites[0]).toMatchObject({ name: "dolos engine", satisfied: true });
    expect(timedOut.degradations).toEqual([]);
    expect(formatDolosAdvisoryText(timedOut)).toContain(
      "cap wall-clock (ms): HIT -- PARTIAL run: Dolos run stopped at the 1234ms wall-clock cap",
    );
  });

  it("discloses a failed run as a degradation while keeping the binary present", () => {
    const failed = buildDolosAdvisory({
      ok: false,
      reason: "run-failed",
      error: "dolos exited 2: language not supported",
      tool: { command: "dolos", source: "path", version: "2.9.3" },
      caps: CAPS,
      truncation: { consideredFiles: 4, eligibleFiles: 4, filesTruncated: false },
    });

    expect(failed.prerequisites[0]).toMatchObject({ name: "dolos engine", satisfied: true });
    expect(failed.degradations).toEqual([
      "Dolos run failed before producing a report: dolos exited 2: language not supported",
    ]);
    expect(failed.caps.find((cap) => cap.label === "wall-clock (ms)")?.hit).toBe(false);
    expect(failed.sections[0]?.emptyReason).toBe(
      "Dolos produced no candidate pairs (run run-failed).",
    );
  });

  it("discloses file, candidate-pair, reported-pair, and display caps on a partial run", () => {
    const advisory = buildDolosAdvisory(
      okResult(
        [
          candidate(),
          candidate({
            score: 0.4,
            left: { filePath: "src/c.ts", startLine: 1, endLine: 9, lineCount: 9 },
          }),
        ],
        {
          truncation: {
            parsedPairs: 60123,
            candidatePairsTruncated: true,
            reportedPairsTruncated: true,
            missingFileRanges: [],
            eligibleFiles: 5000,
            consideredFiles: 2000,
            filesTruncated: true,
          },
        },
      ),
      { top: 1 },
    );
    const text = formatDolosAdvisoryText(advisory);

    expect(text).toContain("cap files: HIT -- PARTIAL run: considered 2000 of 5000 eligible files");
    expect(text).toContain(
      "cap candidate pairs: HIT -- PARTIAL run: capped to 50000 candidate pairs (parsed 60123 raw pairs)",
    );
    expect(text).toContain(
      "cap reported pairs: HIT -- PARTIAL run: stopped after 2 reported candidate pairs",
    );
    expect(text).toContain("showing 1 of 2 candidates (1 more; raise --top to see them)");
  });

  it("discloses files whose line-count source was missing as a degradation", () => {
    const advisory = buildDolosAdvisory(
      okResult([candidate()], {
        truncation: {
          parsedPairs: 1,
          candidatePairsTruncated: false,
          reportedPairsTruncated: false,
          missingFileRanges: ["src/a.ts"],
          eligibleFiles: 2,
          consideredFiles: 2,
          filesTruncated: false,
        },
      }),
    );

    expect(advisory.degradations).toEqual([
      "1 file path had no line-count source; their ranges are shown as full-file 1-1: src/a.ts",
    ]);
  });

  it("never emits a top-level findings key in JSON", () => {
    const json = JSON.parse(
      formatDolosAdvisoryJson(buildDolosAdvisory(okResult([candidate()]))),
    ) as Record<string, unknown>;
    expect("findings" in json).toBe(false);
    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
  });

  it("keeps the rendered clone-corpus baseline aligned with the measured evaluator", () => {
    // Representative Dolos output mapped onto clone-corpus function ids (see
    // fixtures/dolos-report). This records the first Dolos advisory baseline so a
    // future engine/parser change that shifts precision/recall trips this test.
    const parsed = parseDolosCsvReport(
      {
        filesCsv: readFixture("dolos-report/files.csv"),
        metadataCsv: readFixture("dolos-report/metadata.csv"),
        pairsCsv: readFixture("dolos-report/pairs.csv"),
      },
      { engineVersion: "2.9.3" },
    );
    const evaluation = evaluateDolosCloneCorpusCandidates(parsed.candidates);
    const advisory = buildDolosAdvisory(okResult(parsed.candidates), { top: 10 });
    const rendered = formatDolosAdvisoryText(advisory);

    expect(evaluation.precision).toBe(0.5);
    expect(evaluation.recall).toBe(0.2);
    expect(advisory.sections[0]?.totalCandidates).toBe(2);
    expect(rendered).toContain(
      "#1 exact-clones.ts#sumDiagonalGrid:1-3 <=> exact-clones.ts#sumDiagonalMatrix:1-3",
    );
    expect(rendered).toContain(
      "source dolos@2.9.3 (typescript): similarity 98.0% >= threshold 30.0%",
    );
    expect(rendered).toContain(
      "#2 near-miss-distances.ts#manhattanDistance:1-3 <=> near-miss-distances.ts#chebyshevDistance:1-3",
    );
  });
});
