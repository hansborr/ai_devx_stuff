import path from "node:path";

import { describe, expect, it } from "vitest";

import { isWholeRepoRoots, toPosix } from "./path-util.js";

describe("toPosix", () => {
  it("normalizes backslash separators", () => {
    expect(toPosix(String.raw`a\b\c`)).toBe("a/b/c");
  });

  it("strips leading ./ segments", () => {
    expect(toPosix("./a/b")).toBe("a/b");
    expect(toPosix("././a/b")).toBe("a/b");
  });

  it("strips trailing slashes except for the filesystem root", () => {
    expect(toPosix("a/b/")).toBe("a/b");
    expect(toPosix("/")).toBe("/");
  });

  it("normalizes native path separators", () => {
    expect(toPosix(["a", "b", "c"].join(path.sep))).toBe("a/b/c");
  });
});

describe("isWholeRepoRoots", () => {
  it("treats omitted or repo-root current roots as the whole repository", () => {
    expect(isWholeRepoRoots([])).toBe(true);
    expect(isWholeRepoRoots(["."])).toBe(true);
  });

  it("uses broad current-scope semantics when repo root is mixed with narrower roots", () => {
    expect(isWholeRepoRoots(["src", "."])).toBe(true);
  });

  it("treats only narrowed roots as less than the whole repository", () => {
    expect(isWholeRepoRoots(["src"])).toBe(false);
    expect(isWholeRepoRoots(["packages/server/src", "scripts"])).toBe(false);
  });
});
