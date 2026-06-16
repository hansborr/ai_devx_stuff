import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LintCoverageMapCheckOptions } from "./lint-coverage-map-check-types.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const defaultMapPath = resolve(repoRoot, "docs/agent_notes/lint-coverage-map.md");

export function loadTrackedFiles(cwd: string): string[] {
  const output = execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" });
  return output
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .sort();
}

function loadStagedMapText(cwd: string, mapPath: string): string {
  const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const gitPath = relative(topLevel, mapPath).replaceAll("\\", "/");
  return execFileSync("git", ["show", `:${gitPath}`], { cwd: topLevel, encoding: "utf8" });
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
