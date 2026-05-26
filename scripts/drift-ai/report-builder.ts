import { type FileReader, runCommentsCheck } from "./comments.js";
import { DEFAULT_DRIFT_AI_CONFIG, type DriftAiConfig, globsForIgnoredPaths } from "./config.js";
import {
  DEFAULT_DUPLICATES_IGNORE_GLOBS,
  JSCPD_SUPPORTED_EXTENSIONS,
  type JscpdRunner,
  runDuplicatesCheck,
} from "./duplicates.js";
import { type DirectoryListing, runGhostFilesCheck } from "./ghost-files.js";
import { buildInventoryByDir } from "./inventory-by-dir.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions } from "./scope.js";
import { runSuppressionsCheck, type SuppressionsGitRunner } from "./suppressions.js";
import {
  type CliOptions,
  type DriftCheckId,
  type DriftFinding,
  type DriftReport,
} from "./types.js";

export type CheckContext = {
  readonly detectorScope: DetectorScope;
  readonly jscpd: JscpdRunner;
  readonly listDirectory: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
  readonly readFile: FileReader;
  readonly suppressionsGit?: SuppressionsGitRunner;
  readonly repoRoot?: string;
  readonly suppressionDiffRef?: string;
  readonly config?: DriftAiConfig;
  readonly roots?: readonly string[];
  readonly sourceExtensions?: ReadonlySet<string>;
  readonly warnStderr?: (message: string) => void;
};

type CheckRunner = (context: CheckContext) => DriftFinding[];

const CHECK_RUNNERS: Record<DriftCheckId, CheckRunner> = {
  duplicates: (context) => {
    const config = configFor(context);
    const currentOptions =
      context.detectorScope.scopeMode === "current"
        ? {
            regularFileInventoryCount: context.detectorScope.files.length,
            ...(context.warnStderr === undefined ? {} : { warnStderr: context.warnStderr }),
          }
        : {};
    return runDuplicatesCheck({
      detectorScope: context.detectorScope,
      runner: context.jscpd,
      roots: context.roots ?? config.roots,
      duplicateSupportedExtensions: JSCPD_SUPPORTED_EXTENSIONS,
      ...(config.checks.duplicates.minLines === undefined
        ? {}
        : { minLines: config.checks.duplicates.minLines }),
      ignoreGlobs:
        context.detectorScope.scopeMode === "current"
          ? currentDuplicateIgnoreGlobs(config)
          : duplicateIgnoreGlobs(config),
      ...currentOptions,
    });
  },
  "ghost-files": (context) => {
    const config = configFor(context);
    return runGhostFilesCheck({
      detectorScope: context.detectorScope,
      listDirectory: context.listDirectory,
      ...(context.inventoryByDir === undefined ? {} : { inventoryByDir: context.inventoryByDir }),
      excludeGlobs:
        context.detectorScope.scopeMode === "current"
          ? config.checks["ghost-files"].excludeGlobs
          : ghostExcludeGlobs(config),
      currentAllowedPairs: config.checks["ghost-files"].currentAllowedPairs,
      sourceExtensions:
        context.sourceExtensions ?? buildSourceExtensions(config.additionalSourceExtensions),
    });
  },
  comments: (context) => {
    const config = configFor(context);
    return runCommentsCheck({
      detectorScope: context.detectorScope,
      readFile: context.readFile,
      excludePrefixes: config.checks.comments.excludePrefixes,
    });
  },
  suppressions: (context) => {
    return runSuppressionsCheck({
      detectorScope: context.detectorScope,
      repoRoot: context.repoRoot ?? process.cwd(),
      ref: context.suppressionDiffRef ?? "",
      git: context.suppressionsGit ?? noopSuppressionsGitRunner(),
      readFile: context.readFile,
    });
  },
};

const IMPLEMENTED_CHECKS: ReadonlySet<DriftCheckId> = new Set<DriftCheckId>([
  "duplicates",
  "ghost-files",
  "comments",
  "suppressions",
]);

function configFor(context: CheckContext): DriftAiConfig {
  return context.config ?? DEFAULT_DRIFT_AI_CONFIG;
}

function duplicateIgnoreGlobs(config: DriftAiConfig): string[] {
  return [
    ...DEFAULT_DUPLICATES_IGNORE_GLOBS,
    ...globsForIgnoredPaths(config.ignore),
    ...config.checks.duplicates.excludeGlobs,
  ];
}

function currentDuplicateIgnoreGlobs(config: DriftAiConfig): string[] {
  return [...DEFAULT_DUPLICATES_IGNORE_GLOBS, ...config.checks.duplicates.excludeGlobs];
}

function ghostExcludeGlobs(config: DriftAiConfig): string[] {
  return [...config.ignore.globs, ...config.checks["ghost-files"].excludeGlobs];
}

function buildCheckRunnerContext(
  detectorScope: DetectorScope,
  context: CheckContext,
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined,
  roots: readonly string[],
): CheckContext {
  return {
    detectorScope,
    jscpd: context.jscpd,
    listDirectory: context.listDirectory,
    ...(inventoryByDir === undefined ? {} : { inventoryByDir }),
    readFile: context.readFile,
    ...(context.suppressionsGit === undefined ? {} : { suppressionsGit: context.suppressionsGit }),
    ...(context.repoRoot === undefined ? {} : { repoRoot: context.repoRoot }),
    ...(context.suppressionDiffRef === undefined
      ? {}
      : { suppressionDiffRef: context.suppressionDiffRef }),
    ...(context.config === undefined ? {} : { config: context.config }),
    roots,
    ...(context.sourceExtensions === undefined
      ? {}
      : { sourceExtensions: context.sourceExtensions }),
    ...(context.warnStderr === undefined ? {} : { warnStderr: context.warnStderr }),
  };
}

export function buildReport(
  options: CliOptions,
  resolvedRef: string | null,
  detectorScope: DetectorScope,
  context: CheckContext = {
    detectorScope,
    jscpd: noopJscpdRunner(),
    listDirectory: noopDirectoryListing(),
    readFile: noopFileReader(),
  },
): DriftReport {
  const enabled = options.checks.filter((check) => checkRunsForScope(check, detectorScope));
  const skipped = options.checks.filter((check) => !checkRunsForScope(check, detectorScope));
  const findings: DriftFinding[] = [];
  const inventoryByDir = inventoryByDirForReport(detectorScope, context.inventoryByDir);
  const roots = options.roots.length > 0 ? options.roots : configFor(context).roots;
  for (const check of enabled) {
    findings.push(
      ...CHECK_RUNNERS[check](
        buildCheckRunnerContext(detectorScope, context, inventoryByDir, roots),
      ),
    );
  }
  const config = context.config ?? DEFAULT_DRIFT_AI_CONFIG;
  return {
    schemaVersion: 1,
    scopeMode: options.scopeMode,
    base: options.scopeMode === "changed" ? options.base : null,
    resolvedRef: options.scopeMode === "changed" ? resolvedRef : null,
    roots: options.roots.length > 0 ? options.roots : config.roots,
    configPath: options.configPath ?? null,
    enabledChecks: enabled,
    skippedChecks: skipped,
    scope: detectorScope.files,
    findings,
  };
}

function checkRunsForScope(check: DriftCheckId, detectorScope: DetectorScope): boolean {
  if (!IMPLEMENTED_CHECKS.has(check)) return false;
  return !(check === "suppressions" && detectorScope.scopeMode === "current");
}

function inventoryByDirForReport(
  detectorScope: DetectorScope,
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined,
): ReadonlyMap<string, readonly string[]> | undefined {
  if (inventoryByDir !== undefined) return inventoryByDir;
  if (detectorScope.scopeMode !== "current") return undefined;
  return buildInventoryByDir(detectorScope.files);
}

function noopJscpdRunner(): JscpdRunner {
  return () => ({ ok: true, reportJson: '{"duplicates":[]}' });
}

function noopDirectoryListing(): DirectoryListing {
  return () => [];
}

function noopFileReader(): FileReader {
  return () => undefined;
}

function noopSuppressionsGitRunner(): SuppressionsGitRunner {
  return () => "";
}
