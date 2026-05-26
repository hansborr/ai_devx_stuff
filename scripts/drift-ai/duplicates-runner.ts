// jscpd subprocess runner and check-integration entrypoint.
// Extracted from duplicates.ts to keep each module under the max-lines ratchet.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ChangedFile, DriftFinding } from "../drift-ai.js";
import { matchesAnyGlob, normalizeRepoPath } from "./config.js";
import {
  buildDuplicatesFindings,
  DEFAULT_DUPLICATES_IGNORE_GLOBS,
  DEFAULT_DUPLICATES_MIN_LINES,
  type DuplicateScope,
  type DuplicateScopeKey,
  filterClonesToChangedFiles,
  JSCPD_SUPPORTED_EXTENSIONS,
  mapChangedFilesToScopes,
  normalizeRoots,
  parseDuplicatesReport,
} from "./duplicates.js";
import type { DetectorScope } from "./scope.js";

// --- Subprocess runner ------------------------------------------------------

export type JscpdRunnerInput = {
  readonly scopePath: string;
  readonly minLines: number;
  readonly ignoreGlobs: readonly string[];
};

type JscpdRunnerResult =
  | { readonly ok: true; readonly reportJson: string }
  | { readonly ok: false; readonly error: string };

export type JscpdRunner = (input: JscpdRunnerInput) => JscpdRunnerResult;

const JSCPD_REPORT_FILENAME = "jscpd-report.json";

export type DefaultJscpdRunnerOptions = {
  // Repo root used for both resolving node_modules/.bin/jscpd and as the
  // subprocess cwd. jscpd writes the changed-file paths in the JSON report
  // relative to its cwd, so the report-paths and the changed-set we hand to
  // filterClonesToChangedFiles must share the same anchor (the repo root).
  // Pass a real value when invoking from outside the repo root; defaults to
  // process.cwd() for the common bun-run-from-root case.
  readonly repoRoot?: string;
};

export function defaultJscpdRunner(options: DefaultJscpdRunnerOptions = {}): JscpdRunner {
  const repoRoot = options.repoRoot ?? process.cwd();
  return ({ scopePath, minLines, ignoreGlobs }) => {
    const outputDir = mkdtempSync(path.join(tmpdir(), "drift-ai-jscpd-"));
    try {
      const args = [
        "--reporters",
        "json",
        "--output",
        outputDir,
        "--silent",
        "--noTips",
        "--min-lines",
        String(minLines),
      ];
      // jscpd's --ignore is comma-separated; repeating the flag only honors
      // one value because it is declared with commander's `[string]` shape.
      // None of our default globs contain literal commas; if a future glob
      // does, switch to the form `--ignore '{a,b}'` rather than splitting.
      if (ignoreGlobs.length > 0) args.push("--ignore", ignoreGlobs.join(","));
      args.push(scopePath);

      const bin = path.join(repoRoot, "node_modules", ".bin", "jscpd");
      const result = spawnSync(bin, args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.error) {
        return { ok: false, error: `jscpd subprocess failed: ${result.error.message}` };
      }
      if (result.status !== 0) {
        const detail = result.stderr.trim();
        const status = result.status === null ? "unknown" : String(result.status);
        return {
          ok: false,
          error: detail.length > 0 ? `jscpd exited ${status}: ${detail}` : `jscpd exited ${status}`,
        };
      }
      // On success we ignore stdout/stderr: jscpd's --silent still prints a
      // one-line "JSON report saved..." to stdout in 4.x, which is noise for
      // an injected runner that only cares about the report JSON.
      const reportPath = path.join(outputDir, JSCPD_REPORT_FILENAME);
      try {
        return { ok: true, reportJson: readFileSync(reportPath, "utf8") };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `jscpd report missing at ${reportPath}: ${message}` };
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  };
}

// --- Check integration ------------------------------------------------------

export const LARGE_INVENTORY_WARNING_THRESHOLD = 20_000;

export type RunDuplicatesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly runner: JscpdRunner;
  readonly roots?: readonly string[];
  readonly duplicateSupportedExtensions?: ReadonlySet<string>;
  readonly minLines?: number;
  readonly ignoreGlobs?: readonly string[];
  readonly regularFileInventoryCount?: number;
  readonly warnStderr?: (message: string) => void;
};

export function runDuplicatesCheck(options: RunDuplicatesCheckOptions): DriftFinding[] {
  const minLines = options.minLines ?? DEFAULT_DUPLICATES_MIN_LINES;
  const ignoreGlobs = options.ignoreGlobs ?? DEFAULT_DUPLICATES_IGNORE_GLOBS;
  const supportedExtensions = options.duplicateSupportedExtensions ?? JSCPD_SUPPORTED_EXTENSIONS;
  if (options.detectorScope.scopeMode === "current") {
    return runCurrentDuplicatesCheck(options, minLines, ignoreGlobs, supportedExtensions);
  }
  const scopes = mapChangedFilesToScopes(changedFilesFromScope(options.detectorScope), {
    roots: options.roots ?? [],
    excludeGlobs: ignoreGlobs,
    supportedExtensions,
  });
  if (scopes.length === 0) return [];
  return runDuplicateScopes(scopes, options.runner, minLines, ignoreGlobs);
}

function runCurrentDuplicatesCheck(
  options: RunDuplicatesCheckOptions,
  minLines: number,
  ignoreGlobs: readonly string[],
  supportedExtensions: ReadonlySet<string>,
): DriftFinding[] {
  warnForLargeCurrentInventory(options);
  const roots = normalizeCurrentDuplicateRoots(options.roots ?? []);
  const scopes = mapCurrentFilesToScopes(options.detectorScope, {
    roots,
    ignoreGlobs,
    supportedExtensions,
  });
  if (scopes.length === 0) return [];
  return sortDuplicateFindings(runDuplicateScopes(scopes, options.runner, minLines, ignoreGlobs));
}

function runDuplicateScopes(
  scopes: readonly DuplicateScope[],
  runner: JscpdRunner,
  minLines: number,
  ignoreGlobs: readonly string[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const scope of scopes) {
    const result = runner({
      scopePath: scope.scopePath,
      minLines,
      ignoreGlobs,
    });
    findings.push(...buildFindingsForScope(scope, result));
  }
  return findings;
}

function buildFindingsForScope(
  scope: DuplicateScope,
  result: JscpdRunnerResult,
): DriftFinding[] {
  if (!result.ok) return [buildRunnerFailureFinding(scope.scopePath, result.error)];
  const parsed = parseDuplicatesReport(result.reportJson);
  if (!parsed.ok) return [buildUnreadableReportFinding(scope.scopePath, parsed.error)];
  const changedSet = new Set<string>(scope.changedPaths);
  const filtered = filterClonesToChangedFiles(parsed.report.duplicates, changedSet);
  return buildDuplicatesFindings(filtered, changedSet);
}

function buildRunnerFailureFinding(scopePath: string, error: string): DriftFinding {
  // Report-only contract: surface the failure as a finding instead of throwing
  // so drift:ai still exits 0 and the rest of the report renders.
  return {
    check: "duplicates",
    file: scopePath,
    message: `jscpd subprocess failed (${error})`,
    hint: "Re-run drift:ai locally to inspect; ensure node_modules/.bin/jscpd is installed.",
  };
}

function buildUnreadableReportFinding(scopePath: string, error: string): DriftFinding {
  return {
    check: "duplicates",
    file: scopePath,
    message: `jscpd produced unreadable JSON (${error})`,
    hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
  };
}

function toPosix(filePath: string): string {
  return normalizeRepoPath(filePath);
}

function isSourceLike(
  filePath: string,
  supportedExtensions: ReadonlySet<string>,
): boolean {
  return supportedExtensions.has(path.posix.extname(toPosix(filePath)).toLowerCase());
}

function isExcludedFromDuplicates(filePath: string, excludeGlobs: readonly string[]): boolean {
  return matchesAnyGlob(toPosix(filePath), excludeGlobs);
}

function configuredRootFor(filePath: string, roots: readonly string[]): string | undefined {
  const posix = toPosix(filePath);
  for (const root of roots) {
    if (root === ".") return root;
    if (posix === root || posix.startsWith(`${root}/`)) return root;
  }
  return undefined;
}

function mapCurrentFilesToScopes(
  detectorScope: DetectorScope,
  options: {
    readonly roots: readonly string[];
    readonly ignoreGlobs: readonly string[];
    readonly supportedExtensions: ReadonlySet<string>;
  },
): DuplicateScope[] {
  const buckets = new Map<DuplicateScopeKey, string[]>();
  for (const filePath of currentDuplicateSourcePaths(detectorScope, options)) {
    const scopePath = configuredRootFor(filePath, options.roots);
    if (scopePath === undefined) continue;
    const list = buckets.get(scopePath) ?? [];
    if (!list.includes(filePath)) list.push(filePath);
    buckets.set(scopePath, list);
  }
  return duplicateScopesFromBuckets(buckets);
}

function currentDuplicateSourcePaths(
  detectorScope: DetectorScope,
  options: {
    readonly ignoreGlobs: readonly string[];
    readonly supportedExtensions: ReadonlySet<string>;
  },
): string[] {
  const paths = new Set<string>();
  for (const file of detectorScope.files) {
    if (file.scope !== "current") continue;
    const filePath = toPosix(file.path);
    if (!isSourceLike(filePath, options.supportedExtensions)) continue;
    if (isExcludedFromDuplicates(filePath, options.ignoreGlobs)) continue;
    paths.add(filePath);
  }
  return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}

function duplicateScopesFromBuckets(
  buckets: ReadonlyMap<DuplicateScopeKey, readonly string[]>,
): DuplicateScope[] {
  const scopes: DuplicateScope[] = [];
  for (const [key, changedPaths] of buckets) {
    scopes.push({ key, scopePath: key, changedPaths });
  }
  return scopes.sort((left, right) => left.scopePath.localeCompare(right.scopePath, "en"));
}

function normalizeCurrentDuplicateRoots(roots: readonly string[]): string[] {
  const normalized = normalizeRoots(roots);
  return normalized.length === 0 ? ["."] : normalized;
}

function warnForLargeCurrentInventory(options: RunDuplicatesCheckOptions): void {
  const count = options.regularFileInventoryCount;
  if (count === undefined || count <= LARGE_INVENTORY_WARNING_THRESHOLD) return;
  if (!rootsNormalizeToRepoRoot(options.roots ?? [])) return;
  options.warnStderr?.(
    `drift:ai: large repository (${count} files); duplicates over the whole repo can be slow. Try --check ghost-files first or pass --root <path>.`,
  );
}

function rootsNormalizeToRepoRoot(roots: readonly string[]): boolean {
  const normalized = normalizeRoots(roots);
  return normalized.length === 0 || (normalized.length === 1 && normalized[0] === ".");
}

function sortDuplicateFindings(findings: readonly DriftFinding[]): DriftFinding[] {
  return [...findings].sort(
    (left, right) =>
      left.file.localeCompare(right.file, "en") ||
      left.message.localeCompare(right.message, "en"),
  );
}

function changedFilesFromScope(detectorScope: DetectorScope): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "changed") continue;
    files.push({
      path: file.path,
      status: file.status,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    });
  }
  return files;
}
