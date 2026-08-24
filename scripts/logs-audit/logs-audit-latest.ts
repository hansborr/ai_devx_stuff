// Where `--latest` looks is decided entirely by the environment. The
// per-worktree state-path protocol that produces those directories (repo root
// -> canonical identity path -> sha256 worktree key -> MUSI_VERIFY_STATE_ROOT
// -> `<state-root>/<name>.<key>`) has exactly one runtime implementation:
// scripts/lib/verify-state-paths.sh owns it, and callers reach it through
// scripts/lib/verify-metadata.sh, that protocol's public entry point. It
// crosses into this process as an env contract that scripts/logs-audit.sh
// exports for `bun run logs:audit`. This module deliberately owns no
// derivation: a TypeScript copy of the protocol used to live here behind a
// keep-in-sync comment, had already drifted on its fallback and empty-value
// edges, and drifted silently — a wrong directory and an empty one look
// identical from here. Missing env is therefore reported, never guessed.
import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { env as runtimeProcessEnv } from "node:process";

const JSONL_LOG_EXTENSION = ".jsonl";

export type LogsAuditLatestEnv = {
  readonly AI_BUN_LOG_DIR?: string;
  readonly MUSI_STANDARD_BUN_LOG_DIR?: string;
  readonly MUSI_STANDARD_VERIFY_LOG_DIR?: string;
  readonly MUSI_VERIFY_LOG_DIR?: string;
};

type LatestLogCandidate = {
  readonly file: string;
  readonly mtimeMs: number;
};

function runtimeEnv(): LogsAuditLatestEnv {
  return runtimeProcessEnv;
}

// Canonicalize a root so distinct spellings of the same directory still dedupe;
// an unresolvable root falls back to its absolute form rather than dropping out.
function canonicalLogRootKey(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return path.resolve(root);
  }
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

// `${VAR:-fallback}` semantics: a set-but-empty variable is unset. Every shell
// reader of these same names spells the fallback that way (scripts/verify.sh,
// scripts/land.sh, scripts/verify-logs.sh, scripts/ai-hooks/stop-policy.sh,
// scripts/ai-hooks/session-state.sh), so an override that arrives empty must
// fall through to the standard name here too. `??` would instead let the empty
// string win and then drop the whole log family — the writer would use the
// standard dir while `--latest` never looked at it.
function firstConfiguredDir(
  override: string | undefined,
  standard: string | undefined,
): string | undefined {
  return override !== undefined && override.length > 0 ? override : standard;
}

/**
 * The verify and hook log roots `--latest` will search, read purely from the
 * environment: a per-caller override first, then the standard name the
 * `bun run logs:audit` shim exports. An empty result means the env contract
 * never arrived — the caller reports that rather than searching a guess.
 */
export function defaultLatestLogRoots(env: LogsAuditLatestEnv = runtimeEnv()): readonly string[] {
  const verifyLogDir = firstConfiguredDir(
    env.MUSI_VERIFY_LOG_DIR,
    env.MUSI_STANDARD_VERIFY_LOG_DIR,
  );
  const hookLogDir = firstConfiguredDir(env.AI_BUN_LOG_DIR, env.MUSI_STANDARD_BUN_LOG_DIR);
  return uniqueLatestLogRoots(
    [verifyLogDir, hookLogDir].flatMap((root) =>
      root === undefined || root.length === 0 ? [] : [root],
    ),
  );
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
// in scripts/logs-audit/logs-audit-runner.ts) audits every returned file, so
// returning multiple files on an exact same-millisecond tie across roots would
// audit two unrelated logs; pick the lexicographically smaller path as a stable,
// deterministic tiebreak. The return type stays an array so an empty result
// still means "no compatible logs" for the caller. `roots` is required:
// resolving them is the caller's job precisely so "no roots configured" stays a
// distinguishable condition rather than collapsing into "searched and found
// nothing".
export function findLatestCompatibleLogFiles(roots: readonly string[]): readonly string[] {
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
