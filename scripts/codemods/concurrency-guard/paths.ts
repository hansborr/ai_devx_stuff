import path from "node:path";

import { STRICT_TEST_BASENAME_PATTERN } from "../../lib/path-taxonomy.js";
import { walkTsFiles } from "../lib/walk-ts-files.js";
import { PRISMA_TYPES_RELATIVE, SERVER_SRC_ROOT, UTILS_ROOT } from "./constants.js";

// Deliberately local (leaf 134): `generated/` and `__type-tests__/` are
// packages/server tree conventions scoped to this codemod's scan, not part of
// the shared source/test taxonomy — no other classifier should inherit them.
function isGeneratedPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("generated");
}

function isTypeTestPath(relativePath: string): boolean {
  return relativePath.split(path.sep).includes("__type-tests__");
}

// Shares the strict `.test.ts(x)` basename primitive: server tests are
// exactly that form, and the guard scan deliberately excludes only them.
function isTestPath(relativePath: string): boolean {
  return STRICT_TEST_BASENAME_PATTERN.test(relativePath);
}

export function isExcludedPath(relativePath: string): boolean {
  return isTypeTestPath(relativePath) || isGeneratedPath(relativePath) || isTestPath(relativePath);
}

export function discoverFiles(root: string): string[] {
  return walkTsFiles([path.join(root, SERVER_SRC_ROOT)], {
    include: (currentPath) => currentPath.endsWith(".ts"),
    relativeTo: root,
  }).filter((relative) => !isExcludedPath(relative));
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
