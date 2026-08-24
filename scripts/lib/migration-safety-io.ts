// The read-only effects layer of the migration safety scanner (backlog leaf
// 119): git root discovery, the one-level migration walk, file reads, and the
// in-process envelope emit. Kept apart from `migration-safety-cli.ts` so the
// CLI's control flow stays testable with an injected `MigrationSafetyIo` and
// every filesystem touch this tool makes is visible in one short file.

import { readdirSync, readFileSync, statSync } from "node:fs";

import { emitHarnessEnvelope } from "../harness-emit-envelope.js";
import { compareByCodepoint } from "./codepoint-compare.js";
import { defaultGitRunner, readRepoRoot } from "./git.js";
import type { MigrationSafetyIo } from "./migration-safety-cli.js";

/**
 * The shell original ran `git rev-parse --show-toplevel 2>/dev/null` and left
 * the root empty when git could not answer, which downgrades the scan to
 * cwd-relative paths rather than failing. `resolveRepoRoot`'s cwd fallback
 * would change that, so the empty-string policy is kept here.
 */
function gitRepoRoot(): string {
  try {
    return readRepoRoot(defaultGitRunner({ stderr: "discarded" }));
  } catch {
    return "";
  }
}

function readDirectoryNames(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statKind(path: string): "file" | "dir" | "other" {
  try {
    const stats = statSync(path);
    if (stats.isFile()) return "file";
    return stats.isDirectory() ? "dir" : "other";
  } catch {
    return "other";
  }
}

/** The real filesystem/process effects, assembled once at entry. */
export function nodeMigrationSafetyIo(): MigrationSafetyIo {
  return {
    repoRoot: gitRepoRoot(),
    allowlistOverride: process.env["MUSI_MIGRATION_ALLOWLIST"],
    isDirectory: (path) => statKind(path) === "dir",
    isFile: (path) => statKind(path) === "file",
    listMigrationSql: (dir) => {
      const own = `${dir}/migration.sql`;
      if (statKind(own) === "file") return [own];
      // Mirrors the shell glob `"$dir"/*/migration.sql`: one level deep,
      // dotfiles excluded, each candidate confirmed to be a regular file.
      return readDirectoryNames(dir)
        .filter((name) => !name.startsWith("."))
        .sort((left, right) => compareByCodepoint(left, right))
        .map((name) => `${dir}/${name}/migration.sql`)
        .filter((candidate) => statKind(candidate) === "file");
    },
    readText: (path) => readFileSync(path, "utf8"),
    emitEnvelope: (findings) => {
      emitHarnessEnvelope(
        "migration-safety-scan",
        findings,
        { mode: "stdout-only" },
        "migration-safety-scan",
      );
    },
  };
}
