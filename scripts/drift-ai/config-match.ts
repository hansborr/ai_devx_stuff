import path from "node:path";

import type { DriftAiIgnoreConfig } from "./config.js";
import { normalizeRepoPath } from "./config-paths.js";
import { uniqSorted } from "./path-util.js";
import { DEFAULT_IGNORE_EXTENSIONS, DEFAULT_IGNORE_FILES } from "./types.js";

// Whether a repo-relative path is ignored under the given ignore config. The core
// predicate lives here (a leaf module that imports no registry/config-loading
// code) so the source-file walker can reuse it without pulling the heavier
// git-changed-scope module — which would form a load-order import cycle back into
// the check registry. git-changed-scope wraps this with the DEFAULT_DRIFT_AI_CONFIG
// default for its own callers.
export function isPathIgnored(filePath: string, ignore: DriftAiIgnoreConfig): boolean {
  const normalized = filePath.split(path.sep).join("/");
  if (pathHasAnySegment(normalized, new Set(ignore.segments))) return true;
  if (pathHasAnyPrefix(normalized, ignore.prefixes)) return true;
  if (matchesAnyGlob(normalized, ignore.globs)) return true;
  if (DEFAULT_IGNORE_FILES.includes(path.basename(normalized))) return true;
  const ext = path.extname(normalized).toLowerCase();
  if (DEFAULT_IGNORE_EXTENSIONS.includes(ext)) return true;
  return false;
}

function pathHasAnySegment(filePath: string, segments: ReadonlySet<string>): boolean {
  return normalizeRepoPath(filePath)
    .split("/")
    .some((segment) => segments.has(segment));
}

export function pathHasAnyPrefix(filePath: string, prefixes: readonly string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  const normalized = normalizeRepoPath(filePath);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

export function globsForIgnoredPaths(ignore: DriftAiIgnoreConfig): string[] {
  return uniqSorted([
    ...ignore.segments.map((segment) => `**/${segment}/**`),
    ...ignore.prefixes.map((prefix) => `${prefix.endsWith("/") ? prefix : `${prefix}/`}**`),
    ...ignore.globs,
  ]);
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      const after = glob[index + 2];
      if (after === "/") {
        out += "(?:.*/)?";
        index += 2;
      } else {
        out += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(char ?? "");
  }
  out += "$";
  return new RegExp(out, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&");
}
