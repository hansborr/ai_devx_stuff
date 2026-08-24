import path from "node:path";

import { gitCheckIgnore } from "../lib/git.js";
import { compareStrings } from "./repo-io.js";

export type PathIgnored = (repoRelativePath: string) => boolean;

export function normalizeConfiguredPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function defaultPathIgnored(
  repoRoot: string,
  candidatePaths: readonly string[],
  commandLabel: string,
): PathIgnored {
  const root = path.resolve(repoRoot);
  const candidates = [...new Set(candidatePaths)].sort(compareStrings);
  if (candidates.length === 0) return () => false;
  const result = gitCheckIgnore(candidates, { cwd: root });
  if (result.kind === "spawn-failed") {
    throw new Error(`${commandLabel} could not run git check-ignore: ${result.error.message}`);
  }
  if (result.kind === "unexpected-status") {
    const detail = result.stderr.trim();
    throw new Error(
      [`${commandLabel} git check-ignore failed`, detail.length === 0 ? undefined : detail]
        .filter((line) => line !== undefined)
        .join(": "),
    );
  }
  const ignoredPaths = parseIgnoredPaths(result.stdout);
  return (repoRelativePath) => ignoredPaths.has(stripTrailingSlash(repoRelativePath));
}

function parseIgnoredPaths(output: string): ReadonlySet<string> {
  const ignoredPaths = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const pathSeparatorIndex = line.lastIndexOf("\t");
    if (pathSeparatorIndex < 0) continue;
    const ignoredPath = normalizeConfiguredPath(line.slice(pathSeparatorIndex + 1));
    ignoredPaths.add(ignoredPath);
    ignoredPaths.add(stripTrailingSlash(ignoredPath));
  }
  return ignoredPaths;
}
