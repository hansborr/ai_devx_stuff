import { describe, expect, it } from "vitest";

import {
  buildScopeSourceExtensions,
  DECLARATION_SUFFIXES,
  INVENTORY_TEST_ATTRIBUTION_PATTERN,
  isBroadHistoryTestPath,
  isOrphaningTestPath,
  isRunnableTestPath,
  isSlowRunnableTestPath,
  isTriageTestAdjacentPath,
  orphaningSourceExtensionOf,
  SCOPE_BUILT_IN_SOURCE_EXTENSIONS,
  SOURCE_EXTENSIONS,
  STRICT_TEST_BASENAME_PATTERN,
  TEST_BASENAME_PATTERN,
  TEST_DIR_SEGMENTS,
} from "./path-taxonomy.js";

// Characterization tests: every case below pins behavior transcribed from the
// pre-consolidation private classifiers (see the module header for the source
// of each policy). A failure here means a policy's classification changed —
// which must always be an explicit, separately-decided commit, never fallout.

describe("shared primitives", () => {
  it("orders the full source-extension list with .mts/.cts included", () => {
    expect(SOURCE_EXTENSIONS).toEqual([
      ".tsx",
      ".ts",
      ".mts",
      ".cts",
      ".jsx",
      ".js",
      ".mjs",
      ".cjs",
    ]);
  });

  it("keeps the declaration suffixes and test-dir segment set", () => {
    expect(DECLARATION_SUFFIXES).toEqual([".d.ts", ".d.mts", ".d.cts"]);
    expect([...TEST_DIR_SEGMENTS].sort()).toEqual(
      ["__test__", "__tests__", "e2e", "test", "tests"].sort(),
    );
  });

  it("matches .test/.spec basenames across all module flavors", () => {
    expect(TEST_BASENAME_PATTERN.test("foo.test.ts")).toBe(true);
    expect(TEST_BASENAME_PATTERN.test("foo.spec.mjs")).toBe(true);
    expect(TEST_BASENAME_PATTERN.test("foo.test.cjs")).toBe(true);
    expect(TEST_BASENAME_PATTERN.test("foo.test-helper.ts")).toBe(false);
  });

  it("keeps the strict basename primitive at .test.ts(x) only", () => {
    expect(STRICT_TEST_BASENAME_PATTERN.test("foo.test.ts")).toBe(true);
    expect(STRICT_TEST_BASENAME_PATTERN.test("foo.test.tsx")).toBe(true);
    expect(STRICT_TEST_BASENAME_PATTERN.test("foo.spec.ts")).toBe(false);
    expect(STRICT_TEST_BASENAME_PATTERN.test("foo.test.mjs")).toBe(false);
  });
});

describe("policy: strict runnable-test (code-intel)", () => {
  it("recognizes only .test.ts/.test.tsx", () => {
    expect(isRunnableTestPath("scripts/lib/git.test.ts")).toBe(true);
    expect(isRunnableTestPath("src/App.test.tsx")).toBe(true);
    expect(isRunnableTestPath("src/foo.spec.ts")).toBe(false);
    expect(isRunnableTestPath("src/foo.test.mjs")).toBe(false);
    expect(isRunnableTestPath("src/__tests__/foo.ts")).toBe(false);
    expect(isRunnableTestPath("src/foo.test-helper.ts")).toBe(false);
  });

  it("treats .slow.test files as runnable and slow", () => {
    expect(isRunnableTestPath("src/foo.slow.test.ts")).toBe(true);
    expect(isSlowRunnableTestPath("src/foo.slow.test.ts")).toBe(true);
    expect(isSlowRunnableTestPath("src/foo.slow.test.tsx")).toBe(true);
    expect(isSlowRunnableTestPath("src/foo.test.ts")).toBe(false);
  });
});

describe("policy: orphaning (drift-ai test-orphaning)", () => {
  it("resolves source extensions including .mts/.cts and excludes declarations", () => {
    expect(orphaningSourceExtensionOf("src/foo.ts")).toBe(".ts");
    expect(orphaningSourceExtensionOf("src/foo.tsx")).toBe(".tsx");
    expect(orphaningSourceExtensionOf("src/foo.mts")).toBe(".mts");
    expect(orphaningSourceExtensionOf("src/foo.cts")).toBe(".cts");
    expect(orphaningSourceExtensionOf("src/foo.cjs")).toBe(".cjs");
    expect(orphaningSourceExtensionOf("src/foo.d.ts")).toBeNull();
    expect(orphaningSourceExtensionOf("src/foo.d.mts")).toBeNull();
    expect(orphaningSourceExtensionOf("docs/readme.md")).toBeNull();
    expect(orphaningSourceExtensionOf("config.json")).toBeNull();
  });

  it("classifies test basenames and exact test-dir segments", () => {
    expect(isOrphaningTestPath("src/foo.test.ts")).toBe(true);
    expect(isOrphaningTestPath("src/foo.spec.tsx")).toBe(true);
    expect(isOrphaningTestPath("src/foo.test.mjs")).toBe(true);
    expect(isOrphaningTestPath("src/__tests__/foo.ts")).toBe(true);
    expect(isOrphaningTestPath("src/__test__/foo.ts")).toBe(true);
    expect(isOrphaningTestPath("packages/server/test/foo.ts")).toBe(true);
    expect(isOrphaningTestPath("tests/foo.ts")).toBe(true);
    expect(isOrphaningTestPath("e2e/pages/foo.ts")).toBe(true);
  });

  it("does not sweep in near-miss segments or helper suffixes", () => {
    expect(isOrphaningTestPath("src/latest/foo.ts")).toBe(false);
    expect(isOrphaningTestPath("src/tests-helpers/foo.ts")).toBe(false);
    expect(isOrphaningTestPath("fixtures/foo.ts")).toBe(false);
    expect(isOrphaningTestPath("src/test-support/foo.ts")).toBe(false);
    expect(isOrphaningTestPath("src/foo.test-helper.ts")).toBe(false);
    expect(isOrphaningTestPath("src/__mocks__/foo.ts")).toBe(false);
  });
});

describe("policy: triage test-adjacent (drift-triage)", () => {
  it("matches test/spec/helper basenames across any extension", () => {
    expect(isTriageTestAdjacentPath("src/foo.test.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/foo.spec.md")).toBe(true);
    expect(isTriageTestAdjacentPath("src/foo.test-helper.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/foo.spec-helper.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/foo-test-helper.ts")).toBe(true);
  });

  it("matches its broader test-adjacent directory set", () => {
    expect(isTriageTestAdjacentPath("fixtures/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/test-support/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("examples/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/test/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/tests/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("e2e/pages/foo.ts")).toBe(true);
    expect(isTriageTestAdjacentPath("src/__tests__/foo.ts")).toBe(true);
  });

  it("preserves triage's divergences: no __test__, no __mocks__", () => {
    expect(isTriageTestAdjacentPath("src/__test__/foo.ts")).toBe(false);
    expect(isTriageTestAdjacentPath("src/__mocks__/foo.ts")).toBe(false);
    expect(isTriageTestAdjacentPath("src/latest/foo.ts")).toBe(false);
    expect(isTriageTestAdjacentPath("src/protest.ts")).toBe(false);
  });
});

describe("policy: broad history heuristic (drift-ai thrash)", () => {
  it("matches a delimited test/spec token anywhere, case-insensitively", () => {
    expect(isBroadHistoryTestPath("src/foo.test.ts")).toBe(true);
    expect(isBroadHistoryTestPath("foo.spec.js")).toBe(true);
    expect(isBroadHistoryTestPath("test/foo.ts")).toBe(true);
    expect(isBroadHistoryTestPath("src/test_utils.ts")).toBe(true);
    expect(isBroadHistoryTestPath("src/test-support/helper.ts")).toBe(true);
    expect(isBroadHistoryTestPath("SRC/TEST/FOO.TS")).toBe(true);
    expect(isBroadHistoryTestPath("deleted/long-gone.spec.jsx")).toBe(true);
  });

  it("requires token delimiters", () => {
    expect(isBroadHistoryTestPath("src/latest.ts")).toBe(false);
    expect(isBroadHistoryTestPath("src/attest.ts")).toBe(false);
    expect(isBroadHistoryTestPath("src/testing/foo.ts")).toBe(false);
    expect(isBroadHistoryTestPath("src/contest/foo.ts")).toBe(false);
  });
});

describe("policy: inventory test-attribution (drift-ai class-construction)", () => {
  it("matches test/spec basenames plus mocks and fixtures directories", () => {
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/foo.test.ts")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/foo.spec.jsx")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/foo.test.cjs")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/__tests__/foo.ts")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/__mocks__/foo.ts")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/__fixtures__/foo.ts")).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("fixtures/foo.ts")).toBe(true);
  });

  it("does not recognize bare test dirs, e2e, or helper suffixes", () => {
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/test/foo.ts")).toBe(false);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("tests/foo.ts")).toBe(false);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("e2e/foo.ts")).toBe(false);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test("src/foo.test-helper.ts")).toBe(false);
  });
});

describe("scope-model source extensions (drift-ai scope)", () => {
  it("pins the built-in set at six entries — the .mts/.cts gap is documented drift", () => {
    expect([...SCOPE_BUILT_IN_SOURCE_EXTENSIONS].sort()).toEqual(
      [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].sort(),
    );
    expect(SCOPE_BUILT_IN_SOURCE_EXTENSIONS.has(".mts")).toBe(false);
    expect(SCOPE_BUILT_IN_SOURCE_EXTENSIONS.has(".cts")).toBe(false);
  });

  it("normalizes configured additions: trim, lowercase, leading dot", () => {
    const extensions = buildScopeSourceExtensions(["mts", " .CTS ", "vue"]);
    expect(extensions.has(".mts")).toBe(true);
    expect(extensions.has(".cts")).toBe(true);
    expect(extensions.has(".vue")).toBe(true);
    for (const builtIn of SCOPE_BUILT_IN_SOURCE_EXTENSIONS) {
      expect(extensions.has(builtIn)).toBe(true);
    }
  });

  it("drops empty and dot-only additions and never mutates the built-ins", () => {
    const extensions = buildScopeSourceExtensions(["", "  ", "."]);
    expect([...extensions].sort()).toEqual([...SCOPE_BUILT_IN_SOURCE_EXTENSIONS].sort());
    const withAddition = buildScopeSourceExtensions(["x"]);
    expect(withAddition.has(".x")).toBe(true);
    expect(SCOPE_BUILT_IN_SOURCE_EXTENSIONS.has(".x")).toBe(false);
  });
});

describe("cross-policy divergence (deliberate, per the module contract)", () => {
  it("foo.spec.ts is a test to orphaning/triage/thrash/inventory but not to strict", () => {
    const path = "src/foo.spec.ts";
    expect(isOrphaningTestPath(path)).toBe(true);
    expect(isTriageTestAdjacentPath(path)).toBe(true);
    expect(isBroadHistoryTestPath(path)).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test(path)).toBe(true);
    expect(isRunnableTestPath(path)).toBe(false);
  });

  it("fixtures/x.ts is test-adjacent to triage/inventory but source to orphaning", () => {
    const path = "fixtures/x.ts";
    expect(isTriageTestAdjacentPath(path)).toBe(true);
    expect(INVENTORY_TEST_ATTRIBUTION_PATTERN.test(path)).toBe(true);
    expect(isOrphaningTestPath(path)).toBe(false);
    expect(isBroadHistoryTestPath(path)).toBe(false);
  });

  it("foo.mts is orphaning source but invisible to scope built-ins", () => {
    expect(orphaningSourceExtensionOf("src/foo.mts")).toBe(".mts");
    expect(SCOPE_BUILT_IN_SOURCE_EXTENSIONS.has(".mts")).toBe(false);
  });
});
