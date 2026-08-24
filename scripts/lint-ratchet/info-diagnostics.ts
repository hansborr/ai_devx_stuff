import type { HarnessFinding } from "@musi/harness-diagnostics/schema.js";
import type { LintRatchetInfo } from "@musi/lint-ratchet/kernel/baseline.js";
import type { LintRatchetWorkflowVocabulary } from "@musi/lint-ratchet/kernel/engine-context.js";

export function buildInfoFinding(
  info: LintRatchetInfo,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): HarnessFinding {
  return {
    control: info.testId,
    severity: "info",
    path: info.path,
    ruleId: info.ruleId,
    kind: "info",
    reason: info.reason,
    baselineCount: info.baselineCount,
    currentCount: info.currentCount,
    why: `${info.testId} has a different message fingerprint at the same count for ${info.ruleId}.`,
    howToFix: `Review the equal-count finding swap; if it is intentional, run \`${workflowVocabulary.updateCommand}\` to refresh the message fingerprint.`,
    repairKind: "manual",
  };
}
