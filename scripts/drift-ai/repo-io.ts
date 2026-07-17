import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type RepoFileReader = (filePath: string) => string | undefined;
export type DirectoryListing = (directory: string) => readonly string[];
export type PathProbe = (relativePath: string) => boolean;
type RepoPathKind = "file" | "directory";
export type PathExists = (repoRelativePath: string, kind: RepoPathKind) => boolean;

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

export function defaultFileReader(repoRoot: string): RepoFileReader {
  const root = path.resolve(repoRoot);
  return (filePath) => {
    const target = safeRepoPathFromRoot(root, filePath);
    if (target === undefined) return undefined;
    try {
      return readFileSync(target, "utf8");
    } catch {
      return undefined;
    }
  };
}

export function defaultDirectoryListing(repoRoot: string): DirectoryListing {
  const root = path.resolve(repoRoot);
  return (directory) => {
    const target = safeRepoPathFromRoot(root, directory);
    if (target === undefined) return [];
    try {
      return readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(compareStrings);
    } catch {
      return [];
    }
  };
}

export function defaultPathExists(repoRoot: string): PathExists {
  const root = path.resolve(repoRoot);
  return (repoRelativePath, kind) => {
    const target = safeRepoPathFromRoot(root, repoRelativePath);
    if (target === undefined) return false;
    try {
      const stat = statSync(target);
      return kind === "file" ? stat.isFile() : stat.isDirectory();
    } catch {
      return false;
    }
  };
}

export function defaultPathProbe(repoRoot: string): PathProbe {
  const root = path.resolve(repoRoot);
  return (relativePath) => {
    const target = safeRepoPathFromRoot(root, relativePath);
    return target !== undefined && existsSync(target);
  };
}

function safeRepoPathFromRoot(root: string, repoRelativePath: string): string | undefined {
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const target = path.resolve(root, repoRelativePath);
  if (target !== root && !target.startsWith(rootWithSep)) return undefined;
  return target;
}
