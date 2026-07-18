import { isAbsolute, join, relative } from "node:path";

import type { LintRatchetThirdPartyPluginAllowlistEntry } from "./config-types.js";

/**
 * The injected configuration the portable lint-ratchet engine receives. Every
 * kernel/governance operation that needs to reach the repository takes this
 * context (or its `repoRoot`) as an argument instead of importing a repo-bound
 * `paths` module, so the engine has zero Musi bindings. The Musi adapter
 * constructs the one concrete context; the demo constructs its own; tests
 * construct throwaway fixture contexts. See slice plan §1.4.
 */
export interface LintRatchetEngineContext {
  readonly repoRoot: string;
  readonly baselinePath: string;
  readonly debtLogPath: string;
}

export interface LintRatchetEngineContextInput {
  readonly repoRoot: string;
  readonly baselineFilename?: string;
  readonly debtLogFilename?: string;
}

/**
 * The repo-root + registry-allowlist pair the ESLint config renderer, the ratchet
 * runner, and the rule-source hasher all need together. It travels as one value
 * through the collection subsystem so those operations reach the repository (cache
 * dirs, `tsconfigRootDir`, rule sources) and validate third-party plugins without
 * importing a repo-bound `paths` module or the Musi registry. The adapter builds
 * it from its resolved `repoRoot` and its `lintRatchetThirdPartyPluginAllowlist`;
 * the demo and tests build their own.
 */
export interface LintRatchetEngineBinding {
  readonly repoRoot: string;
  readonly thirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[];
}

/**
 * A filesystem-safe token for a ratchet id, used to name per-ratchet cache dirs
 * and generated config files. Pure: the same id always maps to the same token.
 */
export function safeRatchetId(id: string): string {
  return id.replaceAll("/", "-").replaceAll(/[^a-z0-9-]/gu, "-");
}

export const DEFAULT_BASELINE_FILENAME = "lint-ratchet.baseline.json";
export const DEFAULT_DEBT_LOG_FILENAME = "lint-ratchet.debt-log.jsonl";

/**
 * Render `filePath` relative to `repoRoot`, POSIX-normalized. A non-absolute
 * input is returned as-is (only slash-normalized); an absolute input that
 * resolves to the root itself falls back to the original path. Pure: the repo
 * root is a parameter, so both the Musi adapter and the portable engine share
 * one implementation instead of a `paths`-bound copy.
 */
export function relativeToRepoRoot(repoRoot: string, filePath: string): string {
  if (!isAbsolute(filePath)) return filePath.replaceAll("\\", "/");
  const rel = relative(repoRoot, filePath);
  return rel === "" ? filePath : rel.replaceAll("\\", "/");
}

/**
 * Resolve an engine context from a repository root and optional baseline/debt-log
 * filenames. Pure: it derives absolute paths and holds no repo-specific defaults
 * beyond the conventional filenames, which an adopter overrides by passing their
 * own.
 */
export function createLintRatchetEngineContext(
  input: LintRatchetEngineContextInput,
): LintRatchetEngineContext {
  const baselineFilename = input.baselineFilename ?? DEFAULT_BASELINE_FILENAME;
  const debtLogFilename = input.debtLogFilename ?? DEFAULT_DEBT_LOG_FILENAME;
  return {
    repoRoot: input.repoRoot,
    baselinePath: join(input.repoRoot, baselineFilename),
    debtLogPath: join(input.repoRoot, debtLogFilename),
  };
}
