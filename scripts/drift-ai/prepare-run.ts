import { existsSync } from "node:fs";
import path from "node:path";

import {
  collapseRepoPath,
  type DriftAiConfig,
  loadDriftAiConfig,
  pathEscapesRepo,
} from "./config.js";
import {
  type BufferGitRunner,
  defaultBufferGitRunner,
  defaultStatRunner,
  discoverCurrentFiles,
  normalizeCurrentRoots,
  resolveStrictRepoRoot,
  type StatRunner,
} from "./current-inventory.js";
import { DriftAiError } from "./errors.js";
import {
  defaultGitRunner,
  discoverChangedFiles,
  filterScope,
  type GitRunner,
  resolveBaseRef,
  resolveMergeBase,
  resolveRepoRoot,
} from "./git-changed-scope.js";
import { buildInventoryByDir } from "./inventory-by-dir.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { CliOptions } from "./types.js";

export type PreparedRun = {
  readonly repoRoot: string;
  readonly config: DriftAiConfig;
  readonly configPath: string | null;
  readonly resolvedRef: string | null;
  readonly suppressionDiffRef: string | null;
  readonly roots: readonly string[];
  readonly detectorScope: DetectorScope;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
  readonly sourceExtensions: ReadonlySet<string>;
};

export type PrepareRunOptions = {
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly rootExists?: (absolutePath: string) => boolean;
};

export function prepareChangedRun(parsed: CliOptions, options: PrepareRunOptions): PreparedRun {
  const explicitConfig = loadExplicitChangedConfig(parsed);
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const loadedConfig = explicitConfig ?? loadDriftAiConfig({ repoRoot });
  const sourceExtensions = buildSourceExtensions(loadedConfig.config.additionalSourceExtensions);
  const resolvedRef = resolveBaseRef(parsed.base, git);
  const mergeBase = resolveMergeBase(resolvedRef, git);
  const changedFiles = filterScope(
    discoverChangedFiles(mergeBase, git),
    loadedConfig.config.ignore,
  );
  return {
    repoRoot,
    config: loadedConfig.config,
    configPath: loadedConfig.configPath,
    resolvedRef,
    suppressionDiffRef: mergeBase,
    roots: parsed.roots.length > 0 ? parsed.roots : loadedConfig.config.roots,
    detectorScope: {
      scopeMode: "changed",
      files: changedFiles.map(toChangedScopeFile),
    },
    sourceExtensions,
  };
}

export function prepareCurrentRun(parsed: CliOptions, options: PrepareRunOptions): PreparedRun {
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveStrictRepoRoot(git);
  const loadedConfig = loadDriftAiConfig({
    repoRoot,
    ...(parsed.configPath === undefined ? {} : { configPath: parsed.configPath }),
  });
  const requestedRoots =
    parsed.roots.length > 0 ? parsed.roots.map(normalizeCliRoot) : loadedConfig.config.roots;
  const roots = normalizeCurrentRoots(requestedRoots);
  if (parsed.roots.length > 0) {
    validateExplicitCurrentRoots(roots, repoRoot, options.rootExists ?? existsSync);
  }
  const sourceExtensions = buildSourceExtensions(loadedConfig.config.additionalSourceExtensions);
  const files = discoverCurrentFiles({
    repoRoot,
    gitBuffer: options.gitBuffer ?? defaultBufferGitRunner({ repoRoot }),
    stat: options.stat ?? defaultStatRunner(),
    ignore: loadedConfig.config.ignore,
    sourceExtensions,
    roots,
  });
  return {
    repoRoot,
    config: loadedConfig.config,
    configPath: loadedConfig.configPath,
    resolvedRef: null,
    suppressionDiffRef: null,
    roots,
    detectorScope: { scopeMode: "current", files },
    inventoryByDir: buildInventoryByDir(files),
    sourceExtensions,
  };
}

function loadExplicitChangedConfig(
  parsed: CliOptions,
): ReturnType<typeof loadDriftAiConfig> | undefined {
  if (parsed.configPath === undefined) return undefined;
  return loadDriftAiConfig({
    repoRoot: process.cwd(),
    configPath: parsed.configPath,
  });
}

function validateExplicitCurrentRoots(
  roots: readonly string[],
  repoRoot: string,
  rootExists: (absolutePath: string) => boolean,
): void {
  for (const root of roots) {
    const repoRelative = normalizeCliRoot(root);
    if (!rootExists(path.resolve(repoRoot, repoRelative))) {
      throw new DriftAiError(`drift:ai: --root '${repoRelative}' does not exist.`);
    }
  }
}

function normalizeCliRoot(root: string): string {
  const repoRelative = collapseRepoPath(root);
  if (pathEscapesRepo(repoRelative)) {
    throw new DriftAiError(`drift:ai: --root ${root}: must stay inside the repo.`);
  }
  return repoRelative;
}

export function optionsForReport(parsed: CliOptions, prepared: PreparedRun): CliOptions {
  return {
    ...parsed,
    roots: prepared.roots,
    ...(prepared.configPath === null ? {} : { configPath: prepared.configPath }),
  };
}
