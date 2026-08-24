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
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
}

export interface LintRatchetEngineContextInput {
  readonly repoRoot: string;
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
  readonly baselineFilename?: string;
  readonly debtLogFilename?: string;
}

/**
 * Host-owned command spellings used in actionable lint-ratchet output. The
 * portable engine has no defaults for these values: each repository adapter
 * binds commands that actually exist in that repository.
 */
export interface LintRatchetWorkflowVocabulary {
  readonly updateCommand: string;
  readonly regressionUpdateCommand: string;
  readonly debtAcceptanceCommand: string;
  readonly installMergeDriverCommand: string;
  readonly restoreBaselineOursCommand: (baselineFile: string) => string;
  readonly trendAllCommand: string;
}

/**
 * The repository bindings the ESLint config renderer, ratchet runner, and
 * rule-source hasher need together. Directory strings are the deliberate
 * portability seam: adopters may override repository-relative rule and cache
 * locations without injecting arbitrary resolver functions. It travels as one
 * value through collection so kernel operations do not import a repo-bound
 * `paths` module or the Musi registry.
 */
export interface LintRatchetEngineBinding {
  readonly repoRoot: string;
  readonly thirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[];
  readonly localRulesDirectory?: string;
  readonly cacheDirectory?: string;
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
export const DEFAULT_LOCAL_RULES_DIRECTORY = "eslint-rules";
export const DEFAULT_CACHE_DIRECTORY = "node_modules/.cache/eslint-ratchet";

export function localRulesRootFor(binding: LintRatchetEngineBinding): string {
  return join(binding.repoRoot, binding.localRulesDirectory ?? DEFAULT_LOCAL_RULES_DIRECTORY);
}

export function cacheRootFor(binding: LintRatchetEngineBinding): string {
  return join(binding.repoRoot, binding.cacheDirectory ?? DEFAULT_CACHE_DIRECTORY);
}

export function configRootFor(binding: LintRatchetEngineBinding): string {
  return join(cacheRootFor(binding), "configs");
}

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
    workflowVocabulary: input.workflowVocabulary,
  };
}
