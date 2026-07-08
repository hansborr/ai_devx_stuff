import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultGitRunner, listTrackedFiles } from "./lib/git.js";
import type { LintCoverageMapCheckOptions } from "./lint-coverage-map-check-types.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const defaultMapPath = resolve(repoRoot, "docs/generated/lint-coverage-map.md");

export function loadTrackedFiles(cwd: string): string[] {
  return listTrackedFiles(defaultGitRunner({ cwd })).sort();
}

function loadStagedMapText(cwd: string, mapPath: string): string {
  const topLevel = defaultGitRunner({ cwd })(["rev-parse", "--show-toplevel"]).trim();
  const gitPath = relative(topLevel, mapPath).replaceAll("\\", "/");
  return defaultGitRunner({ cwd: topLevel })(["show", `:${gitPath}`]);
}

export function createWorktreeExists(cwd: string): (relativePath: string) => boolean {
  return (relativePath) =>
    existsSync(isAbsolute(relativePath) ? relativePath : resolve(cwd, relativePath));
}

export function loadMapText(options: LintCoverageMapCheckOptions, cwd: string): string {
  if (options.mapText !== undefined) return options.mapText;
  const mapPath = options.mapPath ?? defaultMapPath;
  if (options.staged === true) return loadStagedMapText(cwd, mapPath);
  return readFileSync(mapPath, "utf8");
}
