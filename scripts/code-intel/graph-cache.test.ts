import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { graphCacheTest } from "./graph-cache.js";

describe("resolveGitDir", () => {
  const longGitdirPaddingLength = 4_000;

  let tempRoot: string;
  let fixtureRepoRoot: string;
  let gitPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-gitdir-"));
    fixtureRepoRoot = path.join(tempRoot, "repo");
    gitPath = path.join(fixtureRepoRoot, ".git");
    mkdirSync(fixtureRepoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function writeGitFile(content: string): void {
    writeFileSync(gitPath, content);
  }

  it("resolves gitfile paths with a separating space", () => {
    writeGitFile("gitdir: ../.git/worktrees/x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../.git/worktrees/x"),
    );
  });

  it("resolves gitfile paths without a separating space", () => {
    writeGitFile("gitdir:../x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../x"),
    );
  });

  it("resolves gitfile paths with a tab separator", () => {
    writeGitFile("gitdir:\t../x\n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBe(
      path.resolve(fixtureRepoRoot, "../x"),
    );
  });

  it("rejects gitfile values split onto the next line", () => {
    writeGitFile("gitdir:\n../x");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBeUndefined();
  });

  it("falls back to no-git for empty gitfile values", () => {
    writeGitFile("gitdir:   \n");

    expect(graphCacheTest.resolveGitDir(fixtureRepoRoot, gitPath)).toBeUndefined();
    expect(graphCacheTest.readGitHead(fixtureRepoRoot)).toBe("no-git");
  });

  it("handles pathological gitfile whitespace without backtracking pressure", () => {
    writeGitFile(`gitdir: ${" ".repeat(longGitdirPaddingLength)}x\ny`);

    expect(graphCacheTest.readGitHead(fixtureRepoRoot)).toBe("no-git");
  });
});
