import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { maxComplexityFor } from "./lint-ratchet-metrics-complexity.js";
import type { LintRatchetMetricItem } from "./lint-ratchet-metrics-types.js";

function validateEffectiveLineCountItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.lines === undefined) failures.push(`${path}.lines is required for effective-line-count`);
  if (item.maxComplexity !== undefined)
    failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
  if (item.perFunction !== undefined)
    failures.push(`${path}.perFunction is only valid for complexity-severity`);
  if (item.messagesFingerprint !== undefined)
    failures.push(`${path}.messagesFingerprint is only valid for message-count`);
}

function validateComplexitySeverityItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.maxComplexity === undefined)
    failures.push(`${path}.maxComplexity is required for complexity-severity`);
  if (item.perFunction === undefined)
    failures.push(`${path}.perFunction is required for complexity-severity`);
  if (item.lines !== undefined)
    failures.push(`${path}.lines is only valid for effective-line-count`);
  if (item.messagesFingerprint !== undefined)
    failures.push(`${path}.messagesFingerprint is only valid for message-count`);
  if (item.perFunction !== undefined && item.perFunction.length !== item.count)
    failures.push(`${path}.perFunction length must equal count`);
  const maxComplexity = maxComplexityFor(item.perFunction);
  if (maxComplexity !== undefined && item.maxComplexity !== maxComplexity)
    failures.push(`${path}.maxComplexity must match perFunction maximum`);
}

function validateOtherMetricItem(
  path: string,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (item.lines !== undefined)
    failures.push(`${path}.lines is only valid for effective-line-count`);
  if (item.maxComplexity !== undefined)
    failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
  if (item.perFunction !== undefined)
    failures.push(`${path}.perFunction is only valid for complexity-severity`);
}

export function validateMetricItem(
  path: string,
  metric: LintRatchetMetric,
  item: LintRatchetMetricItem,
  failures: string[],
): void {
  if (metric === "complexity-severity") {
    validateComplexitySeverityItem(path, item, failures);
    return;
  }
  if (metric === "effective-line-count") {
    validateEffectiveLineCountItem(path, item, failures);
    return;
  }
  validateOtherMetricItem(path, item, failures);
}
