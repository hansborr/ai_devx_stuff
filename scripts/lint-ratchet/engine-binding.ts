import type { LintRatchetGitRailAdapter } from "@musi/lint-ratchet/git-rail/executable-config.js";
import type {
  LintRatchetEngineBinding,
  LintRatchetEngineContext,
} from "@musi/lint-ratchet/kernel/engine-context.js";

import { lintRatchets, lintRatchetThirdPartyPluginAllowlist } from "./lint-ratchet-config.js";
import {
  BASELINE_FILENAME,
  baselinePath,
  DEBT_LOG_FILENAME,
  debtLogPath,
  repoRoot,
} from "./paths.js";
import { musiLintRatchetWorkflowVocabulary } from "./workflow-vocabulary.js";

export { musiLintRatchetWorkflowVocabulary } from "./workflow-vocabulary.js";

/**
 * The Musi adapter's concrete {@link LintRatchetEngineBinding}: the repo root the
 * gate runs against plus the Musi registry's third-party plugin allowlist. The
 * portable engine takes this as a parameter instead of importing `paths` or the
 * registry, so this is the one place the two Musi bindings are wired together.
 */
export const musiLintRatchetBinding: LintRatchetEngineBinding = {
  repoRoot,
  thirdPartyPluginAllowlist: lintRatchetThirdPartyPluginAllowlist,
};

/**
 * The Musi adapter's concrete {@link LintRatchetEngineContext}: the resolved repo
 * root and the committed baseline/debt-log paths. Governance operations take this
 * (or its fields) as a parameter instead of importing the repo-bound `paths`
 * module, so the portable engine has zero Musi bindings.
 */
export const musiLintRatchetContext: LintRatchetEngineContext = {
  repoRoot,
  baselinePath,
  debtLogPath,
  workflowVocabulary: musiLintRatchetWorkflowVocabulary,
};

export const lintRatchetGitRailAdapter: LintRatchetGitRailAdapter = {
  baselineFile: BASELINE_FILENAME,
  debtLogFile: DEBT_LOG_FILENAME,
  executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
  checkBaselineCommand: ["bun", "run", "lint:ratchet:check-baseline"],
  worseBaselineExitCode: 3,
  workflowVocabulary: musiLintRatchetWorkflowVocabulary,
  binding: musiLintRatchetBinding,
  ratchets: lintRatchets,
};
