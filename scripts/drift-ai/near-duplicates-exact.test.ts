import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractNearDuplicateFunctions, type NearDuplicateFunction } from "./near-duplicates.js";
import {
  findExactFunctionClonePairs,
  occurrencePairIdentity,
  unionNearDuplicateOccurrencePairs,
} from "./near-duplicates-exact.js";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/near-duplicates-v2",
);

function fixtureFunctions(): NearDuplicateFunction[] {
  return [
    ...extractNearDuplicateFunctions(
      "eslint-rules/exact-a.tsx",
      readFileSync(path.join(FIXTURE_DIR, "exact-a.tsx"), "utf8"),
    ),
    ...extractNearDuplicateFunctions(
      "eslint-rules/exact-b.tsx",
      readFileSync(path.join(FIXTURE_DIR, "exact-b.tsx"), "utf8"),
    ),
  ];
}

function pairNames(result: ReturnType<typeof findExactFunctionClonePairs>): Set<string> {
  if (!result.ok) throw new Error(result.error);
  return new Set(result.pairs.map((pair) => `${pair.left.name}<->${pair.right.name}`));
}

function canonicalNames(left: string, right: string): string {
  return [left, right].sort().join("<->");
}

describe("parser-derived exact function tokens", () => {
  it("preserves literal, identifier, property, keyword, operator, template, regex, and JSX text", () => {
    const functions = fixtureFunctions();
    const names = pairNames(findExactFunctionClonePairs(functions));
    const positives: readonly (readonly [string, string])[] = [
      ["smallExactA", "smallExactB"],
      ["formattedA", "formattedB"],
      ["stringA", "stringB"],
      ["numericA", "numericB"],
      ["bigintA", "bigintB"],
      ["booleanA", "booleanB"],
      ["nullA", "nullB"],
      ["regexA", "regexB"],
      ["noSubTemplateA", "noSubTemplateB"],
      ["templateA", "templateB"],
      ["jsxA", "jsxB"],
      ["privateExactA", "privateExactB"],
    ];
    for (const [left, right] of positives) {
      expect(names, `${left}<->${right}`).toContain(canonicalNames(left, right));
    }
    const negatives: readonly (readonly [string, string])[] = [
      ["identifierA", "identifierChanged"],
      ["propertyA", "propertyChanged"],
      ["operatorA", "operatorChanged"],
      ["stringA", "stringChanged"],
      ["numericA", "numericChanged"],
      ["bigintA", "bigintChanged"],
      ["booleanA", "booleanChanged"],
      ["nullA", "nullChanged"],
      ["regexA", "regexChanged"],
      ["noSubTemplateA", "noSubTemplateChanged"],
      ["templateA", "templateChanged"],
      ["jsxA", "jsxChanged"],
      ["privateExactA", "privateChanged"],
      ["signatureDefaultA", "signatureDefaultChanged"],
      ["signatureAsyncA", "signatureAsyncChanged"],
    ];
    for (const [left, right] of negatives) {
      expect(names, `${left}<->${right}`).not.toContain(canonicalNames(left, right));
    }
  });

  it("records definitive offsets and enclosing display context during the existing parse", () => {
    const method = fixtureFunctions().find((item) => item.name === "privateExactA");
    expect(method?.startOffset).toBeGreaterThan(0);
    expect(method?.endOffset).toBeGreaterThan(method?.startOffset ?? Number.MAX_SAFE_INTEGER);
    expect(method?.enclosingContext).toContain("PrivateA");
    expect(method?.exactTokens.length).toBeGreaterThanOrEqual(15);
  });

  it("applies the 3-line/15-token floors and scripts/eslint production scope", () => {
    const source = `
      export function eligible(value: number) {
        const next = value + Math.max(value, 2);
        return next * Math.min(value, 4);
      }
      export function eligibleAgain(value: number) {
        const next = value + Math.max(value, 2);
        return next * Math.min(value, 4);
      }
    `;
    const inScope = extractNearDuplicateFunctions("scripts/eligible.ts", source);
    expect(pairNames(findExactFunctionClonePairs(inScope))).toContain(
      canonicalNames("eligible", "eligibleAgain"),
    );
    for (const filePath of [
      "packages/server/src/outside.ts",
      "scripts/eligible.test.ts",
      "scripts/fixtures/eligible.ts",
      "scripts/generated/eligible.ts",
      "eslint-rules/eligible.d.ts",
    ]) {
      expect(
        pairNames(findExactFunctionClonePairs(extractNearDuplicateFunctions(filePath, source))),
      ).toEqual(new Set());
    }
    const belowLineFloor = extractNearDuplicateFunctions(
      "scripts/short.ts",
      "export const shortA = (value: number) => Math.max(value, 2) + Math.min(value, 4);\nexport const shortB = (value: number) => Math.max(value, 2) + Math.min(value, 4);",
    );
    expect(pairNames(findExactFunctionClonePairs(belowLineFloor))).toEqual(new Set());
  });

  it("checks full token sequences even when their index hashes collide", () => {
    const functions = fixtureFunctions().filter((item) =>
      ["stringA", "stringChanged"].includes(item.name),
    );
    const result = findExactFunctionClonePairs(functions, { hashSequence: () => "collision" });
    expect(pairNames(result)).toEqual(new Set());
    if (!result.ok) throw new Error(result.error);
    expect(result.audit.maximumRawHashBucketSize).toBe(2);
    expect(result.audit.maximumEqualityGroupSize).toBe(1);
  });

  it("fails closed before pair allocation when an equality group exceeds the hard cap", () => {
    const base = fixtureFunctions().find((item) => item.name === "smallExactA");
    if (base === undefined) throw new Error("missing exact fixture function");
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
    const result = findExactFunctionClonePairs(functions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an exact bucket overflow");
    expect(result.error).toContain("101 functions");
    expect(result.audit.maximumEqualityGroupSize).toBe(101);
  });

  it("fails closed when total projected pairs exceed the hard cap", () => {
    const base = fixtureFunctions().find((item) => item.name === "smallExactA");
    if (base === undefined) throw new Error("missing exact fixture function");
    const functions = Array.from({ length: 11 }, (_, group) =>
      Array.from({ length: 100 }, (_, index): NearDuplicateFunction => {
        const occurrence = group * 100 + index;
        return {
          ...base,
          name: `group${String(group)}copy${String(index)}`,
          startOffset: occurrence * 100,
          endOffset: occurrence * 100 + 50,
          startLine: occurrence * 4 + 1,
          endLine: occurrence * 4 + 3,
          exactTokens: [...base.exactTokens, `group:${String(group)}`],
        };
      }),
    ).flat();
    const result = findExactFunctionClonePairs(functions);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a projected-pair overflow");
    expect(result.error).toContain("50000");
    expect(result.audit.maximumEqualityGroupSize).toBe(100);
    expect(result.audit.projectedPairs).toBeGreaterThan(50_000);
  });

  it("suppresses overlapping same-file occurrences after projection", () => {
    const base = fixtureFunctions().find((item) => item.name === "smallExactA");
    if (base === undefined) throw new Error("missing exact fixture function");
    const result = findExactFunctionClonePairs([
      { ...base, filePath: "scripts/overlap.ts", startOffset: 10, endOffset: 100 },
      {
        ...base,
        filePath: "scripts/overlap.ts",
        name: "nested",
        startOffset: 20,
        endOffset: 90,
      },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.audit.projectedPairs).toBe(1);
    expect(result.audit.postOverlapPairs).toBe(0);
    expect(result.pairs).toEqual([]);
  });
});

describe("occurrence-level tier union", () => {
  it("deduplicates one physical pair found by both tiers", () => {
    const exact = findExactFunctionClonePairs(fixtureFunctions());
    if (!exact.ok) throw new Error(exact.error);
    const pair = exact.pairs.find((candidate) => candidate.left.name === "smallExactA");
    if (pair === undefined) throw new Error("missing exact pair");
    const fuzzy = { ...pair, tiers: ["fuzzy"] as const, primaryTier: "fuzzy" as const };
    const union = unionNearDuplicateOccurrencePairs([fuzzy], [pair]);
    expect(union).toHaveLength(1);
    expect(union[0]?.tiers).toEqual(["exact", "fuzzy"]);
    expect(union[0]?.primaryTier).toBe("exact");
    expect(occurrencePairIdentity(union[0]?.left, union[0]?.right)).toBe(
      occurrencePairIdentity(pair.left, pair.right),
    );
  });
});
