import path from "node:path";

import { BUILT_IN_SOURCE_EXTENSIONS } from "./scope.js";
import type { DriftFinding } from "./types.js";

export function toPosix(value: string): string {
  let normalized = value.replace(/\\/gu, "/").split(path.sep).join("/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized !== "/") normalized = normalized.slice(0, -1);
  return normalized;
}

export function isSourceLike(
  value: string,
  sourceExtensions: ReadonlySet<string> = BUILT_IN_SOURCE_EXTENSIONS,
): boolean {
  return sourceExtensions.has(path.extname(value).toLowerCase());
}

export function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
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
