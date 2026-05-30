// I/O factory functions for harness-freshness. Extracted to keep the main
// module under the effective-line-count ratchet.

import { spawnSync } from "node:child_process";
import path from "node:path";

import type { BacktickPathReference, PathIgnored } from "./harness-freshness.js";
import {
  compareStrings,
  defaultDirectoryListing,
  defaultFileReader,
  defaultPathExists,
} from "./repo-io.js";

export { compareStrings, defaultDirectoryListing, defaultFileReader, defaultPathExists };

export function normalizeConfiguredPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function defaultPathIgnored(
  repoRoot: string,
  candidatePaths: readonly string[],
): PathIgnored {
  const root = path.resolve(repoRoot);
  const candidates = [...new Set(candidatePaths)].sort(compareStrings);
  if (candidates.length === 0) return () => false;
  const result = spawnSync("git", ["check-ignore", "--stdin", "-v"], {
    cwd: root,
    encoding: "utf8",
    input: `${candidates.join("\n")}\n`,
  });
  if (result.error !== undefined) {
    throw new Error(`harness-freshness could not run git check-ignore: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    const detail = result.stderr.trim();
    throw new Error(
      ["harness-freshness git check-ignore failed", detail.length === 0 ? undefined : detail]
        .filter((line) => line !== undefined)
        .join(": "),
    );
  }
  const ignoredPaths = parseIgnoredPaths(result.stdout);
  return (repoRelativePath) => ignoredPaths.has(stripTrailingSlash(repoRelativePath));
}

export function backtickPathIgnoreCandidates(
  backtickPaths: readonly BacktickPathReference[],
): readonly string[] {
  const candidates = new Set<string>();
  for (const reference of backtickPaths) {
    candidates.add(reference.path);
    candidates.add(stripTrailingSlash(reference.path));
  }
  return [...candidates];
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
