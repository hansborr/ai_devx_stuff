import type {
  LintRatchetBaseline,
  LintRatchetCurrentItem,
  LintRatchetImprovement,
} from "./baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

// Improvement reason for a path that dropped out of the baseline entirely. The
// report formatter folds this into its legacy `reason` improvement set (see
// baseline-compare.ts's reason exports).
export const REMOVED_PATH_REASON = "removed-path";

export function collectRemovedPathImprovements(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem>,
  improvements: LintRatchetImprovement[],
): void {
  for (const [path, item] of Object.entries(test.items)) {
    if (!currentItems.has(path)) {
      improvements.push({
        testId: ratchet.id,
        ruleId: ratchet.ruleId,
        path,
        baselineCount: item.count,
        currentCount: 0,
        reason: REMOVED_PATH_REASON,
      });
    }
  }
}
