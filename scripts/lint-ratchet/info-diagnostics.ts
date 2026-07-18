import type { LintRatchetInfo } from "@musi/lint-ratchet/kernel/baseline.js";

import type { HarnessFinding } from "../../packages/shared/src/schemas/harness-diagnostics.js";

export function buildInfoFinding(info: LintRatchetInfo): HarnessFinding {
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
    howToFix:
      "Review the equal-count finding swap; if it is intentional, run `bun run lint:ratchet:update` to refresh the message fingerprint.",
    repairKind: "manual",
  };
}
