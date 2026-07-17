import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// Shared git plumbing for the scripts substrate. This is the superset home for
// the injectable runner and the low-level parsers that several tools re-derive
// (merge-base, name-status, repo-root). Callers layer their own domain types and
// error handling on top: drift-ai maps `NameStatusEntry` onto its `ChangedFile`
// and wraps `mergeBase` in a `DriftAiError`, while lint-ratchet and friends have
// subtly different rename/tracked-file handling — so the primitives here stay
// deliberately generic (raw codes, `string | undefined` on failure) and let each
// consumer decide policy. drift-ai is the first adopter; further tools migrate
// one slice at a time.

/** An injectable git command runner: takes argv (without the leading "git") and returns stdout. */
export type GitRunner = (args: readonly string[]) => string;

/** The default runner: shells out to the system `git` and returns UTF-8 stdout. */
export function defaultGitRunner(options?: { readonly cwd?: string }): GitRunner {
  return (args) => execFileSync("git", [...args], { cwd: options?.cwd, encoding: "utf8" });
}

/** Anchor a git command at the repository root, independent of the invocation cwd. */
export function gitRepoRootArgs(repoRoot: string, args: readonly string[]): string[] {
  return ["-C", repoRoot, ...args];
}

export function gitStatusPorcelainArgs(
  repoRoot: string,
  excludedPaths: readonly string[],
): string[] {
  const exclusions = gitExclusionPathspecs(repoRoot, excludedPaths);
  if (exclusions.length === 0) return ["status", "--porcelain"];
  return ["status", "--porcelain", "--untracked-files=all", "--", ".", ...exclusions];
}

function gitChangedPathsArgs(repoRoot: string, excludedPaths: readonly string[]): string[] {
  return [
    "diff",
    "--name-only",
    "-z",
    "HEAD",
    "--",
    ".",
    ...gitExclusionPathspecs(repoRoot, excludedPaths),
  ];
}

function gitUntrackedPathsArgs(repoRoot: string, excludedPaths: readonly string[]): string[] {
  return [
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
    "--",
    ".",
    ...gitExclusionPathspecs(repoRoot, excludedPaths),
  ];
}

/**
 * Hash every changed or untracked working-tree path and its current content.
 * `null` means a git content probe failed; file-read races remain represented
 * by the stable `missing` marker and are caught by the surrounding snapshots.
 */
export function captureGitStateFingerprint(
  git: GitRunner,
  repoRoot: string,
  excludedPaths: readonly string[],
): string | null {
  const changed = runRawGitProbe(
    git,
    gitRepoRootArgs(repoRoot, gitChangedPathsArgs(repoRoot, excludedPaths)),
  );
  const untracked = runRawGitProbe(
    git,
    gitRepoRootArgs(repoRoot, gitUntrackedPathsArgs(repoRoot, excludedPaths)),
  );
  if (changed === null || untracked === null) return null;
  const dirtyPaths = new Set([...parseNulPaths(changed), ...parseNulPaths(untracked)]);
  const stateToken = [...dirtyPaths]
    .sort()
    .map((path) => `${path}\0${workingTreeContentHash(repoRoot, path)}`)
    .join("\0");
  return createHash("sha256").update(stateToken).digest("hex");
}

function runRawGitProbe(git: GitRunner, args: readonly string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function parseNulPaths(output: string): string[] {
  return output.split("\0").filter((path) => path.length > 0);
}

function workingTreeContentHash(repoRoot: string, path: string): string {
  try {
    return createHash("sha256")
      .update(readFileSync(join(repoRoot, path)))
      .digest("hex");
  } catch {
    return "missing";
  }
}

function gitExclusionPathspecs(repoRoot: string, excludedPaths: readonly string[]): string[] {
  return excludedPaths.flatMap((artifactPath) => {
    const absoluteArtifactPath = isAbsolute(artifactPath)
      ? artifactPath
      : resolve(repoRoot, artifactPath);
    const repoRelative = relative(repoRoot, absoluteArtifactPath);
    if (
      repoRelative.length === 0 ||
      repoRelative.startsWith(`..${sep}`) ||
      isAbsolute(repoRelative)
    ) {
      return [];
    }
    return [`:(top,exclude,literal)${repoRelative.split(sep).join("/")}`];
  });
}

/** Resolve the working-tree root, falling back to `process.cwd()` when git cannot answer. */
export function resolveRepoRoot(git: GitRunner): string {
  try {
    const out = git(["rev-parse", "--show-toplevel"]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to process.cwd().
  }
  return process.cwd();
}

/**
 * List repository-tracked files via `git ls-files -z`, NUL-split. `-z` disables
 * git's `core.quotePath` C-quoting, so pathnames containing non-ASCII bytes,
 * spaces, or even newlines (all legal in git) survive verbatim instead of being
 * quoted or split apart — a newline-split of plain `ls-files` silently drops or
 * corrupts such files. Empty entries (the trailing NUL) are dropped. Returned in
 * git's own order — callers apply their own sort, since consumers order
 * differently (default lexical vs. locale-aware).
 */
export function listTrackedFiles(git: GitRunner): string[] {
  const files: string[] = [];
  for (const file of git(["ls-files", "-z"]).split("\0")) {
    if (file.length > 0) files.push(file);
  }
  return files;
}

/** The five porcelain `git diff --name-status` codes shared across callers. */
export type NameStatusCode = "A" | "C" | "M" | "R" | "D";

/**
 * One parsed `git diff --name-status` row. `path` is the current path (the
 * rename/copy destination for R/C rows) and `previousPath` is the source path,
 * present only for renames and copies. The raw `code` is preserved so callers
 * with differing rename handling can map it as they see fit.
 */
export type NameStatusEntry = {
  readonly code: NameStatusCode;
  readonly path: string;
  readonly previousPath?: string;
};

/** Read the leading letter of a name-status field, accepting only the five known codes. */
export function nameStatusCode(statusField: string | undefined): NameStatusCode | undefined {
  const code = statusField?.[0];
  if (code === "A" || code === "C" || code === "M" || code === "R" || code === "D") return code;
  return undefined;
}

/** Parse `git diff --name-status` output into generic code + path entries. */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (line.length === 0) continue;
    const [statusField, first, second] = line.split("\t");
    const code = nameStatusCode(statusField);
    if (code === undefined || first === undefined || first.length === 0) continue;
    if (second) {
      entries.push({ code, path: second, previousPath: first });
    } else {
      entries.push({ code, path: first });
    }
  }
  return entries;
}

/** Resolve the merge base of `ref` and `head`, or `undefined` when none exists or git fails. */
export function mergeBase(ref: string, git: GitRunner, head = "HEAD"): string | undefined {
  try {
    const out = git(["merge-base", ref, head]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to undefined so callers own the "no base" policy.
  }
  return undefined;
}
