import type { HarnessFinding } from "../../packages/shared/src/schemas/harness-diagnostics.js";
import type { LintRatchetCurrentById, LintRatchetCurrentItem } from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { isReportOnlyRatchet } from "./runtime-config.js";

export interface LintRatchetReportOnlySummary {
  readonly testId: string;
  readonly ruleId: string;
  readonly fileCount: number;
  readonly currentCount: number;
}

function itemCount(items: ReadonlyMap<string, LintRatchetCurrentItem>): number {
  let total = 0;
  for (const item of items.values()) total += item.count;
  return total;
}

export function buildReportOnlySummaries(
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): readonly LintRatchetReportOnlySummary[] {
  return ratchets.filter(isReportOnlyRatchet).map((ratchet) => {
    const items = currentById.get(ratchet.id) ?? new Map<string, LintRatchetCurrentItem>();
    return {
      testId: ratchet.id,
      ruleId: ratchet.ruleId,
      fileCount: items.size,
      currentCount: itemCount(items),
    };
  });
}

export function buildReportOnlyFinding(summary: LintRatchetReportOnlySummary): HarnessFinding {
  return {
    control: summary.testId,
    severity: "info",
    ruleId: summary.ruleId,
    kind: "report-only",
    reason: "report-only",
    currentCount: summary.currentCount,
    why:
      `${summary.testId} is report-only: ${String(summary.currentCount)} current finding(s) ` +
      `across ${String(summary.fileCount)} file(s) for ${summary.ruleId}.`,
    howToFix:
      "Review this inventory before promoting the ratchet to no-new mode; report-only findings do not update the committed baseline or fail the gate.",
    repairKind: "manual",
  };
}
