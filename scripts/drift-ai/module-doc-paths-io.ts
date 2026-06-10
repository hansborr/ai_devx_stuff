// Default MODULE.md discovery for the module-doc-paths check. Walks the configured
// roots (reusing the shared ignore-aware source walker with a `.md` extension set)
// and keeps only MODULE.md / *-MODULE.md files.

import path from "node:path";

import type { DriftAiIgnoreConfig } from "./config.js";
import { walkSourceFiles } from "./source-walk.js";

const MODULE_DOC_EXTENSIONS: ReadonlySet<string> = new Set([".md"]);

export function defaultListModuleDocs(
  repoRoot: string,
  roots: readonly string[],
  ignore: DriftAiIgnoreConfig,
): readonly string[] {
  return walkSourceFiles({
    repoRoot,
    roots,
    sourceExtensions: MODULE_DOC_EXTENSIONS,
    ignore,
  }).filter(isModuleDocPath);
}

export function isModuleDocPath(repoRelativePath: string): boolean {
  const base = path.posix.basename(repoRelativePath);
  return base === "MODULE.md" || base.endsWith("-MODULE.md");
}
