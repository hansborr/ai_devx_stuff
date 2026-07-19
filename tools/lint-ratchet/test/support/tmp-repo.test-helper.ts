import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

// Shared temp-repo scaffold for the package test suites. Every test that needs
// a working directory previously hand-rolled the same lifecycle: a module-level
// string[] of roots, a drain hook, and a writeRepo/makeRepo builder calling
// mkdtempSync + mkdirSync/writeFileSync. This helper centralizes the mkdtempSync
// build and the rmSync(..., { recursive: true, force: true }) cleanup so a
// future leak fix or git-init-flag change is a single edit, and standardizes the
// defensive `root !== undefined` drain guard.
//
// afterEach-registration-scope trap: vitest requires afterEach to be registered
// at collection/module scope, but the builders are called inside it() bodies.
// So a test file calls registerTempRootCleanup() ONCE at collection scope to get
// a handle, then uses the handle's builders inside its tests. The hook is never
// self-registered from inside a per-call builder. afterEach remains the default;
// pass afterAll for suite-lifetime fixtures built in beforeAll.

export interface TempRepoHandle {
  /** mkdtempSync a unique tracked dir and write the given relative files into it. */
  writeRepo(files: Record<string, string>, prefix?: string): string;
  /** mkdtempSync a unique tracked dir with no files. */
  makeTempRepo(prefix?: string): string;
  /** mkdirSync the parent then writeFileSync a single file under an existing root. */
  writeRepoFile(root: string, rel: string, contents: string): void;
  /** mkdtempSync a unique tracked dir and `git init -q` it. */
  makeTmpGitRepo(prefix?: string): string;
  /** The tracked roots, exposed for tests that need to assert on cleanup. */
  readonly roots: readonly string[];
}

const DEFAULT_PREFIX = "lint-ratchet-tmp-repo-";
type CleanupHook = (cleanup: () => void) => void;

export function registerTempRootCleanup(registerCleanup: CleanupHook = afterEach): TempRepoHandle {
  const tempRoots: string[] = [];

  registerCleanup(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRepo(prefix: string = DEFAULT_PREFIX): string {
    const root = mkdtempSync(path.join(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
  }

  function writeRepoFile(root: string, rel: string, contents: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }

  function writeRepo(files: Record<string, string>, prefix: string = DEFAULT_PREFIX): string {
    const root = makeTempRepo(prefix);
    for (const [rel, source] of Object.entries(files)) {
      writeRepoFile(root, rel, source);
    }
    return root;
  }

  function makeTmpGitRepo(prefix: string = DEFAULT_PREFIX): string {
    const root = makeTempRepo(prefix);
    execFileSync("git", ["init", "-q"], { cwd: root });
    return root;
  }

  return { writeRepo, makeTempRepo, writeRepoFile, makeTmpGitRepo, roots: tempRoots };
}
