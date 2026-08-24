import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeWorkspaceManifest, GraphCache, graphCacheTest } from "./graph-cache.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  graphFor,
} from "./test-fixtures.test-helper.js";

describe("GraphCache.ensure", () => {
  it("rebuilds cached state when the manifest fingerprint changes", () => {
    let manifest = "first";
    let rebuildCount = 0;
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/rules/core.ts", "export const core = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const graph = graphFor(project, resolver);
    const cache = new GraphCache("/repo", {
      computeManifest: () => manifest,
      rebuild: () => {
        rebuildCount += 1;
        return { graph, manifest, resolver };
      },
    });
    cache.ensure();
    cache.ensure();
    expect(rebuildCount).toBe(1);
    manifest = "second";
    cache.ensure();
    expect(rebuildCount).toBe(2);
  });
});

describe("computeWorkspaceManifest", () => {
  let tempRoot: string;
  let repoRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), "code-intel-manifest-"));
    repoRoot = path.join(tempRoot, "repo");
    const sourceRoot = path.join(repoRoot, "packages/shared/src/rules");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(path.join(sourceRoot, "mutable.ts"), "export const mutableValue = 1;\n");
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it("fingerprints source contents for same-size edits", () => {
    const target = path.join(repoRoot, "packages/shared/src/rules/mutable.ts");
    const originalStat = statSync(target);
    const before = computeWorkspaceManifest(repoRoot);

    writeFileSync(target, "export const mutableValue = 2;\n");
    utimesSync(target, originalStat.atime, originalStat.mtime);

    expect(computeWorkspaceManifest(repoRoot)).not.toBe(before);
  });
});

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
