import type {
  LintRatchetBaseline,
  LintRatchetCurrentItem,
  LintRatchetImprovement,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

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
        reason: "removed-path",
      });
    }
  }
}
