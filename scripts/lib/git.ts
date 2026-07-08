import { execFileSync } from "node:child_process";

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
 * List repository-tracked files (`git ls-files`), newline-split with blank lines
 * and trailing CR dropped. Returned in git's own order — callers apply their own
 * sort, since consumers order differently (default lexical vs. locale-aware).
 */
export function listTrackedFiles(git: GitRunner): string[] {
  const files: string[] = [];
  for (const raw of git(["ls-files"]).split("\n")) {
    const file = raw.replace(/\r$/u, "");
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
