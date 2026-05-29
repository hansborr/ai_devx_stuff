import { parseMetricFields, type LintRatchetMetricItem } from "../lint-ratchet-metrics.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNormalizedLintRatchetPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.startsWith("./");
}

export function parseLintRatchetBaselineItem(
  itemPath: string,
  rawItem: unknown,
  path: string,
  failures: string[],
): LintRatchetMetricItem | undefined {
  if (!isNormalizedLintRatchetPath(itemPath)) {
    failures.push(`${path}: path must be normalized`);
    return undefined;
  }
  if (!isRecord(rawItem)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  const count = rawItem.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    failures.push(`${path}.count must be a non-negative integer`);
    return undefined;
  }
  const metricFields = parseMetricFields(rawItem, path, failures);
  if (metricFields === undefined) return undefined;
  return { count, ...metricFields };
}
