import path from "node:path";

import type { DetectorScope } from "./scope.js";
import type { ChangedFile, DriftFinding } from "./types.js";

export const SOURCE_LIKE_EXTS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export function toPosix(value: string): string {
  let normalized = value.replace(/\\/gu, "/").split(path.sep).join("/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized !== "/") normalized = normalized.slice(0, -1);
  return normalized;
}

export function isSourceLike(
  value: string,
  sourceExtensions: ReadonlySet<string> = SOURCE_LIKE_EXTS,
): boolean {
  return sourceExtensions.has(path.extname(value).toLowerCase());
}

export function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

export function changedFilesFromScope(detectorScope: DetectorScope): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "changed") continue;
    files.push({
      path: file.path,
      status: file.status,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    });
  }
  return files;
}

export function sortFindingsByFileMessage(findings: readonly DriftFinding[]): DriftFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.file.localeCompare(right.file, "en") || left.message.localeCompare(right.message, "en"),
  );
}

export function isWholeRepoRoots(roots: readonly string[]): boolean {
  return roots.length === 0 || roots.includes(".");
}

export function configuredRootFor(filePath: string, roots: readonly string[]): string | undefined {
  const posix = toPosix(filePath);
  for (const root of roots) {
    if (root === ".") return root;
    if (posix === root || posix.startsWith(`${root}/`)) return root;
  }
  return undefined;
}
