// jscpd duplicate-code parser, changed-file filter, scope mapping, and
// finding builder.  The subprocess runner and check-integration entrypoint
// live in duplicates-runner.ts and are re-exported at the bottom of this
// file for backward-compatible imports.

import path from "node:path";

import type { ChangedFile, DriftFinding } from "../drift-ai.js";
import { matchesAnyGlob, normalizeRepoPath } from "./config.js";

type JscpdFileEntry = {
  readonly name: string;
  readonly start: number;
  readonly end: number;
};

export type JscpdClone = {
  readonly format?: string;
  readonly lines: number;
  readonly firstFile: JscpdFileEntry;
  readonly secondFile: JscpdFileEntry;
};

type JscpdReport = {
  readonly duplicates: readonly JscpdClone[];
};

export type ParseDuplicatesReportResult =
  | { readonly ok: true; readonly report: JscpdReport }
  | { readonly ok: false; readonly error: string };

export const DUPLICATE_REPAIR_HINT =
  "extract or reuse the existing helper if the behavior is shared; otherwise keep both paths and add a short reason in the PR/handoff.";

export const JSCPD_SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export function parseDuplicatesReport(jsonText: string): ParseDuplicatesReportResult {
  if (jsonText.trim().length === 0) return { ok: true, report: { duplicates: [] } };
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (!isObject(raw)) return { ok: false, error: "expected JSON object root" };
  const list = raw["duplicates"];
  if (!Array.isArray(list)) return { ok: true, report: { duplicates: [] } };
  const duplicates: JscpdClone[] = [];
  for (const entry of list) {
    const clone = parseClone(entry);
    if (clone) duplicates.push(clone);
  }
  return { ok: true, report: { duplicates } };
}

// Normalize a jscpd report path to a repo-relative POSIX path. jscpd writes
// paths relative to its working directory by default and uses the platform
// separator; both shapes need to compare equal to the changed-file scope built
// by `discoverChangedFiles` in scripts/drift-ai.ts.
export function normalizeReportPath(filePath: string): string {
  let posix = filePath.split(path.sep).join("/");
  while (posix.startsWith("./")) posix = posix.slice(2);
  return posix;
}

export function filterClonesToChangedFiles(
  clones: readonly JscpdClone[],
  changedPaths: ReadonlySet<string>,
): JscpdClone[] {
  return clones.filter((clone) => {
    const a = normalizeReportPath(clone.firstFile.name);
    const b = normalizeReportPath(clone.secondFile.name);
    return changedPaths.has(a) || changedPaths.has(b);
  });
}

// Map a clone to a single drift finding. The changed side is always reported as
// the primary file; if both sides are in scope the lexically smaller path wins
// so a single clone produces deterministic output. Findings preserve the input
// clone order — sort upstream if a stable cross-run ordering is needed.
export function buildDuplicatesFindings(
  clones: readonly JscpdClone[],
  changedPaths: ReadonlySet<string>,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const clone of clones) {
    const a = { ...clone.firstFile, name: normalizeReportPath(clone.firstFile.name) };
    const b = { ...clone.secondFile, name: normalizeReportPath(clone.secondFile.name) };
    const aChanged = changedPaths.has(a.name);
    const bChanged = changedPaths.has(b.name);
    if (!aChanged && !bChanged) continue;
    const useFirstAsPrimary = aChanged && (!bChanged || a.name <= b.name);
    const primary = useFirstAsPrimary ? a : b;
    const secondary = useFirstAsPrimary ? b : a;
    findings.push({
      check: "duplicates",
      file: `${primary.name}:${primary.start}-${primary.end}`,
      message: `duplicates ${secondary.name}:${secondary.start}-${secondary.end} (${clone.lines} lines)`,
      hint: DUPLICATE_REPAIR_HINT,
    });
  }
  return findings;
}

function parseClone(value: unknown): JscpdClone | undefined {
  if (!isObject(value)) return undefined;
  const lines = typeof value["lines"] === "number" ? value["lines"] : undefined;
  const firstFile = parseFileEntry(value["firstFile"]);
  const secondFile = parseFileEntry(value["secondFile"]);
  if (lines === undefined || !firstFile || !secondFile) return undefined;
  const format = typeof value["format"] === "string" ? value["format"] : undefined;
  return format === undefined
    ? { lines, firstFile, secondFile }
    : { format, lines, firstFile, secondFile };
}

function parseFileEntry(value: unknown): JscpdFileEntry | undefined {
  if (!isObject(value)) return undefined;
  const name = typeof value["name"] === "string" ? value["name"] : undefined;
  const start = typeof value["start"] === "number" ? value["start"] : undefined;
  const end = typeof value["end"] === "number" ? value["end"] : undefined;
  if (name === undefined || start === undefined || end === undefined) return undefined;
  return { name, start, end };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Scope mapping ----------------------------------------------------------

// Conservative defaults: scan only production-source clones, ignore tests and
// fixtures, and require enough lines that we do not flag short import blocks
// or short shared-schema tables. Tighten or relax these once we have real
// drift:ai output to look at.
export const DEFAULT_DUPLICATES_MIN_LINES = 30;

export const DEFAULT_DUPLICATES_IGNORE_GLOBS: readonly string[] = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/*.fixture.ts",
  "**/*.fixture.tsx",
  "**/*.d.ts",
];

export type DuplicateScopeKey = string;

export type DuplicateScope = {
  readonly key: DuplicateScopeKey;
  readonly scopePath: string;
  readonly changedPaths: readonly string[];
};

function toPosix(filePath: string): string {
  return normalizeRepoPath(filePath);
}

function isSourceLike(
  filePath: string,
  supportedExtensions: ReadonlySet<string> = JSCPD_SUPPORTED_EXTENSIONS,
): boolean {
  return supportedExtensions.has(path.posix.extname(toPosix(filePath)).toLowerCase());
}

function isExcludedFromDuplicates(filePath: string, excludeGlobs: readonly string[]): boolean {
  return matchesAnyGlob(toPosix(filePath), excludeGlobs);
}

// Only the new path of a renamed/copied file counts as "in scope": jscpd
// scans the working tree, so the previousPath no longer exists there. A
// rename out of a recognised scope therefore drops off the list, which
// matches the intent — drift:ai cares about duplicates against the file as
// it stands today.
export type MapChangedFilesToScopesOptions = {
  readonly roots?: readonly string[];
  readonly excludeGlobs?: readonly string[];
  readonly supportedExtensions?: ReadonlySet<string>;
};

function resolveDuplicateScope(
  file: ChangedFile,
  roots: readonly string[],
  excludeGlobs: readonly string[],
  supportedExtensions: ReadonlySet<string>,
): string | undefined {
  if (file.status === "deleted") return undefined;
  if (!isSourceLike(file.path, supportedExtensions)) return undefined;
  if (isExcludedFromDuplicates(file.path, excludeGlobs)) return undefined;
  const scopePath = configuredRootFor(file.path, roots) ?? inferScopeRoot(file.path);
  if (!scopePath) return undefined;
  return scopePath;
}

export function mapChangedFilesToScopes(
  files: readonly ChangedFile[],
  options: MapChangedFilesToScopesOptions = {},
): DuplicateScope[] {
  const roots = normalizeRoots(options.roots ?? []);
  const excludeGlobs = options.excludeGlobs ?? DEFAULT_DUPLICATES_IGNORE_GLOBS;
  const supportedExtensions = options.supportedExtensions ?? JSCPD_SUPPORTED_EXTENSIONS;
  const buckets = new Map<DuplicateScopeKey, string[]>();
  for (const file of files) {
    const scope = resolveDuplicateScope(file, roots, excludeGlobs, supportedExtensions);
    if (scope === undefined) continue;
    const list = buckets.get(scope) ?? [];
    if (!list.includes(file.path)) list.push(file.path);
    buckets.set(scope, list);
  }
  const scopes: DuplicateScope[] = [];
  for (const [key, changedPaths] of buckets) {
    scopes.push({ key, scopePath: key, changedPaths });
  }
  return scopes.sort((left, right) => left.scopePath.localeCompare(right.scopePath, "en"));
}

export function normalizeRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => normalizeRepoPath(root) || "."))].sort(
    (left, right) => right.length - left.length || left.localeCompare(right, "en"),
  );
}

function configuredRootFor(filePath: string, roots: readonly string[]): string | undefined {
  const posix = toPosix(filePath);
  for (const root of roots) {
    if (root === ".") return root;
    if (posix === root || posix.startsWith(`${root}/`)) return root;
  }
  return undefined;
}

function inferScopeRoot(filePath: string): string | undefined {
  const posix = toPosix(filePath);
  const segments = posix.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  const srcIndex = segments.indexOf("src");
  if (srcIndex >= 0) return segments.slice(0, srcIndex + 1).join("/");
  if (segments.length > 1) return segments[0];
  return ".";
}

// Re-export runner + check-integration API from the extracted module so that
// existing consumers can continue importing from this file unchanged.
export {
  defaultJscpdRunner,
  type DefaultJscpdRunnerOptions,
  type JscpdRunner,
  type JscpdRunnerInput,
  LARGE_INVENTORY_WARNING_THRESHOLD,
  runDuplicatesCheck,
  type RunDuplicatesCheckOptions,
} from "./duplicates-runner.js";
