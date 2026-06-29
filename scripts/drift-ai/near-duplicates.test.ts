import { describe, expect, it } from "vitest";

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
    lineCount: 20,
    tokenCount: 50,
    features: [...SHARED_FEATURES],
    statementFeatures: [...SHARED_FEATURES],
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
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "ts-morph") {
      expect(result.functions.map((item) => item.filePath)).toEqual([
        "src/totals.ts",
        "src/totals.ts",
      ]);
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

describe("defaultNearDuplicateRunner (similarity-ts engine)", () => {
  it("hands similarity-ts only the filtered inventory as explicit positional paths", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/totals.test.ts": RENAMED_VARIABLES, // excluded via excludeGlobs
      "src/types.d.ts": "export type Cents = number;\n", // declaration file
      "src/data.json": "{}\n", // unsupported extension
      "node_modules/pkg/index.ts": RENAMED_VARIABLES, // ignored path segment
    });
    const { spawn, calls } = recordingSpawn({ status: 0, stdout: "", stderr: "" });
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
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "src/totals.ts",
      "--threshold",
      "0.85",
      "--min-lines",
      "8",
      "--min-tokens",
      "45",
      "--cross-file",
    ]);
  });

  it("honors additional configured source extensions in the similarity-ts inventory", () => {
    const repoRoot = writeRepo({
      "src/totals.ts": RENAMED_VARIABLES,
      "src/totals.mts": RENAMED_VARIABLES, // only a source file when .mts is configured
    });
    const { spawn, calls } = recordingSpawn({ status: 0, stdout: "", stderr: "" });
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
    });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "similarity-ts") {
      expect(result.pairs).toEqual([]);
    }
  });

  it("parses similarity-ts stdout into near-duplicate pairs", () => {
    const repoRoot = writeRepo({ "src/totals.ts": RENAMED_VARIABLES });
    const stdout = [
      "src/totals.ts:3-15 totalForOrder <-> src/basket.ts:1-13 totalForBasket",
      "  Similarity: 92.50%",
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
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.engine === "similarity-ts") {
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]?.similarity).toBeCloseTo(0.925);
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

  it("skips cleanly when the optional similarity-ts binary is selected but absent", () => {
    const outcome = nearDuplicatesCheck.runWithSelectedConfig(
      makeCtx({
        nearDuplicates: () => ({ ok: false, reason: "tool-unavailable", error: "ENOENT" }),
      }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("tool-not-installed");
  });
});
