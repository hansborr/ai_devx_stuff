import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { PRISMA_TYPES_RELATIVE, SERVER_SRC_ROOT, UTILS_ROOT } from "./constants.js";

function isGeneratedPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("generated");
}

function isTypeTestPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("__type-tests__");
}

function isTestPath(relativePath: string): boolean {
  return /\.test\.tsx?$/u.test(relativePath);
}

export function isExcludedPath(relativePath: string): boolean {
  return isTypeTestPath(relativePath) || isGeneratedPath(relativePath) || isTestPath(relativePath);
}

export function discoverFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile() || !currentPath.endsWith(".ts")) continue;
      const relative = path.relative(root, currentPath);
      if (isExcludedPath(relative)) continue;
      files.push(relative);
    }
  };
  visit(path.join(root, SERVER_SRC_ROOT));
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function isMutationHelperPath(relativePath: string): boolean {
  return (
    path.dirname(relativePath) === UTILS_ROOT &&
    path.basename(relativePath).endsWith("-mutations.ts")
  );
}

export function rawTxClientAllowed(relativePath: string): boolean {
  return relativePath === PRISMA_TYPES_RELATIVE || isMutationHelperPath(relativePath);
}
