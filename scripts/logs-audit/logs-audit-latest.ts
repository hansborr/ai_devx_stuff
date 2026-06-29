import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { cwd, env as runtimeProcessEnv } from "node:process";

const JSONL_LOG_EXTENSION = ".jsonl";
const STANDARD_VERIFY_LOG_DIR_NAME = "musi-pre-commit-logs";
const STANDARD_BUN_LOG_DIR_NAME = "musi-bun-logs";

export type LogsAuditLatestEnv = {
  readonly AI_BUN_LOG_DIR?: string;
  readonly MUSI_STANDARD_BUN_LOG_DIR?: string;
  readonly MUSI_STANDARD_VERIFY_LOG_DIR?: string;
  readonly MUSI_VERIFY_LOG_DIR?: string;
  readonly MUSI_VERIFY_STATE_ROOT?: string;
  readonly REPO_ROOT?: string;
};

type LatestLogCandidate = {
  readonly file: string;
  readonly mtimeMs: number;
};

function runtimeEnv(): LogsAuditLatestEnv {
  return runtimeProcessEnv;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function repoRootForState(env: LogsAuditLatestEnv): string {
  if (env.REPO_ROOT !== undefined && env.REPO_ROOT.length > 0) return env.REPO_ROOT;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd() || "/workspace";
  }
}

// Canonicalize a filesystem path via realpathSync, deferring to a caller-chosen
// fallback when the path cannot be resolved. The worktree-identity caller keeps
// the raw path; the log-root caller resolves to an absolute path so distinct
// spellings of the same root still dedupe.
function realpathOrFallback(value: string, fallback: (value: string) => string): string {
  try {
    return realpathSync(value);
  } catch {
    return fallback(value);
  }
}

function worktreeStateKey(env: LogsAuditLatestEnv): string {
  const repoRoot = repoRootForState(env);
  const identity = existsSync(repoRoot) ? realpathOrFallback(repoRoot, (value) => value) : repoRoot;
  return sha256Hex(identity);
}

function standardStateRoot(env: LogsAuditLatestEnv): string {
  const rawStateRoot = env.MUSI_VERIFY_STATE_ROOT ?? "/tmp";
  return rawStateRoot.replace(/\/+$/u, "") || "/";
}

// Standalone fallback for direct `bun run logs:audit --latest` calls. Shell
// wrappers export MUSI_STANDARD_*_LOG_DIR; keep this in sync with
// scripts/lib/verify-metadata.sh's musi_standard_state_path contract.
function standardStatePath(name: string, stateRoot: string, worktreeKey: string): string {
  const basename = `${name}.${worktreeKey}`;
  return stateRoot === "/" ? `/${basename}` : path.join(stateRoot, basename);
}

function canonicalLogRootKey(root: string): string {
  return realpathOrFallback(root, (value) => path.resolve(value));
}

function uniqueLatestLogRoots(roots: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const key = canonicalLogRootKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(root);
  }
  return unique;
}

function defaultLatestLogRoots(env: LogsAuditLatestEnv): readonly string[] {
  let cachedStateRoot: string | undefined;
  let cachedWorktreeKey: string | undefined;
  const fallbackStandardPath = (name: string): string => {
    cachedStateRoot ??= standardStateRoot(env);
    cachedWorktreeKey ??= worktreeStateKey(env);
    return standardStatePath(name, cachedStateRoot, cachedWorktreeKey);
  };
  const verifyLogDir =
    env.MUSI_VERIFY_LOG_DIR ??
    env.MUSI_STANDARD_VERIFY_LOG_DIR ??
    fallbackStandardPath(STANDARD_VERIFY_LOG_DIR_NAME);
  const hookLogDir =
    env.AI_BUN_LOG_DIR ??
    env.MUSI_STANDARD_BUN_LOG_DIR ??
    fallbackStandardPath(STANDARD_BUN_LOG_DIR_NAME);
  return uniqueLatestLogRoots([verifyLogDir, hookLogDir]);
}

function collectLatestLogCandidates(root: string): readonly LatestLogCandidate[] {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(JSONL_LOG_EXTENSION)) return [];
      const file = path.join(root, entry.name);
      try {
        return [{ file, mtimeMs: statSync(file).mtimeMs }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

// Select the single newest run's log in one pass. The caller (`resolveRunFiles`
// in scripts/logs-audit.ts) audits every returned file, so returning multiple
// files on an exact same-millisecond tie across roots would audit two unrelated
// logs; pick the lexicographically smaller path as a stable, deterministic
// tiebreak. The return type stays an array so an empty result still means "no
// compatible logs" for the caller.
export function findLatestCompatibleLogFiles(
  roots: readonly string[] = defaultLatestLogRoots(runtimeEnv()),
): readonly string[] {
  const candidates = uniqueLatestLogRoots(roots).flatMap((root) =>
    collectLatestLogCandidates(root),
  );

  let newest: LatestLogCandidate | undefined;
  for (const candidate of candidates) {
    if (
      newest === undefined ||
      candidate.mtimeMs > newest.mtimeMs ||
      (candidate.mtimeMs === newest.mtimeMs && candidate.file.localeCompare(newest.file) < 0)
    ) {
      newest = candidate;
    }
  }

  return newest === undefined ? [] : [newest.file];
}
