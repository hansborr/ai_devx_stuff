import type {
  LintRatchetBaseline,
  LintRatchetComparison,
  LintRatchetCurrentById,
  LintRatchetImprovement,
  LintRatchetInfo,
  LintRatchetRegression,
} from "./baseline.js";
import {
  type LintRatchetBaselineGroupMeta,
  lintRatchetBaselineSpec,
  lintRatchetBaselineToGrouped,
} from "./baseline-spec.js";
import type { LintRatchetConfig } from "./config-types.js";
import {
  compareGroupedBaseline,
  type GroupedBaseline,
  type GroupedBaselineGroup,
} from "./group-baseline.js";
import type { MetricItemComparison } from "./metric-comparison.js";
import { metricStrategy } from "./metric-strategies.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";
import { removedPathImprovement } from "./removed-path-improvements.js";

// Improvement reason vocabulary produced by the metric strategies. The report
// formatter rebuilds its legacy `reason`-based improvement set (for envelopes
// without an explicit `kind`) from these exports plus `REMOVED_PATH_REASON`.
export const LOWER_COUNT_REASON = "lower-count";
export const LOWER_LINES_REASON = "lower-lines";
export const LOWER_COMPLEXITY_REASON = "lower-complexity";

interface ComparisonDeltas {
  readonly regressions: LintRatchetRegression[];
  readonly improvements: LintRatchetImprovement[];
  readonly infos: LintRatchetInfo[];
}

interface KernelComparisonInput {
  readonly baseline: GroupedBaseline<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>;
  readonly current: GroupedBaseline<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>;
  readonly ratchetsById: ReadonlyMap<string, LintRatchetConfig>;
}

function compareByTestIdThenPath(
  left: Pick<LintRatchetRegression, "testId" | "path">,
  right: Pick<LintRatchetRegression, "testId" | "path">,
): number {
  const testCompare = left.testId.localeCompare(right.testId);
  if (testCompare !== 0) return testCompare;
  return left.path.localeCompare(right.path);
}

function registeredGroups(
  baseline: GroupedBaseline<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>,
  ratchetsById: ReadonlyMap<string, LintRatchetConfig>,
): ReadonlyMap<string, GroupedBaselineGroup<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>> {
  return new Map([...baseline.groups].filter(([testId]) => ratchetsById.has(testId)));
}

function currentGroups(
  baselineGroups: ReadonlyMap<
    string,
    GroupedBaselineGroup<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>
  >,
  currentById: LintRatchetCurrentById,
): ReadonlyMap<string, GroupedBaselineGroup<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>> {
  const groups = new Map<
    string,
    GroupedBaselineGroup<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>
  >();
  for (const [testId, baselineGroup] of baselineGroups) {
    groups.set(testId, {
      meta: baselineGroup.meta,
      items: currentById.get(testId) ?? new Map<string, LintRatchetMetricItem>(),
    });
  }
  return groups;
}

function comparisonInput(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): KernelComparisonInput {
  const grouped = lintRatchetBaselineToGrouped(baseline);
  const ratchetsById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  const groups = registeredGroups(grouped, ratchetsById);
  return {
    baseline: { ...grouped, groups },
    current: { ...grouped, groups: currentGroups(groups, currentById) },
    ratchetsById,
  };
}

function recordComparedItem(result: MetricItemComparison, deltas: ComparisonDeltas): void {
  if (result.regression !== undefined) deltas.regressions.push(result.regression);
  if (result.improvement !== undefined) deltas.improvements.push(result.improvement);
  if (result.info !== undefined) deltas.infos.push(result.info);
}

export function compareCurrentToBaseline(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): LintRatchetComparison {
  const input = comparisonInput(baseline, ratchets, currentById);
  const grouped = compareGroupedBaseline(lintRatchetBaselineSpec(), input.baseline, input.current);
  const deltas: ComparisonDeltas = { regressions: [], improvements: [], infos: [] };
  for (const compared of grouped.comparedItems) {
    const ratchet = input.ratchetsById.get(compared.groupId);
    if (ratchet === undefined) {
      throw new Error(`grouped comparison visited unregistered ratchet ${compared.groupId}`);
    }
    if (compared.currentItem === undefined) {
      if (compared.baselineItem !== undefined) {
        deltas.improvements.push(
          removedPathImprovement(ratchet, compared.itemKey, compared.baselineItem),
        );
      }
      continue;
    }
    const current = currentById.get(compared.groupId)?.get(compared.itemKey);
    if (current === undefined) {
      throw new Error(
        `grouped comparison lost current item ${compared.groupId}.items.${compared.itemKey}`,
      );
    }
    recordComparedItem(
      metricStrategy(ratchet.metric).compareItem({
        ratchet,
        path: compared.itemKey,
        baselineItem: compared.baselineItem,
        current,
      }),
      deltas,
    );
  }
  deltas.regressions.sort(compareByTestIdThenPath);
  deltas.improvements.sort(compareByTestIdThenPath);
  deltas.infos.sort(compareByTestIdThenPath);
  return deltas;
}
