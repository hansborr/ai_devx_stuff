import { readFileSync } from "node:fs";
import path from "node:path";

import { ts } from "ts-morph";
import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { CheckRunContext } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import {
  buildDuplicateShapeFindings,
  collectShapeEntries,
  type DuplicateShapeExtractor,
  type DuplicateShapeServices,
  groupDuplicateShapes,
  resolveDuplicateShapeServices,
  runDuplicateShapeCheck,
  type ShapeEntry,
} from "./duplicate-shapes.js";
import { createParsedSourceFileCache, type ParsedSourceFileCache } from "./parsed-source-cache.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile, DriftCheckId, FindingProvenance } from "./types.js";

const PROVENANCE: FindingProvenance = { configSource: "drift-baseline", tool: "ts-morph" };
type TestShapeExtra = undefined;

const tmpRepo = registerTempRootCleanup();

const writeRepo = (files: Record<string, string>): string =>
  tmpRepo.writeRepo(files, "drift-dup-shapes-");

// A trivial line-based extractor for exercising the core independent of any AST
// extractor: every non-empty trimmed line becomes a shape entry keyed by its text.
const lineExtractor: DuplicateShapeExtractor<TestShapeExtra> = (filePath, source) => {
  const entries: ShapeEntry<TestShapeExtra>[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const text = (lines[index] ?? "").trim();
    if (text.length === 0) continue;
    entries.push({
      canonicalKey: text,
      label: text,
      filePath,
      startLine: index + 1,
      endLine: index + 1,
      extra: undefined,
    });
  }
  return entries;
};

function testEntry(entry: Omit<ShapeEntry<TestShapeExtra>, "extra">): ShapeEntry<TestShapeExtra> {
  return { ...entry, extra: undefined };
}

describe("groupDuplicateShapes", () => {
  it("groups identical canonical keys across distinct files", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({ canonicalKey: "A", label: "A", filePath: "src/a.ts", startLine: 1, endLine: 1 }),
      testEntry({ canonicalKey: "A", label: "A", filePath: "src/b.ts", startLine: 5, endLine: 5 }),
      testEntry({ canonicalKey: "B", label: "B", filePath: "src/a.ts", startLine: 2, endLine: 2 }),
    ];
    const groups = groupDuplicateShapes(entries, { minDistinctFiles: 2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
    expect(groups[0]?.distinctFileCount).toBe(2);
  });

  it("excludes single-file repeats when minDistinctFiles is 2", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({ canonicalKey: "A", label: "A", filePath: "src/a.ts", startLine: 1, endLine: 1 }),
      testEntry({ canonicalKey: "A", label: "A", filePath: "src/a.ts", startLine: 9, endLine: 9 }),
    ];
    expect(groupDuplicateShapes(entries, { minDistinctFiles: 2 })).toEqual([]);
  });

  it("assigns the same hash to entries with the same canonical key", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({
        canonicalKey: "shared",
        label: "x",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 1,
      }),
      testEntry({
        canonicalKey: "shared",
        label: "y",
        filePath: "src/b.ts",
        startLine: 1,
        endLine: 1,
      }),
    ];
    const groups = groupDuplicateShapes(entries, { minDistinctFiles: 2 });
    expect(groups[0]?.hash).toMatch(/^[0-9a-z]+$/u);
  });
});

describe("buildDuplicateShapeFindings", () => {
  it("emits one finding per group with related members, hash, and provenance", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 4,
      }),
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/b.ts",
        startLine: 5,
        endLine: 8,
      }),
    ];
    const groups = groupDuplicateShapes(entries, { minDistinctFiles: 2 });
    const findings = buildDuplicateShapeFindings(groups, {
      check: "duplicate-types",
      detectorScope: { scopeMode: "current", files: [] },
      provenance: PROVENANCE,
      messageForGroup: (group) => `duplicate shape across ${String(group.distinctFileCount)} files`,
      hint: "extract a shared type",
      detailsForGroup: () => ({ kind: "shape" }),
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding).toMatchObject({
      check: "duplicate-types",
      file: "src/a.ts:1-4",
      relatedFiles: ["src/b.ts:5-8"],
      provenance: PROVENANCE,
      details: { groupHash: groups[0]?.hash, memberCount: 2, kind: "shape" },
    });
  });

  it("intersects groups with the changed set in changed scope", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 4,
      }),
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/b.ts",
        startLine: 5,
        endLine: 8,
      }),
    ];
    const groups = groupDuplicateShapes(entries, { minDistinctFiles: 2 });
    const changed: readonly ChangedFile[] = [{ path: "src/b.ts", status: "modified" }];
    const findings = buildDuplicateShapeFindings(groups, {
      check: "duplicate-types",
      detectorScope: { scopeMode: "changed", files: changed.map(toChangedScopeFile) },
      provenance: PROVENANCE,
      messageForGroup: () => "dup",
      hint: "h",
      detailsForGroup: () => ({}),
    });
    expect(findings).toHaveLength(1);
    // primary should prefer the changed member
    expect(findings[0]?.file).toBe("src/b.ts:5-8");
  });

  it("drops groups that touch no changed file in changed scope", () => {
    const entries: ShapeEntry<TestShapeExtra>[] = [
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 4,
      }),
      testEntry({
        canonicalKey: "A",
        label: "Dto",
        filePath: "src/b.ts",
        startLine: 5,
        endLine: 8,
      }),
    ];
    const groups = groupDuplicateShapes(entries, { minDistinctFiles: 2 });
    const findings = buildDuplicateShapeFindings(groups, {
      check: "duplicate-types",
      detectorScope: {
        scopeMode: "changed",
        files: [toChangedScopeFile({ path: "src/other.ts", status: "modified" })],
      },
      provenance: PROVENANCE,
      messageForGroup: () => "dup",
      hint: "h",
      detailsForGroup: () => ({}),
    });
    expect(findings).toEqual([]);
  });
});

describe("collectShapeEntries (file walk integration)", () => {
  it("walks roots, parses each file, and runs the extractor while honoring ignore/excludeGlobs", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "alpha\nbeta\n",
      "src/a.test.ts": "alpha\n",
      "node_modules/pkg/index.ts": "alpha\n",
    });
    const entries = collectShapeEntries({
      repoRoot,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
      excludeGlobs: ["**/*.test.ts"],
      extract: lineExtractor,
    });
    expect(entries.map((entry) => entry.filePath)).toEqual(["src/a.ts", "src/a.ts"]);
  });
});

type TestRunCtxOptions = {
  readonly parsedSourceCache?: ParsedSourceFileCache;
};

function makeRunCtx(
  repoRoot: string,
  options: TestRunCtxOptions = {},
): CheckRunContext<DuplicateShapeServices> {
  return {
    detectorScope: { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot,
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: ["src"],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: () => undefined,
    services:
      options.parsedSourceCache === undefined
        ? {}
        : { parsedSourceCache: options.parsedSourceCache },
  };
}

type CountingSourceCache = {
  readonly cache: ParsedSourceFileCache;
  readonly readPaths: readonly string[];
  readonly parsePaths: readonly string[];
};

function createCountingSourceCache(repoRoot: string): CountingSourceCache {
  const readPaths: string[] = [];
  const parsePaths: string[] = [];
  return {
    cache: createParsedSourceFileCache({
      readFile: (absolutePath) => {
        readPaths.push(path.relative(repoRoot, absolutePath).split(path.sep).join("/"));
        return readFileSync(absolutePath, "utf8");
      },
      parseSourceFile: (filePath, source) => {
        parsePaths.push(filePath);
        return ts.createSourceFile(
          filePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        );
      },
    }),
    readPaths,
    parsePaths,
  };
}

function runLineDuplicateCheck(
  ctx: CheckRunContext<DuplicateShapeServices>,
  check: DriftCheckId,
  options: {
    readonly excludeGlobs?: readonly string[];
    readonly seenFiles?: string[];
  } = {},
): void {
  runDuplicateShapeCheck(ctx, {
    check,
    extract: (filePath, source, sourceFile) => {
      options.seenFiles?.push(filePath);
      return lineExtractor(filePath, source, sourceFile);
    },
    minDistinctFiles: 2,
    configExcludeGlobs: options.excludeGlobs ?? [],
    messageForGroup: () => "duplicate line shape",
    hint: "h",
    detailsForGroup: () => ({}),
  });
}

describe("runDuplicateShapeCheck shared parsed source cache", () => {
  it("resolves one cache instance for duplicate checks in the same report", () => {
    const reportCache = new Map<string, unknown>();
    const env = {
      repoRoot: "/repo/target",
      overrides: {},
      cli: parseArgs(["--scope", "current", "--check", "duplicate-types"]),
      reportCache,
      warnStderr: () => undefined,
    };

    expect(resolveDuplicateShapeServices(env).parsedSourceCache).toBe(
      resolveDuplicateShapeServices(env).parsedSourceCache,
    );
  });

  it("reads and parses each file once across two selected duplicate-shape checks", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "shared\n",
      "src/b.ts": "shared\n",
    });
    const sourceCache = createCountingSourceCache(repoRoot);
    const ctx = makeRunCtx(repoRoot, { parsedSourceCache: sourceCache.cache });

    runLineDuplicateCheck(ctx, "duplicate-types");
    runLineDuplicateCheck(ctx, "duplicate-schemas");

    expect(sourceCache.readPaths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(sourceCache.parsePaths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("applies each check's excludeGlobs after shared collection", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "shared\n",
      "src/b.ts": "shared\n",
      "src/skip/a.ts": "shared\n",
    });
    const sourceCache = createCountingSourceCache(repoRoot);
    const ctx = makeRunCtx(repoRoot, { parsedSourceCache: sourceCache.cache });
    const typeFiles: string[] = [];
    const schemaFiles: string[] = [];

    runLineDuplicateCheck(ctx, "duplicate-types", {
      excludeGlobs: ["src/skip"],
      seenFiles: typeFiles,
    });
    runLineDuplicateCheck(ctx, "duplicate-schemas", { seenFiles: schemaFiles });

    expect(sourceCache.readPaths).toEqual(["src/a.ts", "src/b.ts", "src/skip/a.ts"]);
    expect(sourceCache.parsePaths).toEqual(["src/a.ts", "src/b.ts", "src/skip/a.ts"]);
    expect(typeFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(schemaFiles).toEqual(["src/a.ts", "src/b.ts", "src/skip/a.ts"]);
  });
});
