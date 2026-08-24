// Semgrep subprocess harness for the `semgrep-candidates` prototype subcommand
// (semgrep plan, slice 2). This module keeps Semgrep optional and report-only:
// a missing binary is a clean absence (the caller renders an unmet
// prerequisite), rule configs arrive pre-gated from the license/registry gate,
// and the target repo is never written to — no `.semgrepignore`, no config, no
// caches; the drift ignore config travels as repeated `--exclude` flags.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "../lib/records.js";
import { globsForIgnoredPaths, matchesAnyGlob } from "./config-match.js";
import { parseSemgrepScanOutput, parseSemgrepVersionOutput } from "./semgrep-output.js";
import type {
  DefaultSemgrepRunnerOptions,
  SemgrepCommandSource,
  SemgrepRunner,
  SemgrepRunnerCaps,
  SemgrepRunnerInput,
  SemgrepRunnerResult,
  SemgrepSpawn,
  SemgrepSpawnResult,
  SemgrepToolInfo,
} from "./semgrep-runner-types.js";
import { SEMGREP_TOOL } from "./semgrep-types.js";
import { toolsCheckoutBinPaths } from "./tool-bin.js";

export const DEFAULT_SEMGREP_TIMEOUT_MS = 10 * 60 * 1000;

// Tools-checkout-managed engine location (resolution-order entry 2 in plan
// decision 2; slice 0 installs it here). Probed on this module's directory and
// each ancestor, so the engine resolves from the drift:ai checkout — never
// from the analyzed target repo.
export const SEMGREP_TOOLS_CHECKOUT_BIN = path.join(".tools", "semgrep", ".venv", "bin", "semgrep");

const SEMGREP_RUNNER_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Semgrep's JSON report carries paths/timing sections on top of findings; give
// spawnSync room so a large real report is never truncated into an
// invalid-JSON degradation.
const SEMGREP_MAX_BUFFER = 64 * 1024 * 1024;

// Timeout kills arrive with this signal (spawnSync killSignal below); the
// message fallback in isTimeoutResult checks the same signal so the two cannot
// drift apart and leave the fallback dead.
const TIMEOUT_KILL_SIGNAL = "SIGKILL";

export type {
  DefaultSemgrepRunnerOptions,
  SemgrepRunner,
  SemgrepRunnerCaps,
  SemgrepRunnerInput,
  SemgrepRunnerResult,
  SemgrepSpawn,
  SemgrepSpawnResult,
  SemgrepToolInfo,
} from "./semgrep-runner-types.js";

export function defaultSemgrepRunner(options: DefaultSemgrepRunnerOptions = {}): SemgrepRunner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEMGREP_TIMEOUT_MS;
  const spawn = options.spawn ?? spawnSync;
  const resolved = resolveSemgrepCommand(options);
  return (input) => runSemgrep(input, { ...resolved, spawn, timeoutMs });
}

// Resolution order per plan decision 2: explicit `--semgrep-bin` override,
// then the tools-checkout engine, then `semgrep` on PATH (left to spawn — a
// missing PATH binary surfaces as a tool-unavailable ENOENT).
function resolveSemgrepCommand(options: DefaultSemgrepRunnerOptions): {
  readonly command: string;
  readonly source: SemgrepCommandSource;
} {
  if (options.bin !== undefined) return { command: options.bin, source: "override" };
  const fileExists = options.fileExists ?? existsSync;
  const moduleDir = options.moduleDir ?? SEMGREP_RUNNER_MODULE_DIR;
  for (const candidate of toolsCheckoutBinPaths(moduleDir, SEMGREP_TOOLS_CHECKOUT_BIN)) {
    if (fileExists(candidate)) return { command: candidate, source: "tools-checkout" };
  }
  return { command: SEMGREP_TOOL, source: "path" };
}

function runSemgrep(
  input: SemgrepRunnerInput,
  options: {
    readonly command: string;
    readonly source: SemgrepCommandSource;
    readonly timeoutMs: number;
    readonly spawn: SemgrepSpawn;
  },
): SemgrepRunnerResult {
  const caps: SemgrepRunnerCaps = { timeoutMs: options.timeoutMs };
  const tool: SemgrepToolInfo = { command: options.command, source: options.source };
  if (input.ruleConfigs.length === 0) {
    // Without an explicit --config, semgrep falls through to its own config
    // resolution (registry/auto). Rule sources are gated upstream; refuse
    // rather than scan with rules nobody declared.
    return {
      ok: false,
      reason: "run-failed",
      error:
        "semgrep scan needs at least one explicit --config rule source; " +
        "refusing to fall through to semgrep's default config resolution",
      tool,
      caps,
    };
  }
  const detected = detectSemgrepTool(options, input.repoRoot);
  if (!detected.ok) return { ...detected, caps };
  const result = options.spawn(
    options.command,
    semgrepScanArgs(input),
    spawnOptions(input.repoRoot, options.timeoutMs),
  );
  const failed = failedRun(result, options.timeoutMs, detected.tool);
  if (failed !== null) return { ...failed, caps };
  const parsed = parseSemgrepScanOutput(result.stdout);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "run-failed",
      error: parsed.error,
      tool: detected.tool,
      caps,
      phase: "scan",
    };
  }
  return { ok: true, tool: detected.tool, scan: parsed.scan, caps };
}

function detectSemgrepTool(
  options: {
    readonly command: string;
    readonly source: SemgrepCommandSource;
    readonly timeoutMs: number;
    readonly spawn: SemgrepSpawn;
  },
  repoRoot: string,
):
  | { readonly ok: true; readonly tool: SemgrepToolInfo }
  | {
      readonly ok: false;
      readonly reason: "timeout" | "tool-unavailable";
      readonly error: string;
      readonly tool: SemgrepToolInfo;
      readonly phase: "probe";
    } {
  const tool: SemgrepToolInfo = { command: options.command, source: options.source };
  const result = options.spawn(
    options.command,
    ["--version"],
    spawnOptions(repoRoot, options.timeoutMs),
  );
  if (result.error) {
    if (isTimeoutResult(result)) {
      return {
        ok: false,
        reason: "timeout",
        error: `timeout of ${options.timeoutMs}ms`,
        tool,
        phase: "probe",
      };
    }
    return {
      ok: false,
      reason: "tool-unavailable",
      error: result.error.message,
      tool,
      phase: "probe",
    };
  }
  const version = parseSemgrepVersionOutput(`${result.stdout}\n${result.stderr}`);
  return {
    ok: true,
    tool: { ...tool, ...(version === undefined ? {} : { version }) },
  };
}

function failedRun(
  result: SemgrepSpawnResult,
  timeoutMs: number,
  tool: SemgrepToolInfo,
): {
  readonly ok: false;
  readonly reason: "run-failed" | "timeout" | "tool-unavailable";
  readonly error: string;
  readonly tool: SemgrepToolInfo;
  readonly phase: "scan";
} | null {
  if (result.error) {
    if (isTimeoutResult(result)) {
      return {
        ok: false,
        reason: "timeout",
        error: `timeout of ${timeoutMs}ms`,
        tool,
        phase: "scan",
      };
    }
    if (isUnavailableResult(result)) {
      return {
        ok: false,
        reason: "tool-unavailable",
        error: result.error.message,
        tool,
        phase: "scan",
      };
    }
    return { ok: false, reason: "run-failed", error: result.error.message, tool, phase: "scan" };
  }
  // Without `--error`, a completed scan exits 0 even with findings; any
  // non-zero exit is a degraded prototype run (plan decision 2).
  if (result.status === 0) return null;
  const status = result.status === null ? "unknown" : String(result.status);
  const stderr = result.stderr.trim();
  return {
    ok: false,
    reason: "run-failed",
    error: stderr.length > 0 ? `semgrep exited ${status}: ${stderr}` : `semgrep exited ${status}`,
    tool,
    phase: "scan",
  };
}

function semgrepScanArgs(input: SemgrepRunnerInput): string[] {
  return [
    "scan",
    "--json",
    "--metrics=off",
    "--disable-version-check",
    "--oss-only",
    ...input.ruleConfigs.flatMap((config) => ["--config", config]),
    // Excludes are CLI-only (plan decision 2): never a .semgrepignore or any
    // other write into the target repo. Semgrep interprets these patterns; the
    // generated segment/prefix shapes are kept to glob forms both sides align on.
    ...semgrepScanExcludeGlobs(input).flatMap((glob) => ["--exclude", glob]),
    ...scanRoots(input.roots),
  ];
}

// Current scope deliberately preserves an explicitly requested ignored root
// (current-inventory.ts: explicit roots ignore their own matched prefix).
// Semgrep does its own discovery, so mirror that here by dropping any exclude
// glob that would swallow a requested root wholesale — otherwise
// `--root src/generated` under an ignored `generated` segment scans nothing
// and reads as "no matches". The drop is per glob, not per root, so nested
// re-matches under that root stop being excluded too: over-inclusion of an
// explicitly requested root, never silent exclusion of it.
// Exported for the command's .semgrepignore probe so probe scope and scan
// excludes stay aligned by construction.
export function semgrepScanExcludeGlobs(
  input: Pick<SemgrepRunnerInput, "roots" | "ignore">,
): string[] {
  const explicitRoots = input.roots.filter((root) => root.trim().length > 0 && root !== ".");
  return globsForIgnoredPaths(input.ignore).filter(
    (glob) => !explicitRoots.some((root) => globCoversRoot(glob, root)),
  );
}

// No configured glob names a NUL segment literally, so only a wildcard tail —
// the "everything under here" glob shapes — can match a NUL-named child.
const GLOB_COVERAGE_PROBE = "\u0000";

// A glob covers a root wholesale when it matches the root itself (also how a
// file root is excluded) or any child regardless of name (the NUL probe).
function globCoversRoot(glob: string, root: string): boolean {
  return matchesAnyGlob(root, [glob]) || matchesAnyGlob(`${root}/${GLOB_COVERAGE_PROBE}`, [glob]);
}

// Whether the scan's --exclude globs swallow a repo-relative path wholesale —
// the path itself or every child regardless of name. Exported for the
// command's .semgrepignore probe: a directory the scan excludes cannot have
// shaped the scan, so the probe must not attribute its contents to the target.
export function excludeGlobsCoverPath(globs: readonly string[], relPath: string): boolean {
  return globs.some((glob) => globCoversRoot(glob, relPath));
}

// Semgrep does its own file discovery (plan decision 7): roots pass through
// unfiltered — no sourceExtensions gating — and empty/whole-repo roots
// normalize to ".".
function scanRoots(roots: readonly string[]): string[] {
  if (roots.length === 0) return ["."];
  return roots.map((root) => (root.trim().length === 0 ? "." : root));
}

function spawnOptions(cwd: string, timeoutMs: number): SpawnSyncOptionsWithStringEncoding {
  return {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: SEMGREP_MAX_BUFFER,
    timeout: timeoutMs,
    killSignal: TIMEOUT_KILL_SIGNAL,
  };
}

function isTimeoutResult(result: SemgrepSpawnResult): boolean {
  if (hasErrorCode(result.error, "ETIMEDOUT")) return true;
  if (result.signal !== TIMEOUT_KILL_SIGNAL || result.error === undefined) return false;
  return /\b(?:ETIMEDOUT|timed out|timeout)\b/iu.test(result.error.message);
}

function isUnavailableResult(result: SemgrepSpawnResult): boolean {
  return hasErrorCode(result.error, "ENOENT") || result.error?.message.includes("ENOENT") === true;
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return isRecord(error) && error["code"] === expectedCode;
}
