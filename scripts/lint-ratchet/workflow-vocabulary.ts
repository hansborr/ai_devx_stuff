import type { LintRatchetWorkflowVocabulary } from "@musi/lint-ratchet/kernel/engine-context.js";
import { RATCHET_REGRESSION_REASON_PLACEHOLDER } from "@musi/lint-ratchet/kernel/recovery-command.js";

/**
 * Musi's concrete command spellings. Keep this adapter binding near-leaf so
 * standalone CLI fixtures can reuse it without importing the registry/config
 * dependency graph carried by the full engine binding.
 */
export const musiLintRatchetWorkflowVocabulary: LintRatchetWorkflowVocabulary = {
  updateCommand: "bun run lint:ratchet:update",
  regressionUpdateCommand: `bun run lint:ratchet:update -- --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`,
  debtAcceptanceCommand: 'bun run lint:ratchet:update -- --allow-worse --reason "<why>"',
  installMergeDriverCommand: "bun run lint:ratchet:install-merge-driver",
  restoreBaselineOursCommand: (baselineFile) =>
    `bun run baseline:restore-stage -- --ours ${baselineFile}`,
  trendAllCommand: "bun run lint:ratchet:trend -- --all",
};
