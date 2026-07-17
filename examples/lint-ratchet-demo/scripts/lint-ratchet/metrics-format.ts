import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { metricStrategy } from "./metric-strategies.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

// Canonical committed-baseline form of an item. The per-metric codec lives on
// the metric strategy; this entry point delegates so callers keep one import.
export function metricItemForFormat(
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
): LintRatchetMetricItem {
  return metricStrategy(metric).formatItem(item);
}
