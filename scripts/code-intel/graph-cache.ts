import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { buildImportGraph } from "./import-graph.js";
import { discoverWorkspaceSourcePaths, sourceFilesForGraph } from "./source-project.js";
import type { ImportGraph } from "./types.js";
import { WORKSPACE_PACKAGE_DIRS } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

const MANIFEST_HASH_LENGTH = 32;
const HEAD_REF_PREFIX = "ref:";
const GITDIR_PREFIX = "gitdir:";

export type CachedGraphEntry = {
  graph: ImportGraph;
  manifest: string;
  resolver: WorkspaceResolver;
};

export type GraphCacheOptions = {
  computeManifest?: (repoRoot: string) => string;
  rebuild?: (repoRoot: string) => CachedGraphEntry;
};

export class GraphCache {
  private current: CachedGraphEntry | undefined;
  private readonly computeManifest: (repoRoot: string) => string;
  private readonly rebuild: (repoRoot: string) => CachedGraphEntry;
  private readonly repoRoot: string;

  constructor(repoRoot: string, options: GraphCacheOptions = {}) {
    this.repoRoot = repoRoot;
    this.computeManifest = options.computeManifest ?? computeWorkspaceManifest;
    this.rebuild = options.rebuild ?? defaultGraphRebuild;
  }

  ensure(): CachedGraphEntry {
    const manifest = this.computeManifest(this.repoRoot);
    if (this.current && this.current.manifest === manifest) return this.current;
    const rebuilt = this.rebuild(this.repoRoot);
    this.current = { ...rebuilt, manifest };
    return this.current;
  }
}

export function computeWorkspaceManifest(repoRoot: string): string {
  const lines = collectManifestLines(repoRoot);
  return createHash("sha256")
    .update(lines.sort().join("\n"))
    .digest("hex")
    .slice(0, MANIFEST_HASH_LENGTH);
}

function collectManifestLines(repoRoot: string): string[] {
  const lines: string[] = [];
  for (const sourceFile of discoverWorkspaceSourcePaths(repoRoot)) {
    appendContentLine(lines, "src", sourceFile);
  }
  for (const tsconfig of workspaceTsconfigPaths(repoRoot)) {
    appendContentLine(lines, "tsconfig", tsconfig);
  }
  for (const packageJson of workspacePackageJsonPaths(repoRoot)) {
    appendContentLine(lines, "package", packageJson);
  }
  appendContentLine(lines, "bunlock", path.join(repoRoot, "bun.lock"));
  lines.push(`git ${readGitHead(repoRoot)}`);
  return lines;
}

function appendContentLine(lines: string[], kind: string, filePath: string): void {
  if (!existsSync(filePath)) return;
  try {
    const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    lines.push(`${kind} ${filePath} ${digest.slice(0, MANIFEST_HASH_LENGTH)}`);
  } catch {
    // Ignore unreadable entries — they manifest as missing on the next request.
  }
}

function workspaceTsconfigPaths(repoRoot: string): string[] {
  const paths: string[] = [
    path.join(repoRoot, "tsconfig.json"),
    path.join(repoRoot, "tsconfig.base.json"),
    path.join(repoRoot, "tsconfig.scripts.json"),
  ];
  for (const packageDir of WORKSPACE_PACKAGE_DIRS) {
    paths.push(path.join(repoRoot, packageDir, "tsconfig.json"));
    paths.push(path.join(repoRoot, packageDir, "tsconfig.scripts.json"));
  }
  return paths;
}

function workspacePackageJsonPaths(repoRoot: string): string[] {
  const paths: string[] = [path.join(repoRoot, "package.json")];
  for (const packageDir of WORKSPACE_PACKAGE_DIRS) {
    paths.push(path.join(repoRoot, packageDir, "package.json"));
  }
  return paths;
}

function readGitHead(repoRoot: string): string {
  const gitPath = path.join(repoRoot, ".git");
  const gitDir = resolveGitDir(repoRoot, gitPath);
  if (!gitDir) return "no-git";
  const headPath = path.join(gitDir, "HEAD");
  if (!existsSync(headPath)) return "no-head";
  const headContent = readFileSync(headPath, "utf8").trim();
  if (!headContent.startsWith(HEAD_REF_PREFIX)) return `detached@${headContent}`;
  const refPath = headContent.slice(HEAD_REF_PREFIX.length).trim();
  const refTarget = path.join(gitDir, refPath);
  if (existsSync(refTarget)) {
    return `${refPath}@${readFileSync(refTarget, "utf8").trim()}`;
  }
  const packedRefs = path.join(gitDir, "packed-refs");
  if (existsSync(packedRefs)) {
    const packedSha = readPackedRef(packedRefs, refPath);
    if (packedSha) return `${refPath}@${packedSha}`;
  }
  return `${refPath}@unresolved`;
}

function resolveGitDir(repoRoot: string, gitPath: string): string | undefined {
  if (!existsSync(gitPath)) return undefined;
  const stat = statSync(gitPath);
  if (stat.isDirectory()) return gitPath;
  if (!stat.isFile()) return undefined;
  const content = readFileSync(gitPath, "utf8").trimEnd();
  if (!content.startsWith(GITDIR_PREFIX)) return undefined;
  const gitDir = content.slice(GITDIR_PREFIX.length);
  if (gitDir.includes("\n") || gitDir.includes("\r")) return undefined;
  const resolvedGitDir = gitDir.trimStart();
  if (!resolvedGitDir) return undefined;
  return path.resolve(repoRoot, resolvedGitDir);
}

export const graphCacheTest = { readGitHead, resolveGitDir };

function readPackedRef(packedRefsPath: string, refPath: string): string | undefined {
  for (const line of readFileSync(packedRefsPath, "utf8").split("\n")) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const parts = line.split(/\s+/u);
    const [sha, name] = parts;
    if (name === refPath && sha) return sha;
  }
  return undefined;
}

function defaultGraphRebuild(repoRoot: string): CachedGraphEntry {
  const resolver = createWorkspaceResolver(repoRoot);
  const sourceFiles = sourceFilesForGraph(repoRoot, {});
  return {
    graph: buildImportGraph(sourceFiles, resolver),
    manifest: "",
    resolver,
  };
}
