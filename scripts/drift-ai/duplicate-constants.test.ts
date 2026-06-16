import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG, parseDriftAiConfig } from "./config.js";
import { type ConstantShapeExtra, extractConstantShapes } from "./duplicate-constants.js";
import { duplicateConstantsCheck } from "./duplicate-constants-check.js";
import { groupDuplicateShapes, type ShapeEntry } from "./duplicate-shapes.js";
import { buildSourceExtensions } from "./scope.js";

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-dup-constants-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

function shapesFrom(files: Record<string, string>): ShapeEntry<ConstantShapeExtra>[] {
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractConstantShapes(filePath, source, { minLength: 8, minNumberDigits: 3 }),
  );
}

describe("extractConstantShapes", () => {
  it("groups module-level consts holding the same value across files, keyed by value", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": "export const REQUEST_TIMEOUT_MS = 30000;",
        "src/b.ts": "const HTTP_DEADLINE = 30000;",
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "HTTP_DEADLINE",
      "REQUEST_TIMEOUT_MS",
    ]);
  });

  it("does not group consts with different values", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": "export const A = 30000;",
        "src/b.ts": "export const B = 60000;",
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toEqual([]);
  });

  it("ignores non-module-level consts and non-literal initializers", () => {
    const shapes = extractConstantShapes(
      "src/a.ts",
      "function f() {\n  const LOCAL = 30000;\n}\nexport const COMPUTED = f();",
      { minLength: 8, minNumberDigits: 3 },
    );
    expect(shapes).toEqual([]);
  });

  it("skips short string-valued consts below the min length", () => {
    expect(
      extractConstantShapes("src/a.ts", 'export const X = "hi";', {
        minLength: 8,
        minNumberDigits: 3,
      }),
    ).toEqual([]);
  });

  it("reports the true line range for a multi-line template literal const", () => {
    const shapes = extractConstantShapes(
      "src/a.ts",
      "export const MESSAGE = `first\nsecond\nthird`;",
      { minLength: 1, minNumberDigits: 3 },
    );
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it("skips numeric consts below the configured digit floor", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": "export const TWO = 2;",
        "src/b.ts": "export const HALF_DIVISOR = 2;",
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toEqual([]);
  });

  it("groups non-trivial numeric consts above the digit floor", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": "export const BUFFER_LIMIT = 2048;",
        "src/b.ts": "export const READ_LIMIT = 2048;",
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "BUFFER_LIMIT",
      "READ_LIMIT",
    ]);
  });
});

describe("duplicate-constants config", () => {
  it("defaults to a numeric digit floor", () => {
    const config = parseDriftAiConfig({});
    expect(config.checks["duplicate-constants"].minNumberDigits).toBe(3);
  });

  it("parses the numeric constant digit floor", () => {
    const config = parseDriftAiConfig({
      checks: { "duplicate-constants": { minNumberDigits: 4 } },
    });
    expect(config.checks["duplicate-constants"].minNumberDigits).toBe(4);
  });

  it("rejects invalid minNumberDigits values", () => {
    expect(() =>
      parseDriftAiConfig({
        checks: { "duplicate-constants": { minNumberDigits: 0 } },
      }),
    ).toThrow("must be a positive integer");
    expect(() =>
      parseDriftAiConfig({
        checks: { "duplicate-constants": { minNumberDigits: 1.5 } },
      }),
    ).toThrow("must be a positive integer");
  });
});

describe("duplicateConstantsCheck", () => {
  it("is opt-in because it scans the whole project", () => {
    expect(duplicateConstantsCheck.runByDefault).toBe(false);
  });

  it("reports a provenance-stamped duplicate-constant group with const names", () => {
    const repoRoot = writeRepo({
      "src/a.ts":
        "export const REQUEST_TIMEOUT_MS = 30000;\nexport const RETRY_TIMEOUT_MS = 30000;",
      "src/b.ts": "export const HTTP_DEADLINE = 30000;",
    });
    const outcome = duplicateConstantsCheck.runWithSelectedConfig({
      detectorScope: { scopeMode: "current", files: [] },
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
        cli: parseArgs(["--scope", "current", "--check", "duplicate-constants"]),
        warnStderr: () => undefined,
      },
    });
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const finding = outcome.findings[0];
      expect(finding?.check).toBe("duplicate-constants");
      expect(finding?.message).toContain("3 constants across 2 files share the value 30000");
      expect(finding?.provenance).toEqual({ configSource: "drift-baseline", tool: "ts-morph" });
      expect(finding?.details?.["constNames"]).toEqual([
        "REQUEST_TIMEOUT_MS",
        "RETRY_TIMEOUT_MS",
        "HTTP_DEADLINE",
      ]);
      expect(finding?.details?.["value"]).toBe("30000");
    }
  });
});
