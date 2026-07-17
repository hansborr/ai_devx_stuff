import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { metricStrategy } from "./metric-strategies.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

// Append a failure for every field invalid or missing for this metric. The
// per-metric rules live on the metric strategy; this entry point delegates so
// callers keep one import.
export function validateMetricItem(
  path: string,
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  metricStrategy(metric).validateItem(path, item, failures);
}
