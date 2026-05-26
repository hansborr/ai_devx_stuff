import path from "node:path";

import type { ScopeFile } from "./scope.js";

export function buildInventoryByDir(
  files: readonly ScopeFile[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    if (file.scope !== "current") continue;
    const directory = path.posix.dirname(file.path);
    const siblings = grouped.get(directory) ?? [];
    siblings.push(file.path);
    grouped.set(directory, siblings);
  }
  return sortedInventoryByDir(grouped);
}

function sortedInventoryByDir(
  grouped: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const sorted = new Map<string, readonly string[]>();
  const directories = [...grouped.keys()].sort((left, right) => left.localeCompare(right, "en"));
  for (const directory of directories) {
    sorted.set(directory, [...(grouped.get(directory) ?? [])].sort(comparePaths));
  }
  return sorted;
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
