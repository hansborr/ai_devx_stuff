import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_IGNORE_FILES,
} from "../drift-ai.js";
import {
  collapseRepoPath,
  matchesAnyGlob,
  normalizeRepoPath,
  pathEscapesRepo,
  pathHasAnyPrefix,
  pathHasAnySegment,
  type DriftAiIgnoreConfig,
} from "./config.js";
import { DriftAiError } from "./errors.js";
import { type CurrentScopeFile, toCurrentScopeFile } from "./scope.js";

export type StringGitRunner = (args: readonly string[]) => string;
export type BufferGitRunner = (args: readonly string[]) => Buffer;
export type DefaultBufferGitRunnerOptions = { readonly repoRoot: string };
type StatLike = { readonly isFile: () => boolean };
export type StatRunner = (absolutePath: string) => StatLike | undefined;

const GIT_CURRENT_INVENTORY_ARGS = [
  "ls-files",
  "-z",
  "--cached",
  "--others",
  "--exclude-standard",
];

export function resolveStrictRepoRoot(git: StringGitRunner): string {
  let output: string;
  try {
    output = git(["rev-parse", "--show-toplevel"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DriftAiError(`drift:ai: could not resolve Git repo root: ${message}`);
  }
  const repoRoot = output.trim();
  if (repoRoot.length === 0) {
    throw new DriftAiError("drift:ai: could not resolve Git repo root: git returned an empty path.");
  }
  return repoRoot;
}

export function defaultBufferGitRunner(options: DefaultBufferGitRunnerOptions): BufferGitRunner {
  return (args) => {
    // Run inventory from repoRoot so git returns repo-relative paths.
    const output = execFileSync("git", [...args], {
      cwd: options.repoRoot,
      encoding: "buffer",
    });
    if (Buffer.isBuffer(output)) return output;
    // Node's types allow strings for other encodings; this runner requires bytes.
    throw new DriftAiError("drift:ai: git returned text output where bytes were required.");
  };
}

export function defaultStatRunner(): StatRunner {
  return (absolutePath) => {
    try {
      return lstatSync(absolutePath);
    } catch {
      return undefined;
    }
  };
}

export type DiscoverCurrentFilesOptions = {
  readonly repoRoot: string;
  readonly gitBuffer: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly ignore: DriftAiIgnoreConfig;
  readonly sourceExtensions: ReadonlySet<string>;
  readonly roots?: readonly string[];
};

export function discoverCurrentFiles(
  options: DiscoverCurrentFilesOptions,
): readonly CurrentScopeFile[] {
  const stat = options.stat ?? defaultStatRunner();
  const roots = normalizeCurrentRoots(options.roots ?? []);
  const paths = parseGitInventory(options.gitBuffer(GIT_CURRENT_INVENTORY_ARGS))
    .filter((filePath) => isWithinRoots(filePath, roots))
    .filter((filePath) => !isIgnoredCurrentPathForRoots(filePath, roots, options.ignore))
    .filter((filePath) => isRegularFile(options.repoRoot, filePath, stat))
    .filter((filePath) => hasSourceExtension(filePath, options.sourceExtensions))
    .sort((left, right) => left.localeCompare(right, "en"));

  return paths.map(toCurrentScopeFile);
}

export function isIgnoredCurrentPath(filePath: string, ignore: DriftAiIgnoreConfig): boolean {
  const normalized = normalizeInventoryPath(filePath);
  if (pathHasAnySegment(normalized, new Set(ignore.segments))) return true;
  if (pathHasAnyPrefix(normalized, ignore.prefixes)) return true;
  if (matchesAnyGlob(normalized, ignore.globs)) return true;
  if (DEFAULT_IGNORE_FILES.includes(path.posix.basename(normalized))) return true;
  return DEFAULT_IGNORE_EXTENSIONS.includes(path.posix.extname(normalized).toLowerCase());
}

function parseGitInventory(output: Buffer): string[] {
  const paths = new Set<string>();
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    addGitPath(paths, output.subarray(start, index));
    start = index + 1;
  }
  if (start < output.length) addGitPath(paths, output.subarray(start));
  return [...paths];
}

function addGitPath(paths: Set<string>, chunk: Buffer): void {
  if (chunk.length === 0) return;
  const normalized = normalizeInventoryPath(chunk.toString("utf8"));
  if (normalized.length > 0) paths.add(normalized);
}

function normalizeInventoryPath(filePath: string): string {
  return normalizeRepoPath(filePath.replace(/\\/gu, "/"));
}

export function normalizeCurrentRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map(normalizeCurrentRoot))].sort(
    (left, right) => right.length - left.length || left.localeCompare(right, "en"),
  );
}

function normalizeCurrentRoot(root: string): string {
  const collapsed = collapseRepoPath(root);
  if (pathEscapesRepo(collapsed)) {
    throw new DriftAiError(`drift:ai: root '${root}' must stay inside the repo.`);
  }
  return collapsed;
}

function isWithinRoots(filePath: string, roots: readonly string[]): boolean {
  if (roots.length === 0 || roots.includes(".")) return true;
  return roots.some((root) => filePath === root || filePath.startsWith(`${root}/`));
}

// Explicit roots ignore their own matched prefix, while nested ignored suffixes still drop.
function isIgnoredCurrentPathForRoots(
  filePath: string,
  roots: readonly string[],
  ignore: DriftAiIgnoreConfig,
): boolean {
  const root = matchingRootFor(filePath, roots);
  if (root === undefined || root === ".") return isIgnoredCurrentPath(filePath, ignore);
  return isIgnoredCurrentPath(suffixForRoot(filePath, root), ignore);
}

function matchingRootFor(filePath: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    if (root === ".") return root;
    if (filePath === root || filePath.startsWith(`${root}/`)) return root;
  }
  return undefined;
}

function suffixForRoot(filePath: string, root: string): string {
  if (filePath === root) return "";
  return filePath.slice(root.length + 1);
}

function isRegularFile(repoRoot: string, filePath: string, stat: StatRunner): boolean {
  const fileStat = stat(path.resolve(repoRoot, filePath));
  return fileStat?.isFile() === true;
}

function hasSourceExtension(
  filePath: string,
  sourceExtensions: ReadonlySet<string>,
): boolean {
  return sourceExtensions.has(path.posix.extname(filePath).toLowerCase());
}
