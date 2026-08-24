import type { LintRatchetWorkflowVocabulary } from "../src/kernel/engine-context.js";
import { RATCHET_REGRESSION_REASON_PLACEHOLDER } from "../src/kernel/recovery-command.js";

export const fixtureWorkflowVocabulary: LintRatchetWorkflowVocabulary = {
  updateCommand: "bun run lint:ratchet:update",
  regressionUpdateCommand: `bun run lint:ratchet:update -- --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`,
  debtAcceptanceCommand: 'bun run lint:ratchet:update -- --allow-worse --reason "<why>"',
  installMergeDriverCommand: "bun run lint:ratchet:install-merge-driver",
  restoreBaselineOursCommand: (baselineFile) =>
    `bun run baseline:restore-stage -- --ours ${baselineFile}`,
  trendAllCommand: "bun run lint:ratchet:trend -- --all",
};

export const customWorkflowVocabulary: LintRatchetWorkflowVocabulary = {
  updateCommand: "fixture-ratchet update",
  regressionUpdateCommand: `fixture-ratchet update --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`,
  debtAcceptanceCommand: 'fixture-ratchet update --allow-worse --reason "<why>"',
  installMergeDriverCommand: "fixture-ratchet install-merge-driver",
  restoreBaselineOursCommand: (baselineFile) => `fixture-ratchet restore-ours ${baselineFile}`,
  trendAllCommand: "fixture-ratchet trend --all",
};
