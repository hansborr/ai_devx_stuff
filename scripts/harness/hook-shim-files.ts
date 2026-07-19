// Filesystem side of hook-shim generation: write the shims `hook-shims.ts`
// renders (with the executable bit — neither the atomic writer nor the
// lint-ratchet kernel sets modes), reconcile the three owned adapter
// directories so removed manifest entries never leave orphans behind, and
// provide the `--check` assertions (byte compare, regular-file type,
// executable bit, symlink rejection, orphan and stray-non-file detection)
// that `generate-hook-wiring.ts` folds into `harness:wiring:check`. Both
// modes fail closed when an owned directory path is itself a symlink (or a
// non-directory): following it would read, overwrite, chmod, or delete files
// outside the owned tree.

import { chmodSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { compareByCodepoint } from "@musi/lint-ratchet/kernel/codepoint-compare.js";

import { ensureDirWriteFileAtomicallySync } from "../lib/atomic-write.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import { HOOK_SHIM_DIRS, type RenderedShim } from "./hook-shims.js";

const SHIM_FILE_MODE = 0o755;
const EXEC_BITS = 0o111;

// Fail-closed guard for the three owned adapter directories: every path
// component (`.claude` and `.claude/hooks`, etc.) must be a real directory
// or missing entirely. A symlink anywhere on the path would make readdir,
// write, prune, and check operate on files outside the owned tree, so both
// generation and `--check` refuse instead. A missing directory stays fine:
// write mode creates it (pinned by the bare-root generator test).
function ownedShimDirProblems(shimRootPath: string): string[] {
  const problems: string[] = [];
  for (const dir of Object.values(HOOK_SHIM_DIRS)) {
    const segments = dir.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const prefix = segments.slice(0, index).join("/");
      let stats;
      try {
        stats = lstatSync(join(shimRootPath, prefix));
      } catch {
        break; // Missing directory: nothing to guard, write mode creates it.
      }
      if (stats.isSymbolicLink()) {
        problems.push(
          `${prefix} (owned shim path must be a real directory, found a symlink; refusing to touch files outside the owned tree)`,
        );
        break;
      }
      if (!stats.isDirectory()) {
        problems.push(`${prefix} (owned shim path must be a directory)`);
        break;
      }
    }
  }
  return problems;
}

// Adapter *.sh entries in an owned shim directory, symlinks included so a
// symlinked orphan cannot hide from reconciliation (check-wiring counts
// symlinks in its orphan scan too). Non-*.sh files are out of scope.
function listShimDirEntries(dirPath: string): string[] {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    // A missing adapter directory simply has no entries to reconcile.
    return [];
  }
  return entries
    .filter((entry) => entry.name.endsWith(".sh") && (entry.isFile() || entry.isSymbolicLink()))
    .map((entry) => entry.name)
    .sort(compareByCodepoint);
}

function orphanShimPaths(shims: readonly RenderedShim[], shimRootPath: string): string[] {
  const expected = new Set(shims.map((shim) => shim.relPath));
  const orphans: string[] = [];
  for (const dir of Object.values(HOOK_SHIM_DIRS)) {
    for (const name of listShimDirEntries(join(shimRootPath, dir))) {
      const relPath = `${dir}/${name}`;
      if (!expected.has(relPath)) orphans.push(relPath);
    }
  }
  return orphans;
}

/**
 * Write every derived shim (atomic replace + explicit executable-bit step),
 * then reconcile the three owned adapter directories: a committed `*.sh` file
 * no manifest hookWiring entry derives is removed and reported, so deleting
 * or renaming a manifest entry never leaves an unrepairable orphan behind.
 * Refuses (before any write or prune) when an owned adapter directory path is
 * a symlink or non-directory — see {@link ownedShimDirProblems}.
 */
export function writeHookShims(shims: readonly RenderedShim[], shimRootPath: string): void {
  const dirProblems = ownedShimDirProblems(shimRootPath);
  if (dirProblems.length > 0) {
    throw new Error(
      `Refusing to write hook shims: ${dirProblems.join(", ")}. ` +
        "Restore the adapter path as a real directory (or remove it) and rerun `bun run harness:wiring`.",
    );
  }
  for (const shim of shims) {
    const path = join(shimRootPath, shim.relPath);
    ensureDirWriteFileAtomicallySync(path, shim.content);
    chmodSync(path, SHIM_FILE_MODE);
  }
  for (const relPath of orphanShimPaths(shims, shimRootPath)) {
    rmSync(join(shimRootPath, relPath));
    console.log(
      `Removed orphan shim ${relPath}: no ${HARNESS_MANIFEST_FILENAME} hookWiring entry derives it.`,
    );
  }
}

function shimProblem(shim: RenderedShim, shimRootPath: string): string | undefined {
  const path = join(shimRootPath, shim.relPath);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return `${shim.relPath} (missing)`;
  }
  if (stats.isSymbolicLink()) return `${shim.relPath} (must be a regular file, found a symlink)`;
  if (!stats.isFile()) return `${shim.relPath} (must be a regular file)`;
  if ((stats.mode & EXEC_BITS) !== EXEC_BITS) {
    return `${shim.relPath} (missing executable bit)`;
  }
  if (readFileSync(path, "utf8") !== shim.content) return `${shim.relPath} (content drift)`;
  return undefined;
}

// A directory (or other non-file, non-symlink entry) named `*.sh` inside an
// owned dir is invisible to the orphan scan and to per-shim checks, so
// `--check` reports it explicitly instead of silently passing over it.
function strayNonFileShimEntries(shimRootPath: string): string[] {
  const strays: string[] = [];
  for (const dir of Object.values(HOOK_SHIM_DIRS)) {
    let entries;
    try {
      entries = readdirSync(join(shimRootPath, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".sh") && !entry.isFile() && !entry.isSymbolicLink()) {
        strays.push(
          `${dir}/${entry.name} (a *.sh entry must be a regular file, found a non-file entry; remove it by hand)`,
        );
      }
    }
  }
  return strays.sort(compareByCodepoint);
}

/**
 * `--check` companion to {@link writeHookShims}: byte-compare every derived
 * shim, assert regular-file type and the executable bit, reject symlinks, and
 * flag orphan `*.sh` files and stray non-file `*.sh` entries in the three
 * owned adapter directories. Returns one annotated repo-relative path per
 * problem. Fails closed when an owned adapter directory path is a symlink or
 * non-directory: it returns only those directory problems and validates
 * nothing through the link, so `--check` can never pass against content
 * outside the owned tree.
 */
export function checkHookShimsOnDisk(
  shims: readonly RenderedShim[],
  shimRootPath: string,
): string[] {
  const dirProblems = ownedShimDirProblems(shimRootPath);
  if (dirProblems.length > 0) return dirProblems;
  const problems: string[] = [];
  for (const shim of shims) {
    const problem = shimProblem(shim, shimRootPath);
    if (problem !== undefined) problems.push(problem);
  }
  for (const relPath of orphanShimPaths(shims, shimRootPath)) {
    problems.push(`${relPath} (orphan: no hookWiring entry derives it)`);
  }
  problems.push(...strayNonFileShimEntries(shimRootPath));
  return problems;
}
