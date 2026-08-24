import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultGitRunner, listTrackedFiles } from "./lib/git.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The rendered document: output of the generator, input of nothing. */
export const coverageMapPath = resolve(repoRoot, "docs/generated/lint-coverage-map.md");

export function loadTrackedFiles(cwd: string): string[] {
  return listTrackedFiles(defaultGitRunner({ cwd })).sort();
}

export function createWorktreeExists(cwd: string): (relativePath: string) => boolean {
  return (relativePath) =>
    existsSync(isAbsolute(relativePath) ? relativePath : resolve(cwd, relativePath));
}
