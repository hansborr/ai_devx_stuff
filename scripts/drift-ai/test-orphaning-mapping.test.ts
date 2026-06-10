import { describe, expect, it } from "vitest";

import {
  expandMappingPatterns,
  isTestPath,
  parseSourceParts,
  sourceExtensionOf,
} from "./test-orphaning-mapping.js";
import { DEFAULT_TEST_MAPPING_PATTERNS } from "./test-orphaning-types.js";

describe("sourceExtensionOf", () => {
  it("recognizes code extensions and excludes declaration files", () => {
    expect(sourceExtensionOf("src/foo.ts")).toBe(".ts");
    expect(sourceExtensionOf("src/foo.tsx")).toBe(".tsx");
    expect(sourceExtensionOf("src/foo.mts")).toBe(".mts");
    expect(sourceExtensionOf("src/foo.cjs")).toBe(".cjs");
    expect(sourceExtensionOf("src/foo.d.ts")).toBeNull();
    expect(sourceExtensionOf("docs/readme.md")).toBeNull();
    expect(sourceExtensionOf("config.json")).toBeNull();
  });
});

describe("isTestPath", () => {
  it("classifies sibling test/spec files", () => {
    expect(isTestPath("src/foo.test.ts")).toBe(true);
    expect(isTestPath("src/foo.spec.tsx")).toBe(true);
    expect(isTestPath("src/foo.test.mjs")).toBe(true);
    expect(isTestPath("src/foo.ts")).toBe(false);
  });

  it("classifies files inside test directories by exact segment", () => {
    expect(isTestPath("src/__tests__/foo.ts")).toBe(true);
    expect(isTestPath("packages/server/test/foo.ts")).toBe(true);
    expect(isTestPath("e2e/pages/foo.ts")).toBe(true);
    // exact segment match: a feature dir whose name merely contains "test" is not a test
    expect(isTestPath("src/latest/foo.ts")).toBe(false);
    expect(isTestPath("src/tests-helpers/foo.ts")).toBe(false);
  });
});

describe("parseSourceParts", () => {
  it("splits a nested source path into dir, name, and ext", () => {
    expect(parseSourceParts("packages/server/src/services/foo.ts")).toEqual({
      dir: "packages/server/src/services",
      name: "foo",
      ext: ".ts",
    });
  });

  it("handles a repo-root file with an empty dir", () => {
    expect(parseSourceParts("foo.ts")).toEqual({ dir: "", name: "foo", ext: ".ts" });
  });

  it("keeps compound stems intact", () => {
    expect(parseSourceParts("src/foo.config.ts")).toEqual({
      dir: "src",
      name: "foo.config",
      ext: ".ts",
    });
  });

  it("rejects tests, declarations, and non-code paths", () => {
    expect(parseSourceParts("src/foo.test.ts")).toBeNull();
    expect(parseSourceParts("src/__tests__/foo.ts")).toBeNull();
    expect(parseSourceParts("src/foo.d.ts")).toBeNull();
    expect(parseSourceParts("docs/readme.md")).toBeNull();
  });
});

describe("expandMappingPatterns", () => {
  it("expands sibling and __tests__ default templates", () => {
    const parts = parseSourceParts("src/services/foo.ts");
    expect(parts).not.toBeNull();
    const candidates = expandMappingPatterns(parts!, DEFAULT_TEST_MAPPING_PATTERNS);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "src/services/foo.test.ts",
      "src/services/foo.spec.ts",
      "src/services/__tests__/foo.test.ts",
      "src/services/__tests__/foo.spec.ts",
      "src/services/__tests__/foo.ts",
    ]);
    expect(candidates[0]?.pattern).toBe("{dir}/{name}.test{ext}");
  });

  it("collapses the empty-dir slash for a repo-root source", () => {
    const parts = parseSourceParts("foo.ts");
    expect(parts).not.toBeNull();
    const candidates = expandMappingPatterns(parts!, DEFAULT_TEST_MAPPING_PATTERNS);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "foo.test.ts",
      "foo.spec.ts",
      "__tests__/foo.test.ts",
      "__tests__/foo.spec.ts",
      "__tests__/foo.ts",
    ]);
  });

  it("deduplicates candidates and never maps a source to itself", () => {
    const parts = parseSourceParts("src/foo.ts");
    expect(parts).not.toBeNull();
    const candidates = expandMappingPatterns(parts!, [
      "{dir}/{name}.test{ext}",
      "{dir}/{name}.test{ext}",
      "{dir}/{name}{ext}",
    ]);
    expect(candidates.map((candidate) => candidate.path)).toEqual(["src/foo.test.ts"]);
  });
});
