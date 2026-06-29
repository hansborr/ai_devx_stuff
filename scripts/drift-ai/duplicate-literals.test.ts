import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG, parseDriftAiConfig } from "./config.js";
import { extractLiteralShapes, type LiteralShapeExtra } from "./duplicate-literals.js";
import { duplicateLiteralsCheck } from "./duplicate-literals-check.js";
import { groupDuplicateShapes, type ShapeEntry } from "./duplicate-shapes.js";
import { buildSourceExtensions } from "./scope.js";

const tmpRepo = registerTempRootCleanup();

const writeRepo = (files: Record<string, string>): string =>
  tmpRepo.writeRepo(files, "drift-dup-literals-");

const OPTIONS = {
  minLength: 8,
  skipTestTitleStrings: true,
  includeNumbers: false,
  minNumberDigits: 3,
};

function shapesFrom(
  files: Record<string, string>,
  options = OPTIONS,
): ShapeEntry<LiteralShapeExtra>[] {
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractLiteralShapes(filePath, source, options),
  );
}

describe("extractLiteralShapes", () => {
  it("groups a string literal appearing in several distinct files", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": 'const a = "shared-secret-token";',
        "src/b.ts": 'const b = "shared-secret-token";',
        "src/c.ts": 'const c = "shared-secret-token";',
      }),
      { minDistinctFiles: 3 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.distinctFileCount).toBe(3);
  });

  it("excludes a literal that occurs in fewer than N distinct files", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": 'const a = "shared-secret-token";',
        "src/b.ts": 'const b = "shared-secret-token";',
      }),
      { minDistinctFiles: 3 },
    );
    expect(groups).toEqual([]);
  });

  it("skips short strings below the configured min length", () => {
    expect(extractLiteralShapes("src/a.ts", 'const a = "hi";', OPTIONS)).toEqual([]);
  });

  it("reports the true line range for multi-line template literals", () => {
    const shapes = extractLiteralShapes(
      "src/a.ts",
      'const a = `shared\nliteral\nvalue`;\nconst b = "shared literal value";',
      { ...OPTIONS, minLength: 1 },
    );
    const multiline = shapes.find((shape) => shape.extra.value === "shared\nliteral\nvalue");
    const singleLine = shapes.find((shape) => shape.extra.value === "shared literal value");
    expect(multiline).toMatchObject({ startLine: 1, endLine: 3 });
    expect(singleLine).toMatchObject({ startLine: 4, endLine: 4 });
  });

  it("skips numeric literals by default", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": "const a = 2048;",
        "src/b.ts": "const b = 2048;",
        "src/c.ts": "const c = 2048;",
      }),
      { minDistinctFiles: 3 },
    );
    expect(groups).toEqual([]);
  });

  it("filters trivial numeric literals when numbers are enabled", () => {
    const groups = groupDuplicateShapes(
      shapesFrom(
        {
          "src/a.ts": "const a = 0;\nconst b = 5;\nconst c = 2048;\nconst d = 0.65;",
          "src/b.ts": "const a = 0;\nconst b = 5;\nconst c = 2048;\nconst d = 0.65;",
          "src/c.ts": "const a = 0;\nconst b = 5;\nconst c = 2048;\nconst d = 0.65;",
        },
        { ...OPTIONS, includeNumbers: true, minNumberDigits: 3 },
      ),
      { minDistinctFiles: 3 },
    );
    expect(groups.map((group) => group.members[0]?.extra.value).sort()).toEqual(["0.65", "2048"]);
  });

  it("uses numeric source text for the digit floor", () => {
    const groups = groupDuplicateShapes(
      shapesFrom(
        {
          "src/a.ts": "const a = .65;",
          "src/b.ts": "const b = .65;",
          "src/c.ts": "const c = .65;",
        },
        { ...OPTIONS, includeNumbers: true, minNumberDigits: 3 },
      ),
      { minDistinctFiles: 3 },
    );
    expect(groups).toEqual([]);
  });

  it("skips import/require module specifiers", () => {
    const shapes = extractLiteralShapes(
      "src/a.ts",
      'import { x } from "./some-long-module-path";\nconst y = require("another-long-path");',
      OPTIONS,
    );
    expect(shapes).toEqual([]);
  });

  it("skips dynamic import() and import-equals-require module specifiers", () => {
    const shapes = extractLiteralShapes(
      "src/a.ts",
      'const m = import("dynamic-long-package");\nimport Foo = require("equals-long-package");',
      OPTIONS,
    );
    expect(shapes).toEqual([]);
  });

  it("records a negative number as its signed value and does not group -1 with 1", () => {
    const shapes = extractLiteralShapes("src/a.ts", "const a = -1;\nconst b = 1;", {
      minLength: 0,
      skipTestTitleStrings: true,
      includeNumbers: true,
      minNumberDigits: 1,
    });
    const negative = shapes.find((shape) => shape.extra.value === "-1");
    const positive = shapes.find((shape) => shape.extra.value === "1");
    expect(negative).toBeDefined();
    expect(positive).toBeDefined();
    expect(negative?.canonicalKey).not.toBe(positive?.canonicalKey);
    // The inner literal of -1 must not be double-counted as a separate `1` entry.
    expect(shapes.filter((shape) => shape.extra.value === "1")).toHaveLength(1);
  });

  it("groups two negative -1 literals across files but not with positive 1", () => {
    const groups = groupDuplicateShapes(
      shapesFrom(
        {
          "src/a.ts": "const a = -1;",
          "src/b.ts": "const b = -1;",
          "src/c.ts": "const c = 1;",
        },
        { ...OPTIONS, includeNumbers: true, minNumberDigits: 1 },
      ),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.filePath).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("skips test-title strings when configured", () => {
    const shapes = extractLiteralShapes(
      "src/a.ts",
      'describe("the long suite title", () => {});',
      OPTIONS,
    );
    expect(shapes).toEqual([]);
  });

  it("keeps test-title strings when skipTestTitleStrings is false", () => {
    const shapes = extractLiteralShapes("src/a.ts", 'describe("the long suite title", () => {});', {
      minLength: 8,
      skipTestTitleStrings: false,
      includeNumbers: false,
      minNumberDigits: 3,
    });
    expect(shapes).toHaveLength(1);
  });

  it("does not group different literal values", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({
        "src/a.ts": 'const a = "value-one-long";',
        "src/b.ts": 'const b = "value-two-long";',
        "src/c.ts": 'const c = "value-three";',
      }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toEqual([]);
  });
});

describe("duplicate-literals config", () => {
  it("defaults numeric literals off with a digit floor", () => {
    const config = parseDriftAiConfig({});
    expect(config.checks["duplicate-literals"].includeNumbers).toBe(false);
    expect(config.checks["duplicate-literals"].minNumberDigits).toBe(3);
  });

  it("parses the numeric literal knobs", () => {
    const config = parseDriftAiConfig({
      checks: {
        "duplicate-literals": {
          includeNumbers: true,
          minNumberDigits: 4,
        },
      },
    });
    expect(config.checks["duplicate-literals"].includeNumbers).toBe(true);
    expect(config.checks["duplicate-literals"].minNumberDigits).toBe(4);
  });

  it("rejects non-boolean includeNumbers values", () => {
    expect(() =>
      parseDriftAiConfig({
        checks: { "duplicate-literals": { includeNumbers: "yes" } },
      }),
    ).toThrow("must be a boolean");
  });

  it("rejects invalid minNumberDigits values", () => {
    expect(() =>
      parseDriftAiConfig({
        checks: { "duplicate-literals": { minNumberDigits: 0 } },
      }),
    ).toThrow("must be a positive integer");
    expect(() =>
      parseDriftAiConfig({
        checks: { "duplicate-literals": { minNumberDigits: 1.5 } },
      }),
    ).toThrow("must be a positive integer");
  });
});

describe("duplicateLiteralsCheck", () => {
  it("reports a provenance-stamped cross-file literal group from real files", () => {
    const repoRoot = writeRepo({
      "src/a.ts": 'export const a = "https://api.example.com";',
      "src/b.ts": 'export const b = "https://api.example.com";',
      "src/c.ts": 'export const c = "https://api.example.com";',
    });
    const outcome = duplicateLiteralsCheck.runWithSelectedConfig({
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
        cli: parseArgs(["--scope", "current", "--check", "duplicate-literals"]),
        warnStderr: () => undefined,
      },
    });
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const finding = outcome.findings[0];
      expect(finding?.check).toBe("duplicate-literals");
      expect(finding?.provenance).toEqual({ configSource: "drift-baseline", tool: "ts-morph" });
      expect(finding?.details?.["value"]).toBe("https://api.example.com");
    }
  });
});
