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

import { isRecord } from "../lib/records.js";
import {
  resolveToolBin,
  type ResolveToolBinOptions,
  type ToolBinConfig,
  type ToolBinResolution,
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

// Bounded so a hung knip cannot block an entire drift:ai report — and kept to a
// few minutes (not 10) so silence stays SHORT: a stuck self-scan surfaces a
// timeout notice promptly instead of being indistinguishable from a slow run
// (J1). Large monorepos that legitimately need longer can raise it via timeoutMs.
export const DEFAULT_KNIP_TIMEOUT_MS = 180 * 1000;

// Narrowed subprocess seam: tests only need the fields defaultKnipRunner reads,
// while node's real spawnSync remains directly assignable.
type KnipSpawnResult = Pick<
  SpawnSyncReturns<string>,
  "error" | "status" | "stdout" | "stderr" | "signal"
>;

export type KnipSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => KnipSpawnResult;

type KnipRunnerInput = {
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
  // Heartbeat seam (J1): the knip self-scan runs via a BLOCKING spawnSync, so the
  // parent thread emits no output while it runs and a hang is indistinguishable
  // from a slow run. The runner writes a start banner here immediately before the
  // spawn and an explanation if it times out, so the phase is observably alive and
  // a skip is never silent. Routed to stderr in production (warnStderr); omitting
  // it stays silent (default no-op) so the stdout/JSON report contract is untouched.
  readonly warn?: (message: string) => void;
};

// The three toggleable knip checks map to these pure category atoms; each is
// composed — together with the always-on entry-resolution baseline below — into
// the per-selection include set actually passed to knip.
const FILE_CATEGORY = "files";
const SYMBOL_CATEGORIES = "exports,types,enumMembers,namespaceMembers";
const DUPLICATES_CATEGORY = "duplicates";

// Always-on correctness baseline, appended to EVERY selection independent of which
// of the three checks is active. knip's vitest plugin only registers a config's
// setupFiles/globalSetup (and other config-referenced modules) as entry points when
// the run resolves the dependency graph, which knip does only when `unlisted` or
// `dependencies` are among the requested categories. Omit them and every knip-backed
// check (orphan-files, unused-exports, knip-duplicates) false-positives those live
// test-infrastructure files as orphans/unused exports. The orphan-files and
// unused-exports parsers read only their own category rows, so requesting these
// never pollutes a check's output — it only fixes entry resolution.
const ENTRY_RESOLUTION_CATEGORIES = "unlisted,dependencies";

export const KNIP_FILE_INCLUDE_CATEGORIES =
  `${FILE_CATEGORY},${ENTRY_RESOLUTION_CATEGORIES}` as const;
export const KNIP_SYMBOL_INCLUDE_CATEGORIES =
  `${SYMBOL_CATEGORIES},${ENTRY_RESOLUTION_CATEGORIES}` as const;
export const KNIP_DUPLICATES_INCLUDE_CATEGORIES =
  `${DUPLICATES_CATEGORY},${ENTRY_RESOLUTION_CATEGORIES}` as const;
export const KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES =
  `${FILE_CATEGORY},${SYMBOL_CATEGORIES},${ENTRY_RESOLUTION_CATEGORIES}` as const;
export const KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES =
  `${FILE_CATEGORY},${DUPLICATES_CATEGORY},${ENTRY_RESOLUTION_CATEGORIES}` as const;
export const KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES =
  `${SYMBOL_CATEGORIES},${DUPLICATES_CATEGORY},${ENTRY_RESOLUTION_CATEGORIES}` as const;
// The full superset of knip issue categories drift:ai's whole-project knip
// checks can consume from a SINGLE report. Requesting the selected superset in
// one spawn lets the memo below feed every selected knip-backed check from the
// same JSON.
export const KNIP_INCLUDE_CATEGORIES =
  `${FILE_CATEGORY},${SYMBOL_CATEGORIES},${DUPLICATES_CATEGORY},${ENTRY_RESOLUTION_CATEGORIES}` as const;

export type KnipIncludeCategories =
  | typeof KNIP_FILE_INCLUDE_CATEGORIES
  | typeof KNIP_SYMBOL_INCLUDE_CATEGORIES
  | typeof KNIP_DUPLICATES_INCLUDE_CATEGORIES
  | typeof KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES
  | typeof KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES
  | typeof KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES
  | typeof KNIP_INCLUDE_CATEGORIES;

const INCLUDE_CATEGORIES_BY_SELECTION: Readonly<Record<string, KnipIncludeCategories>> = {
  "001": KNIP_DUPLICATES_INCLUDE_CATEGORIES,
  "010": KNIP_SYMBOL_INCLUDE_CATEGORIES,
  "011": KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES,
  "100": KNIP_FILE_INCLUDE_CATEGORIES,
  "101": KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES,
  "110": KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES,
  "111": KNIP_INCLUDE_CATEGORIES,
};

export function resolveKnipIncludeCategories(
  selectedChecks: readonly DriftCheckId[],
): KnipIncludeCategories {
  const key = [
    selectedChecks.includes("orphan-files"),
    selectedChecks.includes("unused-exports"),
    selectedChecks.includes("knip-duplicates"),
  ]
    .map((selected) => (selected ? "1" : "0"))
    .join("");
  return INCLUDE_CATEGORIES_BY_SELECTION[key] ?? KNIP_INCLUDE_CATEGORIES;
}

// A no-op heartbeat sink: the default when no warn seam is injected, so the
// runner stays silent (untouched stdout/JSON contract) unless wired to stderr.
const SILENT_WARN: (message: string) => void = () => {};

export function defaultKnipRunner(options: DefaultKnipRunnerOptions): KnipRunner {
  const analyzedRepoRoot = options.analyzedRepoRoot ?? process.cwd();
  const bin = options.knipBin;
  const timeoutMs = options.timeoutMs ?? DEFAULT_KNIP_TIMEOUT_MS;
  const includeCategories = options.includeCategories ?? KNIP_INCLUDE_CATEGORIES;
  const spawn = options.spawn ?? spawnSync;
  const warn = options.warn ?? SILENT_WARN;
  const budgetSeconds = Math.round(timeoutMs / 1000);
  return ({ configPath }) => {
    const args = ["--reporter", "json", "--include", includeCategories, "--no-progress"];
    if (configPath !== null) args.push("--config", configPath);
    // Heartbeat (J1): announce the blocking self-scan BEFORE the spawn so the phase
    // is observably alive and the wait is bounded/explained, not silent for minutes.
    warn(`drift:ai: running knip self-scan (budget ${budgetSeconds}s)…`);
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
        // Explain the skip on stderr — a timed-out knip phase must not be silent.
        warn(
          `drift:ai: knip self-scan timed out after ${budgetSeconds}s; skipping knip-backed checks for this run.`,
        );
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
  return isRecord(error) && error["code"] === expectedCode;
}

// --- single-spawn memoization -----------------------------------------------

// Cache the raw KnipRunResult by every input that changes either the report or
// subprocess behavior. When multiple whole-project knip checks are selected, their
// resolvers request the same full `--include` superset against the same project
// graph, so later checks reuse the first's report instead of spawning knip again.
// Module-level on purpose: knip checks resolve their runners
// independently (plugins own their own service resolution), so the memo must
// outlive a single plugin's resolveServices call to be shared across selected
// knip checks.
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
// means selected knip checks hit the same key and share one spawn.
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

export type KnipBinResolution = ToolBinResolution;

export type ResolveKnipBinOptions = ResolveToolBinOptions;

// Resolve the knip executable. Precedence mirrors resolveJscpdBin: an explicit
// override is authoritative when supplied; otherwise the tools checkout (this
// script's own node_modules) is PRIMARY so an uninstalled or non-Bun target need
// not own knip, then the target repo. The tools-checkout bin is found by walking
// up from this module's directory to the nearest node_modules/.bin/knip.
export function resolveKnipBin(options: ResolveKnipBinOptions = {}): KnipBinResolution {
  return resolveToolBin(KNIP_TOOL_BIN, options);
}
