// Reads the script surface of every tracked package.json under the repo root.
//
// Tracked, not globbed: `git ls-files "*package.json"` is what makes the
// command catalog's completeness rule honest. A glob would sweep in
// node_modules and any scratch manifest a contributor left lying around, and
// an untracked manifest is not part of the repository's command surface.
//
// Workspace membership is derived from the root manifest's `workspaces`
// patterns rather than authored, so a package that moves in or out of the
// workspaces changes how the catalog spells its invocation automatically.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defaultGitRunner, type GitRunner, listTrackedFiles } from "../lib/git.js";
import { isObjectLike } from "../lib/records.js";
import type { PackageManifestScripts } from "./command-catalog.js";

export interface PackageManifestSurface {
  readonly manifests: readonly PackageManifestScripts[];
  readonly workspacePackageNames: ReadonlySet<string>;
}

/** `packages/*` matches `packages/server` but not `packages/server/nested`. */
function patternMatchesDirectory(pattern: string, directory: string): boolean {
  const patternSegments = pattern.split("/");
  const directorySegments = directory.split("/");
  if (patternSegments.length !== directorySegments.length) return false;
  return patternSegments.every(
    (segment, index) => segment === "*" || segment === directorySegments[index],
  );
}

function readWorkspacePatterns(repoRoot: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  if (!isObjectLike(parsed) || !Array.isArray(parsed.workspaces)) return [];
  return parsed.workspaces.filter((pattern): pattern is string => typeof pattern === "string");
}

function readManifest(repoRoot: string, path: string): PackageManifestScripts {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
  if (!isObjectLike(parsed)) throw new Error(`${path} is not a JSON object`);
  const scripts = new Map<string, string>();
  if (isObjectLike(parsed.scripts)) {
    for (const [name, command] of Object.entries(parsed.scripts)) {
      if (typeof command === "string") scripts.set(name, command);
    }
  }
  const packageName = typeof parsed.name === "string" ? parsed.name : "";
  return { path, packageName, scripts };
}

/**
 * Every tracked package.json and the scripts it declares, plus the names of the
 * manifests that are workspace members. Manifests declaring no scripts are kept
 * — they contribute no catalog rows, but the count in the generated page is a
 * count of the repository's manifests, not of the interesting ones.
 */
export function loadPackageManifestSurface(
  repoRoot: string,
  git: GitRunner = defaultGitRunner({ cwd: repoRoot }),
): PackageManifestSurface {
  const patterns = readWorkspacePatterns(repoRoot);
  const manifests = listTrackedFiles(git, ["*package.json"])
    .filter((path) => path === "package.json" || path.endsWith("/package.json"))
    .sort()
    .map((path) => readManifest(repoRoot, path));
  const workspacePackageNames = new Set<string>();
  for (const manifest of manifests) {
    if (manifest.path === "package.json" || manifest.packageName === "") continue;
    const directory = manifest.path.slice(0, manifest.path.length - "/package.json".length);
    if (patterns.some((pattern) => patternMatchesDirectory(pattern, directory))) {
      workspacePackageNames.add(manifest.packageName);
    }
  }
  return { manifests, workspacePackageNames };
}
