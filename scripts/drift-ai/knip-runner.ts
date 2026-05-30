// knip subprocess runner and executable resolution for the orphan-files adapter.
// Parsing and check integration live in knip-orphan-files.ts; this module owns the
// I/O and portability concerns, mirroring duplicates-runner.ts / jscpd-bin.ts.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveToolBin,
  type ToolBinConfig,
  type ToolBinResolution,
  type ToolBinSource,
} from "./tool-bin.js";

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
};

export function defaultKnipRunner(options: DefaultKnipRunnerOptions): KnipRunner {
  const analyzedRepoRoot = options.analyzedRepoRoot ?? process.cwd();
  const bin = options.knipBin;
  return ({ configPath }) => {
    // Only the unused-files category; the adapter ignores exports/deps entirely.
    const args = ["--reporter", "json", "--include", "files", "--no-progress"];
    if (configPath !== null) args.push("--config", configPath);
    const result = spawnSync(bin, args, {
      cwd: analyzedRepoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: KNIP_MAX_BUFFER,
    });
    if (result.error) {
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
