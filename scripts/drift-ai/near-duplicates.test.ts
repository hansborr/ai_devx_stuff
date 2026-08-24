import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatNearDuplicatesBaseline, runNearDuplicatesCli } from "../sensor-near-duplicates.js";
import { readNearDuplicatesBaseline } from "../sensor-near-duplicates-baseline.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import {
  buildNearDuplicateFindings,
  compareNearDuplicateFunctions,
  extractNearDuplicateFunctions,
  findNearDuplicatePairs,
  NEAR_DUPLICATE_TOOL,
  type NearDuplicateFunction,
} from "./near-duplicates.js";
import { nearDuplicatesCheck } from "./near-duplicates-check.js";
import {
  defaultNearDuplicateRunner,
  type NearDuplicateRunner,
  type SimilarityTsSpawn,
  type SimilarityTsSpawnResult,
} from "./near-duplicates-runner.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile, FindingProvenance } from "./types.js";

const PROVENANCE: FindingProvenance = {
  configSource: "drift-baseline",
  tool: NEAR_DUPLICATE_TOOL,
};

const tmpRepo = registerTempRootCleanup();

const writeRepo = (files: Record<string, string>): string =>
  tmpRepo.writeRepo(files, "drift-near-dupes-");

function changedScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

const RENAMED_VARIABLES = `
type Line = { active: boolean; priceCents: number; quantity: number };

export function totalForOrder(lines: readonly Line[]): number {
  let subtotal = 0;
  for (const line of lines) {
    if (!line.active) {
      continue;
    }
    const lineTotal = line.priceCents * line.quantity;
    subtotal += lineTotal;
  }
  const discount = subtotal > 10_000 ? Math.round(subtotal * 0.1) : 0;
  const tax = Math.round((subtotal - discount) * 0.0825);
  return subtotal - discount + tax;
}

export function totalForBasket(entries: readonly Line[]): number {
  let running = 0;
  for (const entry of entries) {
    if (!entry.active) {
      continue;
    }
    const entryTotal = entry.priceCents * entry.quantity;
    running += entryTotal;
  }
  const rebate = running > 10_000 ? Math.round(running * 0.1) : 0;
  const taxes = Math.round((running - rebate) * 0.0825);
  return running - rebate + taxes;
}
`;

const REORDERED_STATEMENTS_LEFT = `
export function buildShippingPayload(order: Order): Payload {
  const destinationCountry = order.destination.country.toUpperCase();
  const canShip = order.status === "paid" && order.items.length > 0;
  const carrier = destinationCountry === "CA" ? "post" : "ups";
  const totalWeight = order.items.reduce((sum, item) => sum + item.weight, 0);
  if (!canShip) {
    return { carrier: "hold", totalWeight: 0, destinationCountry };
  }
  const priority = totalWeight > 50 ? "freight" : "standard";
  return { carrier, totalWeight, destinationCountry, priority };
}
`;

const REORDERED_STATEMENTS_RIGHT = `
export function makeShippingPayload(shipment: Order): Payload {
  const canShip = shipment.status === "paid" && shipment.items.length > 0;
  const destinationCountry = shipment.destination.country.toUpperCase();
  const totalWeight = shipment.items.reduce((sum, item) => sum + item.weight, 0);
  const carrier = destinationCountry === "CA" ? "post" : "ups";
  if (!canShip) {
    return { carrier: "hold", totalWeight: 0, destinationCountry };
  }
  const priority = totalWeight > 50 ? "freight" : "standard";
  return { carrier, totalWeight, destinationCountry, priority };
}
`;

function functionsFrom(files: Record<string, string>): NearDuplicateFunction[] {
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractNearDuplicateFunctions(filePath, source),
  );
}

describe("extractNearDuplicateFunctions", () => {
  it("collects exact tokens by default and omits them when explicitly disabled", () => {
    const withDefault = extractNearDuplicateFunctions("scripts/totals.ts", RENAMED_VARIABLES);
    const withoutExactTokens = extractNearDuplicateFunctions(
      "scripts/totals.ts",
      RENAMED_VARIABLES,
      { includeExactTokens: false },
    );

    expect(withDefault.every((item) => item.exactTokens.length > 0)).toBe(true);
    expect(withoutExactTokens.every((item) => item.exactTokens.length === 0)).toBe(true);
  });
});

// Hand-built fingerprints give precise control over filePath/startLine/endLine
// so we can exercise the same-file range-overlap guard. Identical features and
// statementFeatures make every pair a perfect (similarity 1.0) match and share
// one statement bucket, so only the overlap guard can suppress a pair.
const SHARED_FEATURES = ["call:reduce", "if", "return", "binary:+"] as const;
function nearDuplicateFunction(
  overrides: Partial<NearDuplicateFunction> & {
    readonly filePath: string;
    readonly name: string;
    readonly startLine: number;
    readonly endLine: number;
  },
): NearDuplicateFunction {
  return {
    enclosingContext: "",
    startOffset: 0,
    endOffset: 100,
    lineCount: 20,
    tokenCount: 50,
    features: [...SHARED_FEATURES],
    statementFeatures: [...SHARED_FEATURES],
    exactTokens: [],
    ...overrides,
  };
}

describe("compareNearDuplicateFunctions", () => {
  it("returns null for an enclosing/overlapping same-file pair instead of pairing a function with itself", () => {
    const outer = nearDuplicateFunction({
      filePath: "src/dup.ts",
      name: "outer",
      startLine: 1,
      endLine: 30,
    });
    const inner = nearDuplicateFunction({
      filePath: "src/dup.ts",
      name: "inner",
      startLine: 5,
      endLine: 12,
    });
    expect(compareNearDuplicateFunctions(outer, inner)).toBeNull();
  });

  it("returns a canonical pair for identical functions living in distinct files", () => {
    const left = nearDuplicateFunction({
      filePath: "src/a.ts",
      name: "alpha",
      startLine: 1,
      endLine: 30,
    });
    const right = nearDuplicateFunction({
      filePath: "src/b.ts",
      name: "beta",
      startLine: 1,
      endLine: 30,
    });
    const pair = compareNearDuplicateFunctions(left, right);
    expect(pair).not.toBeNull();
    expect(pair?.similarity).toBe(1);
    expect(pair?.left.filePath).toBe("src/a.ts");
    expect(pair?.right.filePath).toBe("src/b.ts");
  });

  it("still pairs same-file functions whose ranges are disjoint", () => {
    const first = nearDuplicateFunction({
      filePath: "src/same.ts",
      name: "first",
      startLine: 1,
      endLine: 12,
    });
    const second = nearDuplicateFunction({
      filePath: "src/same.ts",
      name: "second",
      startLine: 20,
      endLine: 40,
    });
    const pair = compareNearDuplicateFunctions(first, second);
    expect(pair).not.toBeNull();
    expect(pair?.left.startLine).toBe(1);
    expect(pair?.right.startLine).toBe(20);
  });
});

describe("findNearDuplicatePairs", () => {
  it("excludes an overlapping same-file pair while still pairing the disjoint cross-file clone", () => {
    const outer = nearDuplicateFunction({
      filePath: "src/dup.ts",
      name: "outer",
      startLine: 1,
      endLine: 30,
    });
    const inner = nearDuplicateFunction({
      filePath: "src/dup.ts",
      name: "inner",
      startLine: 5,
      endLine: 12,
    });
    const other = nearDuplicateFunction({
      filePath: "src/other.ts",
      name: "other",
      startLine: 1,
      endLine: 30,
    });
    const pairs = findNearDuplicatePairs([outer, inner, other]);
    // outer<->inner overlap in src/dup.ts and must be suppressed; the two
    // cross-file matches (outer<->other, inner<->other) survive.
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      expect(pair.left.filePath === "src/dup.ts" && pair.right.filePath === "src/dup.ts").toBe(
        false,
      );
    }
    const otherSides = pairs.map((pair) =>
      pair.left.filePath === "src/other.ts" ? pair.right.name : pair.left.name,
    );
    expect([...otherSides].sort()).toEqual(["inner", "outer"]);
  });

  it("flags renamed-variable function clones that token-based duplication can miss", () => {
    const functions = functionsFrom({ "src/totals.ts": RENAMED_VARIABLES });
    const pairs = findNearDuplicatePairs(functions);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.similarity).toBeGreaterThanOrEqual(0.85);
    expect(pairs[0]?.left.name).toBe("totalForOrder");
    expect(pairs[0]?.right.name).toBe("totalForBasket");
  });

  it("flags reordered-statement clones by using structural statement fingerprints", () => {
    const pairs = findNearDuplicatePairs(
      functionsFrom({
        "src/left.ts": REORDERED_STATEMENTS_LEFT,
        "src/right.ts": REORDERED_STATEMENTS_RIGHT,
      }),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps tiny functions below the conservative floor out of the report", () => {
    const functions = functionsFrom({
      "src/tiny-a.ts": "export function one(x: number) {\n  return x + 1;\n}\n",
      "src/tiny-b.ts": "export function two(y: number) {\n  return y + 1;\n}\n",
    });
    expect(findNearDuplicatePairs(functions)).toEqual([]);
  });
});

describe("findNearDuplicatePairs compare-config validation", () => {
  const oneFunction = [
    nearDuplicateFunction({
      filePath: "src/only.ts",
      name: "only",
      startLine: 1,
      endLine: 30,
    }),
  ];

  it("rejects a minLines below one", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { minLines: 0 })).toThrow(
      /minLines and minTokens must be integers >= 1/,
    );
  });

  it("rejects a minTokens below one", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { minTokens: 0 })).toThrow(
      /minLines and minTokens must be integers >= 1/,
    );
  });

  it("rejects non-integer minLines and minTokens", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { minLines: 2.5 })).toThrow(
      /minLines and minTokens must be integers >= 1/,
    );
    expect(() => findNearDuplicatePairs(oneFunction, { minTokens: Number.NaN })).toThrow(
      /minLines and minTokens must be integers >= 1/,
    );
  });

  it("rejects non-finite similarityThreshold and tokenBandRatio", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { similarityThreshold: Number.NaN })).toThrow(
      /similarityThreshold must be within \[0, 1\]/,
    );
    expect(() =>
      findNearDuplicatePairs(oneFunction, { similarityThreshold: Number.POSITIVE_INFINITY }),
    ).toThrow(/similarityThreshold must be within \[0, 1\]/);
    expect(() => findNearDuplicatePairs(oneFunction, { tokenBandRatio: Number.NaN })).toThrow(
      /tokenBandRatio must be within \[0, 1\]/,
    );
  });

  it("rejects a similarityThreshold outside the unit interval", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { similarityThreshold: -0.1 })).toThrow(
      /similarityThreshold must be within \[0, 1\]/,
    );
    expect(() => findNearDuplicatePairs(oneFunction, { similarityThreshold: 1.1 })).toThrow(
      /similarityThreshold must be within \[0, 1\]/,
    );
  });

  it("rejects a tokenBandRatio outside the unit interval", () => {
    expect(() => findNearDuplicatePairs(oneFunction, { tokenBandRatio: -0.5 })).toThrow(
      /tokenBandRatio must be within \[0, 1\]/,
    );
    expect(() => findNearDuplicatePairs(oneFunction, { tokenBandRatio: 2 })).toThrow(
      /tokenBandRatio must be within \[0, 1\]/,
    );
  });

  it("accepts explicit in-bounds config values at the interval edges", () => {
    expect(() =>
      findNearDuplicatePairs(oneFunction, {
        minLines: 1,
        minTokens: 1,
        similarityThreshold: 0,
        tokenBandRatio: 1,
      }),
    ).not.toThrow();
  });
});

describe("buildNearDuplicateFindings", () => {
  it("reports current-scope pairs sorted by line impact, with drift-baseline provenance", () => {
    const pairs = findNearDuplicatePairs(
      functionsFrom({
        "src/totals.ts": RENAMED_VARIABLES,
        "src/left.ts": REORDERED_STATEMENTS_LEFT,
        "src/right.ts": REORDERED_STATEMENTS_RIGHT,
      }),
    );
    const findings = buildNearDuplicateFindings(
      pairs,
      { scopeMode: "current", files: [] },
      PROVENANCE,
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.check).toBe("near-duplicates");
    expect(findings[0]?.provenance).toEqual(PROVENANCE);
    expect(findings[0]?.message).toContain("near-duplicates");
    expect(findings[0]?.relatedFiles?.[0]).toContain(":");
  });

  it("intersects global pairs with the changed set in changed scope", () => {
    const pairs = findNearDuplicatePairs(
      functionsFrom({
        "src/totals.ts": RENAMED_VARIABLES,
        "src/left.ts": REORDERED_STATEMENTS_LEFT,
        "src/right.ts": REORDERED_STATEMENTS_RIGHT,
      }),
    );
    const findings = buildNearDuplicateFindings(
      pairs,
      changedScope([{ path: "src/left.ts", status: "modified" }]),
      PROVENANCE,
    );
    expect(findings).toHaveLength(1);
    expect([findings[0]?.file, ...(findings[0]?.relatedFiles ?? [])].join(" ")).toContain(
      "src/right.ts",
    );
  });
});

describe("defaultNearDuplicateRunner", () => {
  it("walks configured roots and ignores test fixtures before extracting functions", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/totals.test.ts": RENAMED_VARIABLES,
      "docs/example.ts": RENAMED_VARIABLES,
    });
    const result = defaultNearDuplicateRunner()({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: ["**/*.test.ts"],
      engine: "ts-morph",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "ts-morph") {
      expect(result.functions.map((item) => item.filePath)).toEqual([
        "src/totals.ts",
        "src/totals.ts",
      ]);
      expect(result.functions.every((item) => item.exactTokens.length === 0)).toBe(true);
    }
  });

  it("extracts exact tokens only for exact-eligible production roots", () => {
    const repoRoot = writeRepo({
      "scripts/eligible.ts": RENAMED_VARIABLES,
      "eslint-rules/eligible.ts": RENAMED_VARIABLES,
      "packages/server/src/outside.ts": RENAMED_VARIABLES,
      "scripts/eligible.test.ts": RENAMED_VARIABLES,
      "scripts/fixtures/eligible.ts": RENAMED_VARIABLES,
    });
    const result = defaultNearDuplicateRunner()({
      repoRoot,
      roots: ["scripts", "eslint-rules", "packages/server/src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "ts-morph",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "ts-morph") {
      const tokenizedPaths = new Set(
        result.functions.filter((item) => item.exactTokens.length > 0).map((item) => item.filePath),
      );
      expect(tokenizedPaths).toEqual(new Set(["eslint-rules/eligible.ts", "scripts/eligible.ts"]));
    }
  });
});

type SpawnCall = { readonly command: string; readonly args: readonly string[] };

function recordingSpawn(result: SimilarityTsSpawnResult): {
  readonly spawn: SimilarityTsSpawn;
  readonly calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn: SimilarityTsSpawn = (command, args) => {
    calls.push({ command, args: [...args] });
    return result;
  };
  return { spawn, calls };
}

// The args are `[...files, ...flags]`, so the leading run before the first
// `--`-prefixed flag is exactly the file inventory handed to similarity-ts.
function positionalPaths(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--")) break;
    paths.push(arg);
  }
  return paths;
}

// The valid fixtures were captured byte-for-byte from real similarity-ts 0.5.0
// runs; the truncated variant intentionally declares two records but retains one.
const SIMILARITY_TS_NO_SOURCE_FILES_STDOUT = `Analyzing code similarity...

=== Function Similarity ===
No TypeScript/JavaScript files found in the specified paths.
`;

const SIMILARITY_TS_THREE_PAIRS_STDOUT = `Analyzing code similarity...

=== Function Similarity ===
Checking 3 files for duplicates...

Found 3 duplicate pairs:
------------------------------------------------------------

Similarity: 97.27%, Score: 19.5 points (lines 20~20, avg: 20.0)
  big1.ts:1-20 processData
  big3.ts:1-20 copyOfProcessData

Similarity: 97.27%, Score: 19.5 points (lines 20~20, avg: 20.0)
  big1.ts:1-20 processData
  big4.ts:1-20 thirdVariant

Similarity: 97.27%, Score: 19.5 points (lines 20~20, avg: 20.0)
  big3.ts:1-20 copyOfProcessData
  big4.ts:1-20 thirdVariant
`;

const SIMILARITY_TS_TRUNCATED_PAIRS_STDOUT = `Analyzing code similarity...

=== Function Similarity ===
Checking 2 files for duplicates...

Found 2 duplicate pairs:
------------------------------------------------------------

Similarity: 97.27%, Score: 19.5 points (lines 20~20, avg: 20.0)
  big1.ts:1-20 processData
  big3.ts:1-20 copyOfProcessData
`;

describe("defaultNearDuplicateRunner (similarity-ts engine)", () => {
  it("pins the similarity-ts argv and filtered positional inventory", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/totals.test.ts": RENAMED_VARIABLES, // excluded via excludeGlobs
      "src/types.d.ts": "export type Cents = number;\n", // declaration file
      "src/data.json": "{}\n", // unsupported extension
      "node_modules/pkg/index.ts": RENAMED_VARIABLES, // ignored path segment
    });
    const stdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Checking 1 files for duplicates...",
      "",
      "No duplicate functions found!",
      "",
    ].join("\n");
    const { spawn, calls } = recordingSpawn({ status: 0, stdout, stderr: "" });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: [],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: ["**/*.test.ts"],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "src/totals.ts",
      "--threshold",
      "0.85",
      "--min-tokens",
      "45",
      "--no-types",
    ]);
    expect(result).toEqual({ ok: true, engine: "similarity-ts", pairs: [] });
  });

  it("honors additional configured source extensions in the similarity-ts inventory", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/totals.mts": RENAMED_VARIABLES, // only a source file when .mts is configured
    });
    const stdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Checking 2 files for duplicates...",
      "",
      "No duplicate functions found!",
      "",
    ].join("\n");
    const { spawn, calls } = recordingSpawn({ status: 0, stdout, stderr: "" });
    defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([".mts"]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(positionalPaths(calls[0]?.args ?? [])).toEqual(["src/totals.mts", "src/totals.ts"]);
  });

  it("does not spawn similarity-ts when no source files survive filtering", () => {
    const repoRoot = writeRepo({
      "src/totals.test.ts": RENAMED_VARIABLES,
      "src/types.d.ts": "export type Cents = number;\n",
    });
    const { spawn, calls } = recordingSpawn({ status: 1, stdout: "", stderr: "boom" });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: ["**/*.test.ts"],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "similarity-ts") {
      expect(result.pairs).toEqual([]);
    }
  });

  it("accepts similarity-ts zero-pair output when its filtered inventory has no parsable files", () => {
    const repoRoot = writeRepo({ "src/component.vue": "<script>export default {};</script>\n" });
    const { spawn, calls } = recordingSpawn({
      status: 0,
      stdout: SIMILARITY_TS_NO_SOURCE_FILES_STDOUT,
      stderr: "",
    });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([".vue"]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ ok: true, engine: "similarity-ts", pairs: [] });
  });

  it("parses similarity-ts stdout into near-duplicate pairs", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/basket.ts": RENAMED_VARIABLES,
    });
    const stdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Checking 2 files for duplicates...",
      "",
      "Found 1 duplicate pairs:",
      "------------------------------------------------------------",
      "",
      "Similarity: 92.50%, Score: 12.0 points (lines 13~13, avg: 13.0)",
      "  src/totals.ts:3-15 totalForOrder",
      "  src/basket.ts:1-13 totalForBasket",
      "",
    ].join("\n");
    const { spawn } = recordingSpawn({ status: 0, stdout, stderr: "" });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "similarity-ts") {
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]?.similarity).toBeCloseTo(0.925);
    }
  });

  it("parses every record from captured multi-pair similarity-ts stdout", () => {
    const repoRoot = writeRepo({
      "big1.ts": RENAMED_VARIABLES,
      "big3.ts": RENAMED_VARIABLES,
      "big4.ts": RENAMED_VARIABLES,
    });
    const { spawn } = recordingSpawn({
      status: 0,
      stdout: SIMILARITY_TS_THREE_PAIRS_STDOUT,
      stderr: "",
    });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: [],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "similarity-ts") {
      expect(
        result.pairs.map((pair) => [
          pair.left.filePath,
          pair.left.name,
          pair.right.filePath,
          pair.right.name,
        ]),
      ).toEqual([
        ["big1.ts", "processData", "big3.ts", "copyOfProcessData"],
        ["big1.ts", "processData", "big4.ts", "thirdVariant"],
        ["big3.ts", "copyOfProcessData", "big4.ts", "thirdVariant"],
      ]);
    }
  });

  it("fails closed when the declared pair count exceeds the complete records", () => {
    const repoRoot = writeRepo({
      "big1.ts": RENAMED_VARIABLES,
      "big3.ts": RENAMED_VARIABLES,
    });
    const { spawn } = recordingSpawn({
      status: 0,
      stdout: SIMILARITY_TS_TRUNCATED_PAIRS_STDOUT,
      stderr: "",
    });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: [],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("run-failed");
      expect(result.error).toContain("similarity-ts 0.5.0 text protocol");
    }
  });

  it("routes malformed non-empty stdout through the analyzer-failure path", () => {
    const repoRoot = writeRepo({ "src/totals.ts": RENAMED_VARIABLES });
    const stdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Checking 1 files for duplicates...",
      "",
      "No duplicate functions found!",
      `unexpected trailing record ${"x".repeat(1_000)} tail-sentinel`,
    ].join("\n");
    const { spawn } = recordingSpawn({ status: 0, stdout, stderr: "" });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("run-failed");
      expect(result.error).toContain("similarity-ts 0.5.0 text protocol");
      expect(result.error.length).toBeLessThanOrEqual(400);
      expect(result.error).not.toContain("tail-sentinel");
    }
  });

  it("fails closed when the pinned protocol changes or stdout is empty", () => {
    const repoRoot = writeRepo({ "src/totals.ts": RENAMED_VARIABLES });
    const changedStdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Scanning 1 files for duplicates...",
      "",
      "No duplicate functions found!",
      "",
    ].join("\n");
    for (const stdout of [changedStdout, ""]) {
      const { spawn } = recordingSpawn({ status: 0, stdout, stderr: "" });
      const result = defaultNearDuplicateRunner({ spawn })({
        repoRoot,
        roots: ["src"],
        sourceExtensions: buildSourceExtensions([]),
        ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
        excludeGlobs: [],
        engine: "similarity-ts",
        minLines: 8,
        minTokens: 45,
        similarityThreshold: 0.85,
        includeExactTokens: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("run-failed");
        expect(result.error).toContain("similarity-ts 0.5.0 text protocol");
      }
    }
  });

  it("rejects the filter-only zero-pair sentinel the adapter cannot produce", () => {
    const repoRoot = writeRepo({ "src/totals.ts": RENAMED_VARIABLES });
    const stdout = [
      "Analyzing code similarity...",
      "",
      "=== Function Similarity ===",
      "Checking 1 files for duplicates...",
      "",
      "No duplicate functions found matching the filters!",
      "",
    ].join("\n");
    const { spawn } = recordingSpawn({ status: 0, stdout, stderr: "" });
    const result = defaultNearDuplicateRunner({ spawn })({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: [],
      engine: "similarity-ts",
      minLines: 8,
      minTokens: 45,
      similarityThreshold: 0.85,
      includeExactTokens: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("run-failed");
      expect(result.error).toContain("similarity-ts 0.5.0 text protocol");
    }
  });
});

type CtxOverrides = {
  readonly detectorScope?: DetectorScope;
  readonly nearDuplicates?: NearDuplicateRunner;
};

function makeCtx(overrides: CtxOverrides = {}): CheckRunInput {
  return {
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: [],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: () => undefined,
    env: {
      repoRoot: "/repo/target",
      overrides: {
        nearDuplicates:
          overrides.nearDuplicates ??
          (() => ({
            ok: true,
            engine: "ts-morph",
            functions: functionsFrom({ "src/totals.ts": RENAMED_VARIABLES }),
          })),
      },
      cli: parseArgs(["--scope", "current", "--check", "near-duplicates"]),
      warnStderr: () => undefined,
    },
  };
}

describe("nearDuplicatesCheck", () => {
  it("is opt-in because it compares functions across the project", () => {
    expect(nearDuplicatesCheck.runByDefault).toBe(false);
  });

  it("reports provenance-stamped near-duplicate findings", () => {
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(makeCtx());
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.provenance).toEqual(PROVENANCE);
      expect(outcome.findings[0]?.details?.similarity).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("reports small exact clones only in the opt-in drift check", () => {
    const exactFunctions = functionsFrom({
      "scripts/exact.ts": `
        export function exactA(value: number) {
          const next = value + Math.max(value, 2);
          return next * Math.min(value, 4);
        }
        export function exactB(value: number) {
          const next = value + Math.max(value, 2);
          return next * Math.min(value, 4);
        }
      `,
    });
    let includeExactTokens: boolean | undefined;
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(
      makeCtx({
        nearDuplicates: (input) => {
          includeExactTokens = input.includeExactTokens;
          return { ok: true, engine: "ts-morph", functions: exactFunctions };
        },
      }),
    );
    expect(includeExactTokens).toBe(true);
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.details?.tiers).toEqual(["exact"]);
      expect(outcome.findings[0]?.details?.primaryTier).toBe("exact");
    }
  });

  it("emits one diagnostic finding when extraction fails", () => {
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(
      makeCtx({
        nearDuplicates: () => ({ ok: false, reason: "run-failed", error: "parser exploded" }),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.message).toContain("could not extract function fingerprints");
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });

  it("keeps exact bucket overflow diagnostic and report-only", () => {
    const base = functionsFrom({
      "scripts/exact.ts": `
        export function exact(value: number) {
          const next = value + Math.max(value, 2);
          return next * Math.min(value, 4);
        }
      `,
    })[0];
    if (base === undefined) throw new Error("missing exact function");
    const functions = Array.from(
      { length: 101 },
      (_, index): NearDuplicateFunction => ({
        ...base,
        name: `copy${String(index)}`,
        startOffset: index * 100,
        endOffset: index * 100 + 50,
        startLine: index * 4 + 1,
        endLine: index * 4 + 3,
      }),
    );
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(
      makeCtx({
        nearDuplicates: () => ({ ok: true, engine: "ts-morph", functions }),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.message).toContain("101 functions");
    }
  });

  it("skips cleanly when the optional similarity-ts binary is selected but absent", () => {
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(
      makeCtx({
        nearDuplicates: () => ({ ok: false, reason: "tool-unavailable", error: "ENOENT" }),
      }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.code).toBe("tool-not-installed");
      expect(outcome.reason).toContain("cargo install similarity-ts --version 0.5.0 --locked");
    }
  });
});

describe("runNearDuplicatesCli", () => {
  const fixtureDir = path.join(import.meta.dirname, "fixtures/near-duplicate-gate");

  function fixture(name: string): string {
    return readFileSync(path.join(fixtureDir, name), "utf8");
  }

  function commitAll(repoRoot: string, message: string): void {
    execFileSync("git", ["add", "."], { cwd: repoRoot });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Musi Tests",
        "-c",
        "user.email=tests@musi.invalid",
        "commit",
        "-qm",
        message,
      ],
      { cwd: repoRoot },
    );
  }

  function committedDebtRepo(): { readonly baselinePath: string; readonly repoRoot: string } {
    const repoRoot = tmpRepo.makeTmpGitRepo("drift-near-dupes-gate-");
    tmpRepo.writeRepoFile(repoRoot, "src/existing-order.ts", fixture("existing-order.ts"));
    tmpRepo.writeRepoFile(repoRoot, "src/existing-basket.ts", fixture("existing-basket.ts"));
    const baselinePath = path.join(repoRoot, "sensor-near-duplicates.baseline.json");
    const discovered = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });
    writeFileSync(baselinePath, formatNearDuplicatesBaseline(discovered.entries ?? []));
    commitAll(repoRoot, "test: commit near-duplicate debt");
    return { baselinePath, repoRoot };
  }

  it("admits baseline debt but fails a synthetic clone touching a changed file", () => {
    const { repoRoot } = committedDebtRepo();

    const existingDebt = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/existing-order.ts"],
    });
    expect(existingDebt.exitCode).toBe(0);
    expect(existingDebt.stdout).toContain("committed no-new floor");
    expect(runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot }).exitCode).toBe(0);

    tmpRepo.writeRepoFile(repoRoot, "src/new-clone.ts", fixture("new-clone.ts"));
    const regression = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/new-clone.ts"],
    });
    expect(regression.exitCode).toBe(1);
    expect(regression.stdout).toContain("FAIL: near-duplicate function pairs added");
    expect(regression.stdout).toContain("src/new-clone.ts#totalForShipment");
    const fullCheck = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    expect(fullCheck.exitCode).toBe(3);
    expect(fullCheck.stdout).toContain("whole-repo near-duplicate baseline is stale");

    const refusedUpdate = runNearDuplicatesCli({
      argv: ["--update"],
      cwd: repoRoot,
    });
    expect(refusedUpdate.exitCode).toBe(1);
    expect(refusedUpdate.stdout).toContain("refusing to increase the committed baseline");
  });

  it("uses configured thresholds for gate collection and comparison", () => {
    const { repoRoot } = committedDebtRepo();
    tmpRepo.writeRepoFile(
      repoRoot,
      "drift-ai.config.json",
      JSON.stringify({
        checks: {
          "near-duplicates": {
            minLines: 100,
            minTokens: 120,
            similarityThreshold: 0.95,
            tokenBandRatio: 0.2,
          },
        },
      }),
    );
    const inputs: Parameters<NearDuplicateRunner>[0][] = [];
    const result = runNearDuplicatesCli({
      argv: ["--check-baseline"],
      cwd: repoRoot,
      runner: (input) => {
        inputs.push(input);
        return {
          ok: true,
          engine: NEAR_DUPLICATE_TOOL,
          functions: functionsFrom({ "src/totals.ts": RENAMED_VARIABLES }),
        };
      },
    });

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      minLines: 100,
      minTokens: 120,
      similarityThreshold: 0.95,
    });
    expect(result.entries).toEqual([]);
    expect(result.stdout).toContain("whole-repo near-duplicate baseline is stale");
  });

  it("migrates a renamed identity through a reasoned admission", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    const committed = readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"));
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const oldIdentity = committed.value[0]?.key;
    expect(oldIdentity).toBeDefined();
    if (oldIdentity === undefined) return;
    unlinkSync(path.join(repoRoot, "src/existing-order.ts"));
    tmpRepo.writeRepoFile(repoRoot, "src/renamed-order.ts", fixture("existing-order.ts"));

    const renamed = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    const newIdentity = renamed.entries?.[0]?.key;
    expect(newIdentity).toBeDefined();
    expect(newIdentity).not.toBe(oldIdentity);
    if (newIdentity === undefined) return;
    const refusedUpdate = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });
    expect(refusedUpdate.exitCode).toBe(1);
    expect(refusedUpdate.stdout).toContain("refusing to increase the committed baseline");

    const reason = `renamed from ${oldIdentity}`;
    const admitted = runNearDuplicatesCli({
      argv: ["--admit", newIdentity, "--reason", reason],
      cwd: repoRoot,
    });

    expect(admitted.exitCode).toBe(0);
    expect(admitted.stdout).toContain("admitted 1 reviewed identity");
    const migrated = readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"));
    expect(migrated).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          key: newIdentity,
          admissionReason: reason,
        }),
      ],
    });
    expect(runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot }).exitCode).toBe(0);
    commitAll(repoRoot, "test: commit reviewed rename admission");
    expect(runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot }).exitCode).toBe(0);
    expect(readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"))).toEqual(migrated);
  });

  it("requires a non-empty reason for every admission", () => {
    expect(runNearDuplicatesCli({ argv: ["--admit", "some identity"] }).stdout).toContain(
      "--admit requires --reason",
    );
    expect(
      runNearDuplicatesCli({ argv: ["--admit", "some identity", "--reason", "  "] }).stdout,
    ).toContain("--reason requires non-empty text");
    expect(runNearDuplicatesCli({ argv: ["--reason", "reviewed"] }).stdout).toContain(
      "--reason requires --admit",
    );
  });

  it("uses a dedicated verdict when the working baseline proposes unreviewed growth", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    tmpRepo.writeRepoFile(repoRoot, "src/new-clone.ts", fixture("new-clone.ts"));
    const current = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    writeFileSync(baselinePath, formatNearDuplicatesBaseline(current.entries ?? []));
    execFileSync("git", ["add", "src/new-clone.ts", "sensor-near-duplicates.baseline.json"], {
      cwd: repoRoot,
    });

    const stagedCheck = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/new-clone.ts", "sensor-near-duplicates.baseline.json"],
    });
    const wholeTreeCheck = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });

    expect(stagedCheck.exitCode).toBe(6);
    expect(stagedCheck.stdout).toContain("proposed baseline adds near-duplicate debt over HEAD");
    expect(wholeTreeCheck.exitCode).toBe(6);
    expect(wholeTreeCheck.stdout).toContain("proposed baseline adds near-duplicate debt over HEAD");
  });

  it("refuses to regenerate a deleted committed baseline", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    unlinkSync(baselinePath);

    const update = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });

    expect(update.exitCode).toBe(2);
    expect(update.stdout).toContain("baseline missing");
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("restores exact detector truth after a stamped semantic merge", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    const preMergeHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    writeFileSync(baselinePath, formatNearDuplicatesBaseline([]));
    commitAll(repoRoot, "test: simulate drained merge baseline");
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const current = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    expect(current.exitCode).toBe(3);
    expect(runNearDuplicatesCli({ argv: ["--restore-merge-truth"], cwd: repoRoot }).exitCode).toBe(
      2,
    );
    const markerPath = path.resolve(
      repoRoot,
      gitDir,
      "musi/near-duplicates-baseline-postmerge-truth-up-required",
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `truth-up required\npre-merge-head=${preMergeHead}\n`);

    const restored = runNearDuplicatesCli({ argv: ["--restore-merge-truth"], cwd: repoRoot });

    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("restored stamped merge truth");
    expect(readFileSync(baselinePath, "utf8")).toBe(
      formatNearDuplicatesBaseline(current.entries ?? []),
    );
    expect(
      runNearDuplicatesCli({
        argv: [],
        cwd: repoRoot,
        changedFiles: ["sensor-near-duplicates.baseline.json"],
      }).exitCode,
    ).toBe(0);
  });
});
