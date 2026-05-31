import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { groupDuplicateShapes } from "./duplicate-shapes.js";
import { extractTypeShapes } from "./duplicate-types.js";
import { duplicateTypesCheck } from "./duplicate-types-check.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile } from "./types.js";

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-dup-types-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

function shapesFrom(files: Record<string, string>) {
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractTypeShapes(filePath, source, { minProps: 3 }),
  );
}

const ORDER_DTO = `
export interface Order {
  id: string;
  total: number;
  customerId: string;
}
`;

// Same three props as ORDER_DTO, declared as a type alias in a DIFFERENT order.
const ORDER_DTO_REORDERED = `
export type OrderRecord = {
  customerId: string;
  id: string;
  total: number;
};
`;

const NEAR_MISS = `
export interface OrderSummary {
  id: string;
  total: number;
  status: string;
}
`;

const TWO_PROP = `
export interface Pair {
  left: number;
  right: number;
}
`;

// Identical local members to ORDER_DTO but with an `extends` heritage clause.
const ORDER_DTO_EXTENDS_BASE = `
export interface OrderWithBase extends BaseEntity {
  id: string;
  total: number;
  customerId: string;
}
`;

// Same `extends BaseEntity` and same local members as ORDER_DTO_EXTENDS_BASE.
const ORDER_DTO_EXTENDS_BASE_TWIN = `
export interface OrderTwin extends BaseEntity {
  customerId: string;
  id: string;
  total: number;
}
`;

describe("extractTypeShapes", () => {
  it("groups two-agent duplicate DTOs across files even when prop order differs", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": ORDER_DTO, "src/b.ts": ORDER_DTO_REORDERED }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "Order",
      "OrderRecord",
    ]);
  });

  it("does not group a near-miss shape with a different prop", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": ORDER_DTO, "src/b.ts": NEAR_MISS }),
      {
        minDistinctFiles: 2,
      },
    );
    expect(groups).toEqual([]);
  });

  it("skips shapes below the minimum prop count", () => {
    expect(extractTypeShapes("src/pair.ts", TWO_PROP, { minProps: 3 })).toEqual([]);
  });

  it("emits a canonical key combining prop name and type text", () => {
    const shapes = extractTypeShapes("src/a.ts", ORDER_DTO, { minProps: 3 });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.canonicalKey).toContain("customerId");
    expect(shapes[0]?.extra.propCount).toBe(3);
  });

  it("does not group interfaces with identical local members but different heritage", () => {
    // ORDER_DTO has no heritage; ORDER_DTO_EXTENDS_BASE extends BaseEntity. Same
    // local members, but the heritage differs, so they must NOT group.
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": ORDER_DTO, "src/b.ts": ORDER_DTO_EXTENDS_BASE }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toEqual([]);
  });

  it("groups interfaces with identical heritage and identical local members", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": ORDER_DTO_EXTENDS_BASE,
        "src/b.ts": ORDER_DTO_EXTENDS_BASE_TWIN,
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "OrderTwin",
      "OrderWithBase",
    ]);
  });
});

type CtxOverrides = { readonly detectorScope?: DetectorScope };

function makeCtx(repoRoot: string, overrides: CtxOverrides = {}): CheckRunInput {
  return {
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot,
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: ["src"],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: () => undefined,
    env: {
      repoRoot,
      overrides: {},
      cli: parseArgs(["--scope", "current", "--check", "duplicate-types"]),
    },
  };
}

function changedScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

describe("duplicateTypesCheck", () => {
  it("is opt-in because it scans the whole project", () => {
    expect(duplicateTypesCheck.runByDefault).toBe(false);
  });

  it("reports a provenance-stamped duplicate-type group from real files", () => {
    const repoRoot = writeRepo({ "src/a.ts": ORDER_DTO, "src/b.ts": ORDER_DTO_REORDERED });
    const outcome = duplicateTypesCheck.runWithSelectedConfig(makeCtx(repoRoot));
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const finding = outcome.findings[0];
      expect(finding?.check).toBe("duplicate-types");
      expect(finding?.provenance).toEqual({ configSource: "drift-baseline", tool: "ts-morph" });
      expect(finding?.relatedFiles).toHaveLength(1);
      expect(finding?.details?.["propCount"]).toBe(3);
    }
  });

  it("only reports groups touching the changed set in changed scope", () => {
    const repoRoot = writeRepo({ "src/a.ts": ORDER_DTO, "src/b.ts": ORDER_DTO_REORDERED });
    const outcome = duplicateTypesCheck.runWithSelectedConfig(
      makeCtx(repoRoot, {
        detectorScope: changedScope([{ path: "src/c.ts", status: "modified" }]),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") expect(outcome.findings).toEqual([]);
  });

  it("surfaces a group spanning a *.test.ts file with the test member present (no silent content exclusion)", () => {
    const repoRoot = writeRepo({ "src/a.ts": ORDER_DTO, "src/a.test.ts": ORDER_DTO_REORDERED });
    const outcome = duplicateTypesCheck.runWithSelectedConfig(makeCtx(repoRoot));
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const locations = [
        outcome.findings[0]?.file,
        ...(outcome.findings[0]?.relatedFiles ?? []),
      ].join(" ");
      expect(locations).toContain("src/a.test.ts");
    }
  });
});
