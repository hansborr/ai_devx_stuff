import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";

import {
  defaultGitRunner,
  readFirstParentCommit,
  readGitBlobAtRef,
  readGitDir,
  readRepoRoot,
} from "./lib/git.js";
import {
  type NearDuplicateBaselineEntry,
  readNearDuplicatesBaseline,
} from "./sensor-near-duplicates-baseline.js";

export function readNearDuplicatesBaselineFile(
  path: string,
): ParseResult<readonly NearDuplicateBaselineEntry[]> {
  if (!existsSync(path)) return { ok: false, error: `baseline missing at ${path}` };
  return readNearDuplicatesBaseline(readFileSync(path, "utf8"));
}

export function readHeadNearDuplicatesBaseline(
  cwd: string,
  baselinePath: string,
): ParseResult<readonly NearDuplicateBaselineEntry[]> {
  try {
    const git = defaultGitRunner({ cwd });
    const repoRoot = readRepoRoot(git);
    const repoRelativePath = relative(repoRoot, baselinePath);
    if (
      repoRelativePath.length === 0 ||
      isAbsolute(repoRelativePath) ||
      repoRelativePath === ".." ||
      repoRelativePath.startsWith(`..${sep}`)
    ) {
      return { ok: false, error: `baseline must be inside the repository at ${baselinePath}` };
    }
    const gitPath = repoRelativePath.split(sep).join("/");
    const text = readGitBlobAtRef(git, "HEAD", gitPath);
    return readNearDuplicatesBaseline(text);
  } catch (error) {
    return {
      ok: false,
      error: `could not read committed baseline from HEAD: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function validateNearDuplicatesMergeTruthUp(cwd: string): ParseResult<string> {
  try {
    const gitDir = readGitDir(defaultGitRunner({ cwd }));
    const markerPath = resolve(
      cwd,
      gitDir,
      "musi/near-duplicates-baseline-postmerge-truth-up-required",
    );
    if (!existsSync(markerPath)) {
      return { ok: false, error: "merge truth-up marker is missing" };
    }
    const markerHead = readFileSync(markerPath, "utf8").match(/^pre-merge-head=(.+)$/mu)?.[1];
    // "captured" reproduces this probe's original stdio tuple: outside a merge
    // HEAD has no first parent, which is an expected outcome mapped below, so
    // git's fatal must stay off the terminal while remaining in the error text.
    const firstParent = readFirstParentCommit(defaultGitRunner({ cwd, stderr: "captured" }));
    if (markerHead === undefined || markerHead !== firstParent) {
      return { ok: false, error: "merge truth-up marker does not match HEAD's first parent" };
    }
    return { ok: true, value: markerPath };
  } catch (error) {
    return {
      ok: false,
      error: `could not validate merge truth-up marker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
