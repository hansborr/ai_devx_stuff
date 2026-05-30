import { type Dirent, readdirSync } from "node:fs";
import path from "node:path";

import type { DriftAiIgnoreConfig } from "./config.js";
import { isPathIgnored } from "./config-match.js";
import { isSourceLike, toPosix } from "./path-util.js";
import { compareStrings } from "./repo-io.js";

export type SourceWalkInput = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
  readonly accept?: (repoRelativePath: string) => boolean;
};

export function walkSourceFiles(input: SourceWalkInput): string[] {
  const repoRoot = path.resolve(input.repoRoot);
  const roots = input.roots.length > 0 ? input.roots : ["."];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    walkDirectory(path.resolve(repoRoot, root), repoRoot, input, out, seen);
  }
  return out.sort(compareStrings);
}

export function walkAbsoluteSourceFiles(input: SourceWalkInput): string[] {
  const repoRoot = path.resolve(input.repoRoot);
  return walkSourceFiles({ ...input, repoRoot }).map((repoRelativePath) =>
    path.join(repoRoot, repoRelativePath),
  );
}

function walkDirectory(
  absDir: string,
  repoRoot: string,
  input: SourceWalkInput,
  out: string[],
  seen: Set<string>,
): void {
  for (const entry of readDirSafe(absDir)) {
    const absChild = path.join(absDir, entry.name);
    const relChild = toPosix(path.relative(repoRoot, absChild));
    if (!isRepoRelativeChild(relChild)) continue;
    if (!isAcceptedPath(relChild, input)) continue;
    if (entry.isDirectory()) {
      walkDirectory(absChild, repoRoot, input, out, seen);
    } else if (entry.isFile() && isAnalyzableSource(relChild, input.sourceExtensions, seen)) {
      seen.add(relChild);
      out.push(relChild);
    }
  }
}

function readDirSafe(absDir: string): Dirent[] {
  try {
    return readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isRepoRelativeChild(repoRelativePath: string): boolean {
  return (
    repoRelativePath.length > 0 &&
    !repoRelativePath.startsWith("..") &&
    !path.isAbsolute(repoRelativePath)
  );
}

function isAcceptedPath(repoRelativePath: string, input: SourceWalkInput): boolean {
  if (isPathIgnored(repoRelativePath, input.ignore)) return false;
  return input.accept?.(repoRelativePath) ?? true;
}

function isAnalyzableSource(
  repoRelativePath: string,
  sourceExtensions: ReadonlySet<string>,
  seen: ReadonlySet<string>,
): boolean {
  if (seen.has(repoRelativePath)) return false;
  if (repoRelativePath.endsWith(".d.ts")) return false;
  return isSourceLike(repoRelativePath, sourceExtensions);
}
