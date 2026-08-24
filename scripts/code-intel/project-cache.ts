import path from "node:path";

import { Project } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import { computeWorkspaceManifest } from "./graph-cache.js";
import { toSlash } from "./path-utils.js";
import {
  createReferenceProject,
  discoverSupportedSourcePaths,
  isSupportedRelativePath,
  unsupportedScopeError,
} from "./source-project.js";
import type { ProjectBucket } from "./types.js";
import { SCRIPT_SOURCE_DIR } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

type ProjectBucketConfig = {
  bucket: ProjectBucket;
  packageDir: string;
};

const PACKAGE_BUCKETS: ProjectBucketConfig[] = [
  { bucket: "shared", packageDir: "packages/shared" },
  { bucket: "server", packageDir: "packages/server" },
  { bucket: "client", packageDir: "packages/client" },
];

export type CachedProjectEntry = {
  graphProject: Project;
  manifest: string;
  projects: Record<ProjectBucket, Project>;
  referenceProject?: Project;
  resolver: WorkspaceResolver;
};

export type ProjectCacheOptions = {
  buildReferenceProject?: (repoRoot: string) => Project;
  computeManifest?: (repoRoot: string) => string;
  rebuild?: (repoRoot: string) => CachedProjectEntry;
};

export class ProjectCache {
  private current: CachedProjectEntry | undefined;
  private readonly buildReferenceProject: (repoRoot: string) => Project;
  private readonly computeManifest: (repoRoot: string) => string;
  private readonly rebuild: (repoRoot: string) => CachedProjectEntry;
  private readonly repoRoot: string;

  constructor(repoRoot: string, options: ProjectCacheOptions = {}) {
    this.repoRoot = repoRoot;
    this.buildReferenceProject = options.buildReferenceProject ?? createReferenceProject;
    this.computeManifest = options.computeManifest ?? computeWorkspaceManifest;
    this.rebuild = options.rebuild ?? defaultProjectRebuild;
  }

  ensure(): CachedProjectEntry {
    const manifest = this.computeManifest(this.repoRoot);
    if (this.current && this.current.manifest === manifest) return this.current;
    const rebuilt = this.rebuild(this.repoRoot);
    this.current = { ...rebuilt, manifest };
    return this.current;
  }

  projectForFile(file: string, cached: CachedProjectEntry = this.ensure()): Project {
    return cached.projects[projectBucketForFile(this.repoRoot, file)];
  }

  referenceProject(cached: CachedProjectEntry = this.ensure()): Project {
    if (!cached.referenceProject) {
      cached.referenceProject = this.buildReferenceProject(this.repoRoot);
    }
    return cached.referenceProject;
  }
}

function defaultProjectRebuild(repoRoot: string): CachedProjectEntry {
  return {
    graphProject: createGraphProject(repoRoot),
    manifest: "",
    projects: createPackageProjects(repoRoot),
    resolver: createWorkspaceResolver(repoRoot),
  };
}

function createGraphProject(repoRoot: string): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(discoverSupportedSourcePaths(repoRoot));
  return project;
}

function createPackageProjects(repoRoot: string): Record<ProjectBucket, Project> {
  return {
    client: createTsconfigProject(repoRoot, "packages/client/tsconfig.json"),
    scripts: createTsconfigProject(repoRoot, "tsconfig.scripts.json"),
    server: createTsconfigProject(repoRoot, "packages/server/tsconfig.json"),
    shared: createTsconfigProject(repoRoot, "packages/shared/tsconfig.json"),
  };
}

function createTsconfigProject(repoRoot: string, tsConfigPath: string): Project {
  return new Project({ tsConfigFilePath: path.join(repoRoot, tsConfigPath) });
}

function projectBucketForFile(repoRoot: string, file: string): ProjectBucket {
  const relative = toSlash(path.relative(repoRoot, path.resolve(repoRoot, file)));
  // Repo-relative in the error, matching existingRelativeFile, so the same
  // out-of-scope path reports identically across every command.
  if (!isSupportedRelativePath(relative)) throw unsupportedScopeError(relative);
  for (const config of PACKAGE_BUCKETS) {
    if (relative.startsWith(`${config.packageDir}/`)) return config.bucket;
  }
  if (relative.startsWith(`${SCRIPT_SOURCE_DIR}/`)) return "scripts";
  // Reachable only when APPLICATION_PACKAGE_DIRS admits a package that the
  // hand-maintained PACKAGE_BUCKETS above does not map. Fail loudly rather
  // than silently resolving against tsconfig.scripts.json, which would let
  // daemon answers drift from one-shot createProjectForFile
  // (docs/guides/code-intel.md#supported-scope).
  throw new CodeIntelError(
    `No project bucket maps ${relative}; update PACKAGE_BUCKETS in scripts/code-intel/project-cache.ts`,
  );
}
