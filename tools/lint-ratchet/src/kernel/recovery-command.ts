// Single source of truth for the lint:ratchet baseline-update recovery commands
// surfaced in run summaries, the report footer, and CI. The bare form is
// correct only when there is no regression to accept; once a regression is
// present the updater refuses unless `--allow-worse --reason` is supplied (see
// decideLintRatchetUpdate in baseline-update.ts).

import type { LintRatchetWorkflowVocabulary } from "./engine-context.js";

export const RATCHET_REGRESSION_REASON_PLACEHOLDER =
  "<why accepting this baseline increase is better than forcing a low-quality fix now>";

export function regressionRecoveryFooter(
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string {
  return `Recovery: fix the regressions above; if the new findings are intentional, run \`${workflowVocabulary.regressionUpdateCommand}\`.`;
}

export function isRatchetRegressionReasonPlaceholder(reason: string): boolean {
  const trimmed = reason.trim();
  return (
    trimmed === RATCHET_REGRESSION_REASON_PLACEHOLDER || trimmed.toLowerCase().startsWith("<why")
  );
}

export function ratchetRegressionReasonFailure(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length === 0) return "--allow-worse requires a non-empty --reason";
  if (isRatchetRegressionReasonPlaceholder(trimmed)) {
    return "--allow-worse requires a real --reason, not the placeholder";
  }
  return undefined;
}
