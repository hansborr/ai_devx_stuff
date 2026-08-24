import { execFileSync, spawnSync } from "node:child_process";
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

export type GitCheckIgnoreResult =
  | { readonly kind: "spawn-failed"; readonly error: Error }
  | { readonly kind: "ignored-paths-output"; readonly stdout: string }
  | { readonly kind: "not-ignored"; readonly stdout: string }
  | { readonly kind: "unexpected-status"; readonly status: number | null; readonly stderr: string };

/** Run Git's verbose check-ignore probe and classify its operation-specific outcome. */
export function gitCheckIgnore(
  candidatePaths: readonly string[],
  options: { readonly cwd: string },
): GitCheckIgnoreResult {
  const result = spawnSync("git", ["check-ignore", "--stdin", "-v"], {
    cwd: options.cwd,
    encoding: "utf8",
    input: `${candidatePaths.join("\n")}\n`,
  });
  if (result.error !== undefined) return { kind: "spawn-failed", error: result.error };
  if (result.status === 0) return { kind: "ignored-paths-output", stdout: result.stdout };
  if (result.status === 1) return { kind: "not-ignored", stdout: result.stdout };
  return { kind: "unexpected-status", status: result.status, stderr: result.stderr };
}

/**
 * What {@link defaultGitRunner} does with the child git process's stderr.
 *
 * - `"inherit"` (the default) is `execFileSync`'s own behaviour: git's
 *   diagnostics reach the parent's stderr *and* the thrown error's `message`.
 * - `"captured"` pipes stderr instead of forwarding it, so the terminal stays
 *   quiet while the thrown error still carries git's diagnostics. Use it for
 *   probes whose failure the caller folds into its own message.
 * - `"discarded"` drops stderr entirely, so neither the terminal nor the thrown
 *   error carries it — the failure message is the bare `Command failed: ...`.
 *   Use it for probes whose failure is a fully-handled expected outcome.
 *
 * All non-inherit modes also close the child's stdin, matching the callers this
 * consolidated: none of them feed git over stdin.
 */
export type GitStderrMode = "inherit" | "captured" | "discarded";

function gitRunnerStdio(
  mode: GitStderrMode | undefined,
): ["ignore", "pipe", "pipe" | "ignore"] | undefined {
  if (mode === "captured") return ["ignore", "pipe", "pipe"];
  if (mode === "discarded") return ["ignore", "pipe", "ignore"];
  return undefined;
}

/** The default runner: shells out to the system `git` and returns UTF-8 stdout. */
export function defaultGitRunner(options?: {
  readonly cwd?: string;
  readonly stderr?: GitStderrMode;
}): GitRunner {
  const stdio = gitRunnerStdio(options?.stderr);
  return (args) => execFileSync("git", [...args], { cwd: options?.cwd, encoding: "utf8", stdio });
}

/** Read one repository blob from a ref (or from the index when `ref` is empty). */
export function readGitBlobAtRef<Options>(
  git: (args: readonly string[], options?: Options) => string,
  ref: string,
  path: string,
  options?: Options,
): string {
  return git(["show", `${ref}:${path}`], options);
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

/**
 * Read the working-tree root as git reports it, trimmed. Throws git's own error
 * when there is no repository, so callers that map that failure into their own
 * result type keep the diagnostic. Use {@link resolveRepoRoot} for the
 * fall-back-to-cwd policy instead.
 */
export function readRepoRoot(git: GitRunner): string {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

/** Resolve the working-tree root, falling back to `process.cwd()` when git cannot answer. */
export function resolveRepoRoot(git: GitRunner): string {
  try {
    const out = readRepoRoot(git);
    if (out.length > 0) return out;
  } catch {
    // Fall through to process.cwd().
  }
  return process.cwd();
}

/**
 * Read the `.git` directory as git reports it, trimmed. Git answers relative to
 * the invocation cwd for an ordinary checkout and absolutely for a linked
 * worktree, so callers must resolve the result against the same cwd they ran in.
 */
export function readGitDir(git: GitRunner): string {
  return git(["rev-parse", "--git-dir"]).trim();
}

/**
 * Resolve HEAD's first parent commit, trimmed. Throws when HEAD is unborn or has
 * no first parent; `--verify` keeps git from echoing an unresolved revision back.
 */
export function readFirstParentCommit(git: GitRunner): string {
  return git(["rev-parse", "--verify", "HEAD^1"]).trim();
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
export function listTrackedFiles(git: GitRunner, pathspecs: readonly string[] = []): string[] {
  return parseNulPaths(git(["ls-files", "-z", ...pathspecs]));
}

/**
 * List the paths staged for commit — added, copied, modified, or renamed — via
 * `git diff --cached --name-only --diff-filter=ACMR -z`. `-z` carries the same
 * `core.quotePath` immunity documented on {@link listTrackedFiles}. Returned in
 * git's own order; callers apply their own sort. Throws git's own error when
 * there is no repository, so callers own the "not a repo" policy.
 */
export function listStagedPaths(git: GitRunner): string[] {
  return parseNulPaths(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]));
}

/**
 * Read the byte size of a path's *staged* blob via `git cat-file -s :<path>`.
 * The bare `:<path>` ref is the index entry, so this measures what a commit
 * would record rather than the working-tree file. Throws when the path is not
 * staged.
 */
export function readStagedBlobSize(git: GitRunner, repoRelativePath: string): number {
  return Number(git(["cat-file", "-s", `:${repoRelativePath}`]).trim());
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
