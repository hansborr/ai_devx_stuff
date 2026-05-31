// knip subprocess runner and executable resolution for the orphan-files adapter.
// Parsing and check integration live in knip-orphan-files.ts; this module owns the
// I/O and portability concerns, mirroring duplicates-runner.ts / jscpd-bin.ts.

import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveToolBin,
  type ToolBinConfig,
  type ToolBinResolution,
  type ToolBinSource,
} from "./tool-bin.js";
import type { DriftCheckId } from "./types.js";

// Relative location of the knip executable shim inside any node_modules tree.
const KNIP_BIN_RELATIVE = path.join("node_modules", ".bin", "knip");

// This module's own directory, used to locate the tools-checkout node_modules.
const KNIP_RUNNER_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const KNIP_TOOL_BIN: ToolBinConfig = {
  toolName: "knip",
  binRelativePath: KNIP_BIN_RELATIVE,
  moduleDir: KNIP_RUNNER_MODULE_DIR,
};

// knip's stdout JSON report can be large on a big monorepo; give spawnSync room
// so a real report is never truncated into an unreadable-JSON diagnostic.
const KNIP_MAX_BUFFER = 64 * 1024 * 1024;

// Long enough for large monorepos, but still bounded so a hung knip cannot block
// an entire drift:ai report indefinitely.
export const DEFAULT_KNIP_TIMEOUT_MS = 10 * 60 * 1000;

// Narrowed subprocess seam: tests only need the fields defaultKnipRunner reads,
// while node's real spawnSync remains directly assignable.
export type KnipSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "error" | "status" | "stdout" | "stderr" | "signal"
>;

export type KnipSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => KnipSpawnResult;

export type KnipRunnerInput = {
  // Path to pass via knip's `--config`, or null to let knip auto-discover (used
  // for a root config knip already finds, e.g. package.json#knip).
  readonly configPath: string | null;
};

export type KnipRunResult =
  | {
      readonly ok: true;
      readonly reportJson: string;
      readonly exitCode: number | null;
      readonly stderr: string;
    }
  // The engine itself is missing from the tools checkout (expected-absence skip).
  | { readonly ok: false; readonly reason: "tool-unavailable"; readonly error: string }
  // knip resolved and spawned, but exceeded the configured wall-clock budget.
  | { readonly ok: false; readonly reason: "timeout"; readonly error: string }
  // knip resolved but the subprocess could not be spawned (attempted-and-failed).
  | { readonly ok: false; readonly reason: "spawn-failed"; readonly error: string };

export type KnipRunner = (input: KnipRunnerInput) => KnipRunResult;

export type DefaultKnipRunnerOptions = {
  // Subprocess cwd: the analyzed/target repo root, so knip emits repo-relative
  // paths and resolves the target's module graph. Kept distinct from the
  // executable location (knipBin) so an installed target can be scanned with knip
  // resolved from the tools checkout. Defaults to process.cwd().
  readonly analyzedRepoRoot?: string;
  // Resolved knip executable (see resolveKnipBin).
  readonly knipBin: string;
  // Wall-clock subprocess budget in milliseconds. Defaults to
  // DEFAULT_KNIP_TIMEOUT_MS.
  readonly timeoutMs?: number;
  // Comma-separated knip issue categories to request.
  readonly includeCategories?: KnipIncludeCategories;
  // Injectable subprocess seam for focused runner tests.
  readonly spawn?: KnipSpawn;
};

export const KNIP_FILE_INCLUDE_CATEGORIES = "files" as const;
export const KNIP_SYMBOL_INCLUDE_CATEGORIES = "exports,types,enumMembers,namespaceMembers" as const;
// The full superset of knip issue categories drift:ai's two whole-project checks
// can consume from a SINGLE report: orphan-files reads `files`; unused-exports
// reads the symbol-level categories. Requesting all of them in one spawn lets the
// memo below feed both checks from the same JSON when both checks are selected.
export const KNIP_INCLUDE_CATEGORIES =
  `${KNIP_FILE_INCLUDE_CATEGORIES},${KNIP_SYMBOL_INCLUDE_CATEGORIES}` as const;

export type KnipIncludeCategories =
  | typeof KNIP_FILE_INCLUDE_CATEGORIES
  | typeof KNIP_SYMBOL_INCLUDE_CATEGORIES
  | typeof KNIP_INCLUDE_CATEGORIES;

export function resolveKnipIncludeCategories(
  selectedChecks: readonly DriftCheckId[],
): KnipIncludeCategories {
  const hasOrphanFiles = selectedChecks.includes("orphan-files");
  const hasUnusedExports = selectedChecks.includes("unused-exports");
  if (hasOrphanFiles && !hasUnusedExports) return KNIP_FILE_INCLUDE_CATEGORIES;
  if (hasUnusedExports && !hasOrphanFiles) return KNIP_SYMBOL_INCLUDE_CATEGORIES;
  return KNIP_INCLUDE_CATEGORIES;
}

export function defaultKnipRunner(options: DefaultKnipRunnerOptions): KnipRunner {
  const analyzedRepoRoot = options.analyzedRepoRoot ?? process.cwd();
  const bin = options.knipBin;
  const timeoutMs = options.timeoutMs ?? DEFAULT_KNIP_TIMEOUT_MS;
  const includeCategories = options.includeCategories ?? KNIP_INCLUDE_CATEGORIES;
  const spawn = options.spawn ?? spawnSync;
  return ({ configPath }) => {
    const args = ["--reporter", "json", "--include", includeCategories, "--no-progress"];
    if (configPath !== null) args.push("--config", configPath);
    const result = spawn(bin, args, {
      cwd: analyzedRepoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: KNIP_MAX_BUFFER,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    if (result.error) {
      if (isTimeoutResult(result)) {
        return {
          ok: false,
          reason: "timeout",
          error: `timeout of ${timeoutMs}ms`,
        };
      }
      return { ok: false, reason: "spawn-failed", error: result.error.message };
    }
    // NOTE: a non-zero exit is NOT a failure — knip exits with the issue count, so
    // exit 1 with a valid `{"issues":[...]}` report is the common success case.
    // The caller parses stdout regardless of exit code; exitCode/stderr are
    // carried only to enrich the unreadable-JSON diagnostic when parsing fails.
    return {
      ok: true,
      reportJson: result.stdout,
      exitCode: result.status,
      stderr: result.stderr,
    };
  };
}

function isTimeoutResult(result: KnipSpawnResult): boolean {
  if (hasErrorCode(result.error, "ETIMEDOUT")) return true;
  if (result.signal !== "SIGTERM" || result.error === undefined) return false;
  return /\b(?:ETIMEDOUT|timed out|timeout)\b/iu.test(result.error.message);
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return isObject(error) && error["code"] === expectedCode;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- single-spawn memoization -----------------------------------------------

// Cache the raw KnipRunResult by every input that changes either the report or
// subprocess behavior. When both whole-project knip checks are selected, their
// resolvers request the same full `--include` superset against the same project
// graph, so the second check reuses the first's report instead of spawning knip a
// second time. Module-level on purpose: the two checks resolve their runners
// independently (plugins own their own service resolution), so the memo must
// outlive a single plugin's resolveServices call to be shared across both.
//
// Injected runners (tests, runDriftAi callers via env.overrides.knip) NEVER pass
// through this factory, so they always bypass the cache — each test's fake runner
// is its own source of truth.
const knipRunCache = new Map<string, KnipRunResult>();

function cacheKey(
  analyzedRepoRoot: string,
  knipBin: string,
  configPath: string | null,
  includeCategories: KnipIncludeCategories,
  timeoutMs: number,
): string {
  return `${analyzedRepoRoot}\u0000${knipBin}\u0000${configPath ?? ""}\u0000${includeCategories}\u0000${timeoutMs}`;
}

export type MemoizingKnipRunnerOptions = DefaultKnipRunnerOptions & {
  // The runner the memo wraps. Defaults to the spawning defaultKnipRunner; a test
  // injects a counting fake here to assert the cache dedupes spawns across the two
  // checks WITHOUT actually spawning knip. This is an internal seam, not a service
  // override — the checks always take the spawning default.
  readonly underlyingRunner?: KnipRunner;
};

// The production default runner: a memoizing wrapper over defaultKnipRunner. The
// memo key tracks configPath, include categories, and timeout because each can
// change the report or subprocess behavior; a single config resolution per run
// means the two checks hit the same key and share one spawn when both are selected.
export function memoizingDefaultKnipRunner(options: MemoizingKnipRunnerOptions): KnipRunner {
  const analyzedRepoRoot = options.analyzedRepoRoot ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_KNIP_TIMEOUT_MS;
  const includeCategories = options.includeCategories ?? KNIP_INCLUDE_CATEGORIES;
  const underlying =
    options.underlyingRunner ?? defaultKnipRunner({ ...options, analyzedRepoRoot, timeoutMs });
  return (input) => {
    const key = cacheKey(
      analyzedRepoRoot,
      options.knipBin,
      input.configPath,
      includeCategories,
      timeoutMs,
    );
    const cached = knipRunCache.get(key);
    if (cached !== undefined) return cached;
    const result = underlying(input);
    knipRunCache.set(key, result);
    return result;
  };
}

// Test seam: clear the cross-check memo so a test that exercises the real
// memoizing runner does not leak a cached report into the next test.
export function clearKnipRunCache(): void {
  knipRunCache.clear();
}

// A placeholder runner for when knip is not resolvable in the tools checkout. The
// adapter maps `tool-unavailable` to a `tool-not-installed` skip (never a finding).
export function unresolvedKnipRunner(error: string): KnipRunner {
  return () => ({ ok: false, reason: "tool-unavailable", error });
}

export type KnipBinSource = ToolBinSource;

export type KnipBinResolution = ToolBinResolution;

export type ResolveKnipBinOptions = {
  readonly analyzedRepoRoot?: string;
  readonly override?: string;
  readonly moduleDir?: string;
  readonly fileExists?: (candidate: string) => boolean;
};

// Resolve the knip executable. Precedence mirrors resolveJscpdBin (first existing
// wins): the tools checkout (this script's own node_modules) is PRIMARY so an
// uninstalled or non-Bun target need not own knip; then the target repo; then an
// explicit override. The tools-checkout bin is found by walking up from this
// module's directory to the nearest node_modules/.bin/knip.
export function resolveKnipBin(options: ResolveKnipBinOptions = {}): KnipBinResolution {
  return resolveToolBin(KNIP_TOOL_BIN, options);
}
