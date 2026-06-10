import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deadCodeCorpusSymbolId,
  extractDeadCodeCorpusSymbols,
  findDeadCodeCorpusLabel,
  loadDeadCodeCorpusLabels,
  validateDeadCodeCorpusLabels,
} from "./dead-code-corpus.js";
import { DriftAiError } from "./errors.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function writeLabels(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dead-code-corpus-labels-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "labels.json"), contents);
  return dir;
}

function writeTempCorpus(labels: unknown, files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dead-code-corpus-"));
  tempDirs.push(dir);
  writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labels));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
  return dir;
}

describe("loadDeadCodeCorpusLabels", () => {
  it("parses the shipped labels into trap, candidate, and known-unused groups", () => {
    const labels = loadDeadCodeCorpusLabels();
    expect(labels.version).toBe(1);
    expect(labels.labels.map((label) => label.kind)).toEqual([
      "true-trap",
      "true-trap",
      "true-trap",
      "true-trap",
      "candidate",
      "true-trap",
      "true-trap",
      "true-trap",
      "true-trap",
      "true-trap",
      "known-unused",
      "known-unused",
      "known-unused",
    ]);
    expect(new Set(labels.labels.map((label) => label.reason))).toEqual(
      new Set([
        "barrel-reexport-transitivity",
        "dynamic-import-only",
        "framework-entrypoint-convention",
        "reflection-string-keyed-access",
        "test-only-usage",
        "tombstoned-unused",
      ]),
    );
  });

  it("rejects labels that are not a JSON object", () => {
    const dir = writeLabels("[]");
    expect(() => loadDeadCodeCorpusLabels(dir)).toThrow(DriftAiError);
  });

  it("rejects a label with an unknown kind", () => {
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        labels: [
          {
            id: "fixture.ts#usedViaMagic",
            path: "fixture.ts",
            symbol: "usedViaMagic",
            kind: "maybe-live",
            reason: "x",
            evidence: [],
          },
        ],
      }),
    );
    expect(() => loadDeadCodeCorpusLabels(dir)).toThrow(/labels\[0\]\.kind/u);
  });

  it("rejects a label id that does not match its path and symbol", () => {
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        labels: [
          {
            id: "other.ts#usedViaMagic",
            path: "fixture.ts",
            symbol: "usedViaMagic",
            kind: "true-trap",
            reason: "x",
            evidence: [],
          },
        ],
      }),
    );
    expect(() => loadDeadCodeCorpusLabels(dir)).toThrow(/must equal 'fixture\.ts#usedViaMagic'/u);
  });

  it("rejects duplicate labels", () => {
    const label = {
      id: "fixture.ts#usedViaMagic",
      path: "fixture.ts",
      symbol: "usedViaMagic",
      kind: "true-trap",
      reason: "x",
      evidence: [],
    };
    const dir = writeLabels(
      JSON.stringify({
        version: 1,
        description: "x",
        labels: [label, label],
      }),
    );
    expect(() => loadDeadCodeCorpusLabels(dir)).toThrow(/more than once/u);
  });
});

describe("extractDeadCodeCorpusSymbols", () => {
  it("extracts named exports, default exports, variables, and re-exported names", () => {
    const symbols = extractDeadCodeCorpusSymbols();
    const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    expect(byId.get("barrel/encounter-format.ts#formatEncounterSummary")?.exportKind).toBe(
      "function",
    );
    expect(byId.get("barrel/public-api.ts#formatEncounterSummary")?.exportKind).toBe("re-export");
    expect(byId.get("framework/routes/campaign-route.tsx#default")?.exportKind).toBe("default");
    expect(byId.get("tombstones/obsolete-rules.ts#staleEncounterFlag")?.exportKind).toBe("const");
  });
});

describe("validateDeadCodeCorpusLabels", () => {
  it("resolves every shipped label to an exported fixture symbol", () => {
    const validation = validateDeadCodeCorpusLabels();
    expect(validation.unknownSymbolRefs).toEqual([]);
  });

  it("reports labels whose symbol no longer exists in the corpus source", () => {
    const dir = writeTempCorpus(
      {
        version: 1,
        description: "x",
        labels: [
          {
            id: "fixture.ts#missing",
            path: "fixture.ts",
            symbol: "missing",
            kind: "true-trap",
            reason: "x",
            evidence: [],
          },
        ],
      },
      { "fixture.ts": "export function present(): void {}\n" },
    );
    expect(validateDeadCodeCorpusLabels(dir).unknownSymbolRefs).toEqual(["fixture.ts#missing"]);
  });
});

describe("dead-code corpus downstream label lookup", () => {
  it("makes dynamic-import and barrel trap labels available by file and symbol", () => {
    const labels = loadDeadCodeCorpusLabels();
    expect(
      findDeadCodeCorpusLabel(labels, {
        filePath: "dynamic/lazy-feature.ts",
        symbol: "buildLazyEncounter",
      }),
    ).toMatchObject({ kind: "true-trap", reason: "dynamic-import-only" });
    expect(
      findDeadCodeCorpusLabel(labels, {
        filePath: "barrel/encounter-format.ts",
        symbol: "formatEncounterSummary",
      }),
    ).toMatchObject({ kind: "true-trap", reason: "barrel-reexport-transitivity" });
  });

  it("normalizes symbol ids for candidate matching", () => {
    expect(deadCodeCorpusSymbolId("barrel\\encounter-format.ts", "formatEncounterSummary")).toBe(
      "barrel/encounter-format.ts#formatEncounterSummary",
    );
  });

  it("labels convention and reflection exports that are live through fixture traps", () => {
    const labels = loadDeadCodeCorpusLabels();
    expect(
      findDeadCodeCorpusLabel(labels, {
        filePath: "framework/routes/campaign-route.tsx",
        symbol: "handle",
      }),
    ).toMatchObject({ kind: "true-trap", reason: "framework-entrypoint-convention" });
    expect(
      findDeadCodeCorpusLabel(labels, {
        filePath: "reflection/actions.ts",
        symbol: "stabilizeDyingAlly",
      }),
    ).toMatchObject({ kind: "true-trap", reason: "reflection-string-keyed-access" });
  });
});
