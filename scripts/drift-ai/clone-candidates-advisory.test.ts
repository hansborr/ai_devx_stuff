import { describe, expect, it } from "vitest";

import { evaluateCloneCorpusCandidates, generateCloneCandidates } from "./clone-candidates.js";
import {
  buildCloneCandidateAdvisory,
  formatCloneCandidateAdvisoryText,
} from "./clone-candidates-advisory.js";
import { extractCloneCorpusNearDuplicateFunctions } from "./clone-corpus.js";
import type { NearDuplicateFunction } from "./near-duplicates.js";

describe("buildCloneCandidateAdvisory", () => {
  const functions = extractCloneCorpusNearDuplicateFunctions();

  it("wraps MinHash shortlist rows in the prototype advisory contract", () => {
    const advisory = buildCloneCandidateAdvisory({ functions, top: 3 });
    const section = advisory.sections[0];

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("clone-candidates");
    expect("findings" in advisory).toBe(false);
    expect(section?.candidateKind).toBe("MinHash/LSH function clone candidates");
    expect(section?.totalCandidates).toBe(4);
    expect(section?.entries).toHaveLength(3);
    expect(section?.entries[0]).toMatchObject({
      candidateSource: "minhash-lsh",
      comparator: "ts-morph",
      comparatorAgreed: true,
      left: { filePath: "exact-clones.ts", name: "sumDiagonalGrid" },
      right: { filePath: "exact-clones.ts", name: "sumDiagonalMatrix" },
      estimatedSimilarity: 1,
      comparatorSimilarity: 1,
      threshold: 0.85,
    });
  });

  it("renders caps, display truncation, provenance, scores, and engine agreement", () => {
    const text = formatCloneCandidateAdvisoryText(
      buildCloneCandidateAdvisory({ functions, top: 2 }),
    );

    expect(text).toContain("drift:ai clone-candidates (advisory, prototype lane)");
    expect(text).toContain("cap functions: within limit 5000");
    expect(text).toContain("cap shingles per function: within limit 4096");
    expect(text).toContain("cap candidate pairs: within limit 50000");
    expect(text).toContain("showing 2 of 4 candidates (2 more; raise --top to see them)");
    expect(text).toContain(
      "#1 exact-clones.ts:8-19 sumDiagonalGrid <=> exact-clones.ts:21-32 sumDiagonalMatrix",
    );
    expect(text).toContain("source minhash-lsh: estimate 100.0%");
    expect(text).toContain("comparator ts-morph: agreed yes; similarity 100.0% >= threshold 85.0%");
    expect(text).toContain("inspect: compare both functions before extracting shared flow.");
  });

  it("surfaces the corpus false positive as a candidate the comparator rejects", () => {
    const advisory = buildCloneCandidateAdvisory({ functions, top: 10 });
    const rows = advisory.sections[0]?.entries ?? [];
    const nearMiss = rows.find((row) => row.right.name === "chebyshevDistance");

    expect(nearMiss).toMatchObject({
      left: { name: "manhattanDistance" },
      comparatorAgreed: false,
      threshold: 0.85,
    });
    expect(nearMiss?.comparatorSimilarity).toBeGreaterThan(0.85);
  });

  it("overlays sibling naming evidence on existing clone-candidate rows only", () => {
    const advisory = buildCloneCandidateAdvisory({
      functions: [
        fakeFunction("src/encounter-rules.ts", "resolveEncounterRules"),
        fakeFunction("src/encounter-rules-legacy.ts", "resolveLegacyEncounterRules"),
      ],
      top: 5,
    });
    const row = advisory.sections[0]?.entries[0];

    expect(row?.siblingNaming).toMatchObject({
      leftPath: "src/encounter-rules-legacy.ts",
      rightPath: "src/encounter-rules.ts",
      sharedTokens: ["encounter", "rules"],
      relation: "plain-vs-marked",
      namingPattern: "plain-vs-marked (left legacy/lifecycle/suffix)",
      leftMarkers: [{ token: "legacy", kind: "lifecycle", position: "suffix" }],
      rightMarkers: [],
      supportingEvidence: [
        {
          source: "near-duplicate-row",
          candidateSource: "minhash-lsh",
          comparator: "ts-morph",
          comparatorAgreed: true,
          estimatedSimilarity: 1,
          comparatorSimilarity: 1,
          threshold: 0.85,
        },
      ],
    });
    expect(row?.siblingNaming?.caveats.join("\n")).toContain("never as proof");
    expect(formatCloneCandidateAdvisoryText(advisory)).toContain(
      "sibling naming overlay: src/encounter-rules-legacy.ts <=> src/encounter-rules.ts; pattern plain-vs-marked (left legacy/lifecycle/suffix); shared tokens encounter, rules",
    );
  });

  it("does not create sibling rows without clone-candidate evidence", () => {
    const advisory = buildCloneCandidateAdvisory({
      functions: [
        fakeFunction("src/initiative.ts", "rollInitiative", ["call:a", "return:a"]),
        fakeFunction("src/initiative-old.ts", "rollOldInitiative", ["call:b", "return:b"]),
      ],
      top: 5,
    });

    expect(advisory.sections[0]).toMatchObject({
      totalCandidates: 0,
      entries: [],
    });
  });

  it("honors ghost-files-style allowed pairs while keeping the clone row", () => {
    const advisory = buildCloneCandidateAdvisory({
      functions: [
        fakeFunction("src/loot-table.ts", "rollLootTable"),
        fakeFunction("src/loot-table-v2.ts", "rollLootTableV2"),
      ],
      siblingAllowedPairs: [{ files: ["src/loot-table-v2.ts", "src/loot-table.ts"] }],
      top: 5,
    });
    const row = advisory.sections[0]?.entries[0];

    expect(row).toBeDefined();
    expect(row?.siblingNaming).toBeUndefined();
  });

  it("preserves dead-code trap caveats as risky context labels", () => {
    const advisory = buildCloneCandidateAdvisory({
      functions: [
        fakeFunction("scripts/drift-ai/fixtures/dead-code-corpus/dynamic/lazy-feature.ts", "a"),
        fakeFunction(
          "scripts/drift-ai/fixtures/dead-code-corpus/dynamic/lazy-feature-legacy.ts",
          "b",
        ),
        fakeFunction("scripts/drift-ai/fixtures/dead-code-corpus/barrel/public-api.ts", "c"),
        fakeFunction("scripts/drift-ai/fixtures/dead-code-corpus/barrel/public-api-legacy.ts", "d"),
        fakeFunction("scripts/drift-ai/fixtures/dead-code-corpus/test-only/factory.test.ts", "e"),
        fakeFunction(
          "scripts/drift-ai/fixtures/dead-code-corpus/test-only/factory-legacy.test.ts",
          "f",
        ),
      ],
      siblingCaveatLabeler: (filePath) =>
        filePath.includes("/dynamic/")
          ? ["risky-context: dynamic-import-only (dead-code FP trap corpus)"]
          : [],
      top: 20,
    });
    const caveats = (advisory.sections[0]?.entries ?? []).flatMap(
      (row) => row.siblingNaming?.caveats ?? [],
    );

    expect(caveats).toContain("risky-context: dynamic-import-only (dead-code FP trap corpus)");
    expect(caveats).toContain(
      "risky-context: public-api (scripts/drift-ai/fixtures/dead-code-corpus/barrel/public-api.ts)",
    );
    expect(caveats).toContain(
      "risky-context: test-only (scripts/drift-ai/fixtures/dead-code-corpus/test-only/factory-legacy.test.ts)",
    );
  });

  it("discloses partial scan caps from the MinHash candidate generator", () => {
    const functionCapped = buildCloneCandidateAdvisory({ functions, maxFunctions: 4 });
    expect(functionCapped.caps[0]).toEqual({
      label: "functions",
      limit: 4,
      hit: true,
      detail: "considered 4 of 15 eligible functions",
    });

    const pairCapped = buildCloneCandidateAdvisory({
      functions,
      minhash: { maxCandidatePairs: 1 },
    });
    expect(pairCapped.caps[2]).toEqual({
      label: "candidate pairs",
      limit: 1,
      hit: true,
      detail: "stopped after 1 emitted MinHash/LSH candidate pair",
    });
  });

  it("explains a no-candidate run without pretending the repo was clear", () => {
    const advisory = buildCloneCandidateAdvisory({
      functions,
      minLines: 1_000,
      minTokens: 1_000,
    });

    expect(advisory.sections[0]).toMatchObject({
      totalCandidates: 0,
      entries: [],
      emptyReason:
        "no MinHash/LSH candidate pairs passed the current size floors and banding config.",
    });
  });

  it("keeps the rendered clone-corpus baseline aligned with the measured evaluator", () => {
    const evaluation = evaluateCloneCorpusCandidates();
    const advisory = buildCloneCandidateAdvisory({ functions, top: 10 });
    const rendered = formatCloneCandidateAdvisoryText(advisory);

    expect(evaluation.precision).toBe(0.75);
    expect(evaluation.recall).toBe(0.6);
    expect(generateCloneCandidates(functions).candidates).toHaveLength(
      advisory.sections[0]?.totalCandidates ?? -1,
    );
    expect(rendered).toContain(
      "#4 near-miss-distances.ts:10-19 manhattanDistance <=> near-miss-distances.ts:21-30 chebyshevDistance",
    );
    expect(rendered).toContain("comparator ts-morph: agreed no;");
  });
});

function fakeFunction(
  filePath: string,
  name: string,
  features: readonly string[] = sharedFeatures(),
): NearDuplicateFunction {
  return {
    filePath,
    name,
    enclosingContext: "",
    startOffset: 0,
    endOffset: 100,
    startLine: 1,
    endLine: 12,
    lineCount: 12,
    tokenCount: Math.max(50, features.length),
    features,
    statementFeatures: ["return", "call"],
    exactTokens: [],
  };
}

function sharedFeatures(): string[] {
  return Array.from({ length: 60 }, (_, index) => `feature:${String(index)}`);
}
