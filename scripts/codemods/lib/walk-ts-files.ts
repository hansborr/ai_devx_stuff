import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type WalkTsFilesOptions = {
  /** Keep a file when this returns true. Receives the absolute path. */
  include: (absolutePath: string) => boolean;
  /** Prune a directory by its basename when this returns true. */
  skipDir?: (directoryName: string) => boolean;
  /** When set, emit `path.relative(relativeTo, absolutePath)` instead of absolute paths. */
  relativeTo?: string;
};

/**
 * Recursively walks one or more root directories and returns the matching `.ts(x)`
 * files in stable, locale-sorted order. Missing roots contribute nothing. This is
 * the shared implementation behind the codemod `discover*` path collectors; keep
 * per-codemod include/skip/post-filter semantics at the call site, not here.
 */
export function walkTsFiles(roots: string[], options: WalkTsFilesOptions): string[] {
  const { include, skipDir, relativeTo } = options;
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipDir?.(entry.name)) visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile() || !include(currentPath)) continue;
      files.push(relativeTo === undefined ? currentPath : path.relative(relativeTo, currentPath));
    }
  };

  for (const root of roots) {
    if (existsSync(root)) visit(root);
  }

  return files.sort((left, right) => left.localeCompare(right, "en"));
}
