#!/usr/bin/env bun
// Report-only AI drift sensors.
//
// `duplicates`, `ghost-files`, and `comments` are live warning-only checks.
// The command owns the stable interface: argument parsing, changed-file
// scope, ignore patterns, and text/JSON output.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defaultFileReader, type FileReader, runCommentsCheck } from "./drift-ai/comments.js";
import {
  defaultJscpdRunner,
  DEFAULT_DUPLICATES_IGNORE_GLOBS,
  JSCPD_SUPPORTED_EXTENSIONS,
  type JscpdRunner,
  runDuplicatesCheck,
} from "./drift-ai/duplicates.js";
import {
  collapseRepoPath,
  DEFAULT_DRIFT_AI_CONFIG,
  globsForIgnoredPaths,
  type DriftAiConfig,
  loadDriftAiConfig,
  matchesAnyGlob,
  pathEscapesRepo,
  pathHasAnyPrefix,
  pathHasAnySegment,
} from "./drift-ai/config.js";
import {
  defaultBufferGitRunner,
  defaultStatRunner,
  discoverCurrentFiles,
  normalizeCurrentRoots,
  resolveStrictRepoRoot,
  type BufferGitRunner,
  type StatRunner,
} from "./drift-ai/current-inventory.js";
import { DriftAiError } from "./drift-ai/errors.js";
import {
  defaultDirectoryListing,
  type DirectoryListing,
  runGhostFilesCheck,
} from "./drift-ai/ghost-files.js";
import { buildSourceExtensions, toChangedScopeFile } from "./drift-ai/scope.js";
import type { DetectorScope, ScopeFile, ScopeMode } from "./drift-ai/scope.js";

export { DriftAiError } from "./drift-ai/errors.js";
export {
  buildSourceExtensions,
  BUILT_IN_SOURCE_EXTENSIONS,
  toChangedScopeFile,
  toCurrentScopeFile,
} from "./drift-ai/scope.js";
export type {
  ChangedScopeFile,
  CurrentScopeFile,
  DetectorScope,
  ScopeFile,
  ScopeMode,
} from "./drift-ai/scope.js";

export type DriftCheckId = "duplicates" | "ghost-files" | "comments";

export const ALL_CHECKS: readonly DriftCheckId[] = ["duplicates", "ghost-files", "comments"];

export type ChangedFileStatus = "added" | "modified" | "renamed" | "copied" | "deleted";

export type ChangedFile = {
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly previousPath?: string;
};

export type DriftFinding = {
  readonly check: DriftCheckId;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly relatedFiles?: readonly string[];
};

export type DriftReport = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly base: string | null;
  readonly resolvedRef: string | null;
  readonly roots: readonly string[];
  readonly configPath: string | null;
  readonly enabledChecks: readonly DriftCheckId[];
  readonly skippedChecks: readonly DriftCheckId[];
  readonly scope: readonly ScopeFile[];
  readonly findings: readonly DriftFinding[];
};

export type DriftFindingChunk = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly check: DriftCheckId;
  readonly findings: readonly DriftFinding[];
};

export type DriftChunkManifestEntry = {
  readonly index: number;
  readonly path: string;
  readonly check: DriftCheckId;
  readonly findingCount: number;
};

export type DriftChunkManifest = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunks: readonly DriftChunkManifestEntry[];
};

export type CliOptions = {
  readonly scopeMode: ScopeMode;
  readonly base: string;
  readonly baseExplicit: boolean;
  readonly checks: readonly DriftCheckId[];
  readonly format: "text" | "json";
  readonly roots: readonly string[];
  readonly configPath?: string;
  readonly outputPath?: string;
  readonly chunkDir?: string;
  readonly chunkSize?: number;
};

export const DEFAULT_BASE = "main";
export const DEFAULT_SCOPE_MODE: ScopeMode = "changed";
export const DEFAULT_CHUNK_SIZE = 75;

// Directory prefixes that are never useful drift inputs: generated, vendored,
// or large-binary surfaces. Compared with `startsWith`, so always include the
// trailing slash.
export const DEFAULT_IGNORE_DIR_PREFIXES: readonly string[] = [
  "node_modules/",
  "vendor/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  "out/",
  "target/",
  "generated/",
  "reports/",
  "tmp/",
  ".git/",
  ".husky/",
  ".claude/worktrees/",
];

export const DEFAULT_IGNORE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".lock",
];

export const DEFAULT_IGNORE_FILES: readonly string[] = [
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
];

class DriftAiHelp extends Error {
  constructor() {
    super(usage());
    this.name = "DriftAiHelp";
  }
}

const CHECK_KEYS = new Set<string>(ALL_CHECKS);

function isCheckId(value: string): value is DriftCheckId {
  return CHECK_KEYS.has(value);
}

function usage(): string {
  return [
    "Usage:",
    "  bun run drift:ai",
    "  bun run drift:ai --scope <changed|current>",
    "  bun run drift:ai --base <ref>",
    "  bun run drift:ai --check <duplicates|ghost-files|comments|all> [--check <...>]",
    "  bun run drift:ai --root <path> [--root <path>]",
    "  bun run drift:ai --config <path>",
    "  bun run drift:ai --format <text|json>",
    "  bun run drift:ai --output <path>",
    "  bun run drift:ai --chunk-dir <path> [--chunk-size <count>]",
    "",
    "Report-only. Changed scope is the default; current scope audits the working tree.",
  ].join("\n");
}

function readOptionValue(
  arg: string,
  argv: readonly string[],
  index: number,
): {
  value: string;
  nextIndex: number;
} {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex >= 0) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }
  const next = argv[index + 1];
  if (next === undefined) throw new DriftAiError(`${arg} requires a value.\n${usage()}`);
  return { value: next, nextIndex: index + 1 };
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let scopeMode: ScopeMode = DEFAULT_SCOPE_MODE;
  let base = DEFAULT_BASE;
  let baseExplicit = false;
  let format: "text" | "json" = "text";
  const roots: string[] = [];
  let configPath: string | undefined;
  let outputPath: string | undefined;
  let chunkDir: string | undefined;
  let chunkSize: number | undefined;
  const requested: DriftCheckId[] = [];
  let allRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) throw new DriftAiError("Empty arguments are not supported.");
    if (arg === "--help" || arg === "-h") {
      throw new DriftAiHelp();
    }
    if (arg === "--scope" || arg.startsWith("--scope=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (parsed.value !== "changed" && parsed.value !== "current") {
        throw new DriftAiError("--scope requires changed or current.");
      }
      scopeMode = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--base" || arg.startsWith("--base=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new DriftAiError("--base requires a ref.");
      base = parsed.value;
      baseExplicit = true;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--check" || arg.startsWith("--check=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) {
        throw new DriftAiError("--check requires duplicates, ghost-files, comments, or all.");
      }
      if (parsed.value === "all") {
        allRequested = true;
      } else if (isCheckId(parsed.value)) {
        if (!requested.includes(parsed.value)) requested.push(parsed.value);
      } else {
        throw new DriftAiError(`Unknown check: ${parsed.value}\n${usage()}`);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--root" || arg.startsWith("--root=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new DriftAiError("--root requires a path.");
      roots.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--config" || arg.startsWith("--config=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new DriftAiError("--config requires a path.");
      configPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (parsed.value !== "text" && parsed.value !== "json") {
        throw new DriftAiError("--format requires text or json.");
      }
      format = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--output" || arg.startsWith("--output=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new DriftAiError("--output requires a path.");
      outputPath = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--chunk-dir" || arg.startsWith("--chunk-dir=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!parsed.value) throw new DriftAiError("--chunk-dir requires a path.");
      chunkDir = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (arg === "--chunk-size" || arg.startsWith("--chunk-size=")) {
      const parsed = readOptionValue(arg, argv, index);
      if (!/^[1-9]\d*$/u.test(parsed.value)) {
        throw new DriftAiError("--chunk-size requires a positive integer.");
      }
      chunkSize = Number(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    throw new DriftAiError(`Unknown argument: ${arg}\n${usage()}`);
  }

  if (scopeMode === "current" && baseExplicit) {
    throw new DriftAiError(
      "--scope current does not accept --base; current scope has no merge base.",
    );
  }
  if (scopeMode === "changed" && roots.length > 0) {
    throw new DriftAiError("--root is only valid with --scope current.");
  }
  if (chunkSize !== undefined && chunkDir === undefined) {
    throw new DriftAiError("--chunk-size is only valid with --chunk-dir.");
  }

  const checks = allRequested || requested.length === 0 ? [...ALL_CHECKS] : requested;
  return {
    scopeMode,
    base,
    baseExplicit,
    checks,
    format,
    roots,
    ...(configPath === undefined ? {} : { configPath }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(chunkDir === undefined ? {} : { chunkDir, chunkSize: chunkSize ?? DEFAULT_CHUNK_SIZE }),
  };
}

export type GitRunner = (args: readonly string[]) => string;

export function defaultGitRunner(): GitRunner {
  return (args) => execFileSync("git", [...args], { encoding: "utf8" });
}

// jscpd is run with the repo root as cwd so the bin lookup and the report
// paths line up with the changed-file paths produced by `git diff`. Falls back
// to process.cwd() when git cannot answer (e.g., a stub git in tests).
export function resolveRepoRoot(git: GitRunner): string {
  try {
    const out = git(["rev-parse", "--show-toplevel"]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to process.cwd().
  }
  return process.cwd();
}

export function resolveBaseRef(base: string, git: GitRunner): string {
  for (const candidate of [base, `origin/${base}`]) {
    try {
      git(["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new DriftAiError(
    `drift:ai: neither '${base}' nor 'origin/${base}' exists. Pass --base <ref> with a reachable ref.`,
  );
}

export function resolveMergeBase(ref: string, git: GitRunner): string {
  try {
    const out = git(["merge-base", ref, "HEAD"]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to the explicit drift:ai error below.
  }
  throw new DriftAiError(`drift:ai: could not find a merge base between '${ref}' and HEAD.`);
}

const NAME_STATUS_RE = /^([ACMRD])(\d*)\t(.+?)(?:\t(.+))?$/u;

export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (line.length === 0) continue;
    const match = NAME_STATUS_RE.exec(line);
    if (!match) continue;
    const code = match[1];
    const first = match[3];
    const second = match[4];
    if (!first) continue;
    const status = mapStatus(code);
    if (!status) continue;
    if (second) {
      files.push({ path: second, status, previousPath: first });
    } else {
      files.push({ path: first, status });
    }
  }
  return files;
}

function mapStatus(code: string | undefined): ChangedFileStatus | undefined {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "D":
      return "deleted";
    default:
      return undefined;
  }
}

export function isIgnoredPath(filePath: string, ignore = DEFAULT_DRIFT_AI_CONFIG.ignore): boolean {
  const normalized = filePath.split(path.sep).join("/");
  const ignoredSegments = new Set(ignore.segments);
  if (pathHasAnySegment(normalized, ignoredSegments)) return true;
  if (pathHasAnyPrefix(normalized, ignore.prefixes)) return true;
  if (matchesAnyGlob(normalized, ignore.globs)) return true;
  if (DEFAULT_IGNORE_FILES.includes(path.basename(normalized))) return true;
  const ext = path.extname(normalized).toLowerCase();
  if (DEFAULT_IGNORE_EXTENSIONS.includes(ext)) return true;
  return false;
}

export function filterScope(
  files: readonly ChangedFile[],
  ignore = DEFAULT_DRIFT_AI_CONFIG.ignore,
): ChangedFile[] {
  return files.filter((file) => !isIgnoredPath(file.path, ignore));
}

export function discoverChangedFiles(ref: string, git: GitRunner): ChangedFile[] {
  const changed = parseNameStatus(git(["diff", "--name-status", ref]));
  const untracked = parseUntrackedFiles(git(["ls-files", "--others", "--exclude-standard"]));
  const merged = new Map<string, ChangedFile>();
  for (const file of changed) {
    merged.set(file.path, file);
  }
  for (const file of untracked) {
    if (!merged.has(file.path)) merged.set(file.path, file);
  }
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function parseUntrackedFiles(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const raw of output.split("\n")) {
    const filePath = raw.replace(/\r$/u, "");
    if (filePath.length === 0) continue;
    files.push({ path: filePath, status: "added" });
  }
  return files;
}

export type CheckContext = {
  readonly detectorScope: DetectorScope;
  readonly jscpd: JscpdRunner;
  readonly listDirectory: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
  readonly readFile: FileReader;
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
      // Shared ignore.globs are applied during discovery for current mode, so
      // duplicates current mode does not need to reapply them.
      // Mirrors ghost-files behavior.
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
      // Shared ignore globs are applied during discovery for current mode, so
      // ghost-files does not reapply them.
      excludeGlobs:
        context.detectorScope.scopeMode === "current"
          ? config.checks["ghost-files"].excludeGlobs
          : ghostExcludeGlobs(config),
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
};

// All checks are wired through the same runners; detectors branch on the
// shared scope contract where current-mode behavior differs.
const IMPLEMENTED_CHECKS: ReadonlySet<DriftCheckId> = new Set<DriftCheckId>([
  "duplicates",
  "ghost-files",
  "comments",
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
  const enabled = options.checks.filter((check) => IMPLEMENTED_CHECKS.has(check));
  const skipped = options.checks.filter((check) => !IMPLEMENTED_CHECKS.has(check));
  const findings: DriftFinding[] = [];
  const inventoryByDir = inventoryByDirForReport(detectorScope, context.inventoryByDir);
  for (const check of enabled) {
    findings.push(
      ...CHECK_RUNNERS[check]({
        detectorScope,
        jscpd: context.jscpd,
        listDirectory: context.listDirectory,
        ...(inventoryByDir === undefined ? {} : { inventoryByDir }),
        readFile: context.readFile,
        ...(context.config === undefined ? {} : { config: context.config }),
        roots: options.roots.length > 0 ? options.roots : configFor(context).roots,
        ...(context.sourceExtensions === undefined
          ? {}
          : { sourceExtensions: context.sourceExtensions }),
        ...(context.warnStderr === undefined ? {} : { warnStderr: context.warnStderr }),
      }),
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

function inventoryByDirForReport(
  detectorScope: DetectorScope,
  inventoryByDir: ReadonlyMap<string, readonly string[]> | undefined,
): ReadonlyMap<string, readonly string[]> | undefined {
  if (inventoryByDir !== undefined) return inventoryByDir;
  if (detectorScope.scopeMode !== "current") return undefined;
  return buildInventoryByDir(detectorScope.files);
}

// No-op defaults are safe for direct buildReport calls in tests and for any
// caller that does not need a real runner. The CLI entrypoint always provides
// defaultJscpdRunner, defaultDirectoryListing, and defaultFileReader via
// runDriftAi.
function noopJscpdRunner(): JscpdRunner {
  return () => ({ ok: true, reportJson: '{"duplicates":[]}' });
}

function noopDirectoryListing(): DirectoryListing {
  return () => [];
}

function noopFileReader(): FileReader {
  return () => undefined;
}

export function formatText(report: DriftReport): string {
  const lines: string[] = [];
  if (report.scopeMode === "changed") {
    const base = report.base ?? DEFAULT_BASE;
    const resolvedRef = report.resolvedRef ?? base;
    const refSuffix = resolvedRef === base ? "" : ` (resolved ${resolvedRef})`;
    lines.push(`drift:ai (report-only) -- scope changed -- base ${base}${refSuffix}`);
  } else {
    lines.push("drift:ai (report-only) -- scope current");
    lines.push(`  roots: ${report.roots.length === 0 ? "./" : report.roots.join(", ")}`);
  }
  lines.push(`  scope: ${report.scope.length} file(s) considered after ignore filters`);
  if (report.skippedChecks.length > 0) {
    lines.push(`  skipped: ${report.skippedChecks.join(", ")} (no scanner wired yet)`);
  }
  if (report.findings.length === 0) {
    if (report.enabledChecks.length === 0) {
      // Reachable only when an in-flight leaf adds a new id to ALL_CHECKS
      // before wiring it into IMPLEMENTED_CHECKS. The message keeps the
      // CLI self-describing during that handoff window.
      lines.push("drift:ai: no implemented checks selected.");
    } else {
      lines.push(`OK: no findings from checks: ${report.enabledChecks.join(", ")}`);
    }
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(`WARN ${finding.check}: ${finding.file} — ${finding.message}`);
    if (finding.hint) lines.push(`  FIX: ${finding.hint}`);
  }
  return lines.join("\n");
}

export function formatJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2);
}

export function groupFindingsForChunks(
  findings: readonly DriftFinding[],
  scopeMode: ScopeMode,
  roots: readonly string[],
  enabledChecks: readonly DriftCheckId[],
  chunkSize: number,
): DriftFindingChunk[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new DriftAiError("drift:ai: chunkSize must be a positive integer.");
  }
  const grouped = groupFindingsByCheck(findings, enabledChecks);
  const chunkCount = Math.ceil(grouped.length / chunkSize);
  const chunks: DriftFindingChunk[] = [];
  for (let offset = 0; offset < grouped.length; offset += chunkSize) {
    const slice = grouped.slice(offset, offset + chunkSize);
    const first = slice[0];
    if (first === undefined) continue;
    chunks.push({
      schemaVersion: 1,
      scopeMode,
      roots,
      enabledChecks,
      totalFindings: findings.length,
      chunkSize,
      chunkIndex: chunks.length + 1,
      chunkCount,
      check: first.check,
      findings: slice,
    });
  }
  return chunks;
}

export function buildChunkManifest(
  scopeMode: ScopeMode,
  roots: readonly string[],
  enabledChecks: readonly DriftCheckId[],
  totalFindings: number,
  chunkSize: number,
  chunks: readonly DriftFindingChunk[],
): DriftChunkManifest {
  return {
    schemaVersion: 1,
    scopeMode,
    roots,
    enabledChecks,
    totalFindings,
    chunkSize,
    chunks: chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      path: chunkFilename(chunk.chunkIndex, chunk.check),
      check: chunk.check,
      findingCount: chunk.findings.length,
    })),
  };
}

function groupFindingsByCheck(
  findings: readonly DriftFinding[],
  enabledChecks: readonly DriftCheckId[],
): DriftFinding[] {
  const grouped: DriftFinding[] = [];
  for (const check of orderedChunkChecks(findings, enabledChecks)) {
    grouped.push(...findings.filter((finding) => finding.check === check));
  }
  return grouped;
}

function orderedChunkChecks(
  findings: readonly DriftFinding[],
  enabledChecks: readonly DriftCheckId[],
): DriftCheckId[] {
  const present = new Set(findings.map((finding) => finding.check));
  const ordered = enabledChecks.filter((check) => present.has(check));
  const extras = [...present]
    .filter((check) => !enabledChecks.includes(check))
    .sort((left, right) => left.localeCompare(right, "en"));
  return [...ordered, ...extras];
}

function chunkFilename(globalIndex: number, check: DriftCheckId): string {
  // Three digits are enough for the 75-finding default and foreseeable drift
  // totals. The check segment names the first finding in the chunk; chunks can
  // straddle check groups when a group ends mid-chunk.
  return `${String(globalIndex).padStart(3, "0")}-${check}.json`;
}

export type RunOptions = {
  readonly argv: readonly string[];
  // Test override for string Git commands used by changed scope and current
  // repo-root resolution.
  readonly git?: GitRunner;
  // Test override for current-scope NUL-delimited Git inventory.
  readonly gitBuffer?: BufferGitRunner;
  // Test override for current-scope file-kind checks.
  readonly stat?: StatRunner;
  // Test override for validating explicit current-scope roots.
  readonly rootExists?: (absolutePath: string) => boolean;
  // Test override — the CLI entrypoint constructs defaultJscpdRunner with the
  // resolved repo root so the subprocess works regardless of the caller cwd.
  readonly jscpd?: JscpdRunner;
  // Test override — the CLI entrypoint constructs defaultDirectoryListing
  // with the resolved repo root so peer lookups land on the real filesystem.
  readonly listDirectory?: DirectoryListing;
  // Test override — the CLI entrypoint constructs defaultFileReader with the
  // resolved repo root so source reads stay inside the repo.
  readonly readFile?: FileReader;
  readonly warnStderr?: (message: string) => void;
  readonly writer?: (path: string, contents: string) => void;
};

type ReportWriter = (path: string, contents: string) => void;

export type RunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly report?: DriftReport;
};

type PreparedRun = {
  readonly repoRoot: string;
  readonly config: DriftAiConfig;
  readonly configPath: string | null;
  readonly resolvedRef: string | null;
  readonly roots: readonly string[];
  readonly detectorScope: DetectorScope;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
  readonly sourceExtensions: ReadonlySet<string>;
};

export function runDriftAi(options: RunOptions): RunResult {
  let parsed: CliOptions;
  try {
    parsed = parseArgs(options.argv);
  } catch (err) {
    if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
    if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
    throw err;
  }

  let prepared: PreparedRun;
  try {
    prepared =
      parsed.scopeMode === "current"
        ? prepareCurrentRun(parsed, options)
        : prepareChangedRun(parsed, options);
  } catch (err) {
    if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
    throw err;
  }

  const reportOptions = optionsForReport(parsed, prepared);
  const jscpd = options.jscpd ?? defaultJscpdRunner({ repoRoot: prepared.repoRoot });
  const listDirectory = options.listDirectory ?? defaultDirectoryListing(prepared.repoRoot);
  const readFile = options.readFile ?? defaultFileReader(prepared.repoRoot);
  const warnStderr = options.warnStderr ?? defaultWarnStderr;
  warnForUnsupportedDuplicateExtensions(prepared.config, parsed.checks, warnStderr);
  const report = buildReport(reportOptions, prepared.resolvedRef, prepared.detectorScope, {
    detectorScope: prepared.detectorScope,
    jscpd,
    listDirectory,
    ...(prepared.inventoryByDir === undefined ? {} : { inventoryByDir: prepared.inventoryByDir }),
    readFile,
    config: prepared.config,
    roots: prepared.roots,
    sourceExtensions: prepared.sourceExtensions,
    warnStderr,
  });
  const rendered = parsed.format === "json" ? formatJson(report) : formatText(report);
  const writer = options.writer ?? defaultReportWriter;
  const stdout = writeReportOutputs(parsed, rendered, report, writer, warnStderr);
  return { exitCode: 0, stdout, report };
}

function defaultReportWriter(target: string, contents: string): void {
  writeFileSync(target, contents);
}

function writeReportOutputs(
  parsed: CliOptions,
  rendered: string,
  report: DriftReport,
  writer: ReportWriter,
  warnStderr: (message: string) => void,
): string {
  const primary = writePrimaryReport(parsed, rendered, writer);
  const chunkPointer = writeChunkOutput(parsed, report, writer);
  if (chunkPointer === undefined) return primary;
  // When stdout carries the JSON report (no --output), appending a human
  // pointer would corrupt downstream JSON parsers — route it to stderr instead.
  if (parsed.format === "json" && parsed.outputPath === undefined) {
    warnStderr(chunkPointer);
    return primary;
  }
  return `${primary}\n${chunkPointer}`;
}

function writePrimaryReport(parsed: CliOptions, rendered: string, writer: ReportWriter): string {
  if (parsed.outputPath === undefined) return rendered;
  // POSIX convention: written files end with a single newline.
  writer(parsed.outputPath, `${rendered}\n`);
  return `drift:ai: wrote ${parsed.format} report to ${parsed.outputPath}`;
}

function writeChunkOutput(
  parsed: CliOptions,
  report: DriftReport,
  writer: ReportWriter,
): string | undefined {
  if (parsed.chunkDir === undefined) return undefined;
  const chunkSize = parsed.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunks = groupFindingsForChunks(
    report.findings,
    report.scopeMode,
    report.roots,
    report.enabledChecks,
    chunkSize,
  );
  const manifest = buildChunkManifest(
    report.scopeMode,
    report.roots,
    report.enabledChecks,
    report.findings.length,
    chunkSize,
    chunks,
  );
  mkdirSync(parsed.chunkDir, { recursive: true });
  writeChunkFiles(parsed.chunkDir, chunks, writer);
  writer(path.join(parsed.chunkDir, "manifest.json"), `${formatStableJson(manifest)}\n`);
  return chunkPointer(parsed.chunkDir, manifest);
}

function writeChunkFiles(
  chunkDir: string,
  chunks: readonly DriftFindingChunk[],
  writer: ReportWriter,
): void {
  for (const chunk of chunks) {
    const filename = chunkFilename(chunk.chunkIndex, chunk.check);
    writer(path.join(chunkDir, filename), `${formatStableJson(chunk)}\n`);
  }
}

function chunkPointer(chunkDir: string, manifest: DriftChunkManifest): string {
  const manifestPath = path.join(chunkDir, "manifest.json");
  return `chunks: ${manifestPath} (${manifest.chunks.length} chunk(s), ${manifest.totalFindings} finding(s))`;
}

function formatStableJson(value: DriftFindingChunk | DriftChunkManifest): string {
  return JSON.stringify(value, null, 2);
}

function defaultWarnStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function warnForUnsupportedDuplicateExtensions(
  config: DriftAiConfig,
  checks: readonly DriftCheckId[],
  warnStderr: (message: string) => void,
): void {
  if (!checks.includes("duplicates")) return;
  const unsupported = unsupportedDuplicateExtensions(config.additionalSourceExtensions);
  if (unsupported.length === 0) return;
  warnStderr(
    `drift:ai: configured additionalSourceExtensions [${unsupported.join(", ")}] are not covered by jscpd; duplicates will not flag them.`,
  );
}

function unsupportedDuplicateExtensions(additionalSourceExtensions: readonly string[]): string[] {
  return additionalSourceExtensions.filter((extension) => !JSCPD_SUPPORTED_EXTENSIONS.has(extension));
}

function prepareChangedRun(parsed: CliOptions, options: RunOptions): PreparedRun {
  const explicitConfig = loadExplicitChangedConfig(parsed);
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const loadedConfig = explicitConfig ?? loadDriftAiConfig({ repoRoot });
  const sourceExtensions = buildSourceExtensions(loadedConfig.config.additionalSourceExtensions);
  const resolvedRef = resolveBaseRef(parsed.base, git);
  const changedFiles = filterScope(
    discoverChangedFiles(resolveMergeBase(resolvedRef, git), git),
    loadedConfig.config.ignore,
  );
  return {
    repoRoot,
    config: loadedConfig.config,
    configPath: loadedConfig.configPath,
    resolvedRef,
    roots: parsed.roots.length > 0 ? parsed.roots : loadedConfig.config.roots,
    detectorScope: {
      scopeMode: "changed",
      files: changedFiles.map(toChangedScopeFile),
    },
    sourceExtensions,
  };
}

function prepareCurrentRun(parsed: CliOptions, options: RunOptions): PreparedRun {
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
    roots,
    detectorScope: { scopeMode: "current", files },
    inventoryByDir: buildInventoryByDir(files),
    sourceExtensions,
  };
}

export function buildInventoryByDir(
  files: readonly ScopeFile[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    if (file.scope !== "current") continue;
    const directory = path.posix.dirname(file.path);
    const siblings = grouped.get(directory) ?? [];
    siblings.push(file.path);
    grouped.set(directory, siblings);
  }
  return sortedInventoryByDir(grouped);
}

function sortedInventoryByDir(
  grouped: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const sorted = new Map<string, readonly string[]>();
  const directories = [...grouped.keys()].sort((left, right) => left.localeCompare(right, "en"));
  for (const directory of directories) {
    sorted.set(directory, [...(grouped.get(directory) ?? [])].sort(comparePaths));
  }
  return sorted;
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, "en");
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

function optionsForReport(parsed: CliOptions, prepared: PreparedRun): CliOptions {
  return {
    ...parsed,
    roots: prepared.roots,
    ...(prepared.configPath === null ? {} : { configPath: prepared.configPath }),
  };
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runDriftAi({ argv: process.argv.slice(2) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
