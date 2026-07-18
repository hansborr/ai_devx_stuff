import type { LintRatchetBaseline, LintRatchetImprovement } from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

// Improvement reason for a path that dropped out of the baseline entirely. The
// report formatter folds this into its legacy `reason` improvement set (see
// baseline-compare.ts's reason exports).
export const REMOVED_PATH_REASON = "removed-path";

export function removedPathImprovement(
  ratchet: LintRatchetConfig,
  path: string,
  item: NonNullable<LintRatchetBaselineTest["items"][string]>,
): LintRatchetImprovement {
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount: item.count,
    currentCount: 0,
    reason: REMOVED_PATH_REASON,
  };
}
