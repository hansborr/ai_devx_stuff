import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { compareComplexityFunction, maxComplexityFor } from "./lint-ratchet-metrics-complexity.js";
import type {
  LintRatchetComplexityFunction,
  LintRatchetMetricItem,
} from "./lint-ratchet-metrics-types.js";

function sortedComplexityFunctions(
  item: LintRatchetMetricItem,
): readonly LintRatchetComplexityFunction[] | undefined {
  return item.perFunction === undefined
    ? undefined
    : [...item.perFunction].sort(compareComplexityFunction);
}

export function metricItemForFormat(
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
): LintRatchetMetricItem {
  if (metric === "effective-line-count" && item.lines !== undefined)
    return { count: item.count, lines: item.lines };
  if (metric === "complexity-severity") {
    const perFunction = sortedComplexityFunctions(item);
    const maxComplexity = maxComplexityFor(perFunction);
    return perFunction === undefined || maxComplexity === undefined
      ? { count: item.count }
      : { count: item.count, maxComplexity, perFunction };
  }
  return { count: item.count };
}
