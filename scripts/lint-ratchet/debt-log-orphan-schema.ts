import type {
  LintRatchetOrphanBaselineItem,
  LintRatchetOrphanRemoval,
} from "../lint-ratchet-baseline.js";
import type { LintRatchetMetric } from "../lint-ratchet-config.js";
import { validateMetricItem } from "../lint-ratchet-metrics.js";
import { parseLintRatchetBaselineItem } from "./baseline-item-parse.js";
import {
  isRecord,
  parseArrayOf,
  rejectUnknownKeys,
  requireNonEmptyString,
} from "./debt-log-parse-helpers.js";

const ORPHAN_KEYS: ReadonlySet<string> = new Set(["testId", "ruleId", "metric", "baselineItems"]);
const ORPHAN_ITEM_KEYS: ReadonlySet<string> = new Set([
  "path",
  "count",
  "lines",
  "maxComplexity",
  "perFunction",
]);
const PER_FUNCTION_KEYS: ReadonlySet<string> = new Set(["line", "label", "complexity"]);

function isLintRatchetMetric(value: unknown): value is LintRatchetMetric {
  return (
    value === "complexity-severity" || value === "effective-line-count" || value === "message-count"
  );
}

// Baseline-item parsing validates perFunction row types but not unknown keys, so
// enforce strict rejection at the deepest level too. Non-array/non-record rows
// are left for the baseline-item parser to report.
function rejectUnknownPerFunctionKeys(value: unknown, path: string, failures: string[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, row] of value.entries()) {
    if (isRecord(row)) {
      rejectUnknownKeys(row, PER_FUNCTION_KEYS, `${path}.perFunction[${String(index)}]`, failures);
    }
  }
}

function parseOrphanBaselineItem(
  value: unknown,
  path: string,
  metric: LintRatchetMetric,
  failures: string[],
): LintRatchetOrphanBaselineItem | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, ORPHAN_ITEM_KEYS, path, failures);
  rejectUnknownPerFunctionKeys(value.perFunction, path, failures);
  const itemPath = requireNonEmptyString(value.path, `${path}.path`, failures);
  if (itemPath === undefined) return undefined;
  const item = parseLintRatchetBaselineItem(itemPath, value, path, failures);
  if (item === undefined) return undefined;
  const failureCount = failures.length;
  validateMetricItem(path, metric, item, failures);
  return failures.length === failureCount ? { path: itemPath, ...item } : undefined;
}

function parseOrphanBaselineItems(
  value: unknown,
  path: string,
  metric: LintRatchetMetric,
  failures: string[],
): readonly LintRatchetOrphanBaselineItem[] | undefined {
  return parseArrayOf(value, `${path}.baselineItems`, failures, (item, itemPath, itemFailures) =>
    parseOrphanBaselineItem(item, itemPath, metric, itemFailures),
  );
}

export function parseDebtLogOrphanRemoval(
  value: unknown,
  path: string,
  failures: string[],
): LintRatchetOrphanRemoval | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, ORPHAN_KEYS, path, failures);
  const testId = requireNonEmptyString(value.testId, `${path}.testId`, failures);
  const ruleId = requireNonEmptyString(value.ruleId, `${path}.ruleId`, failures);
  const metric = isLintRatchetMetric(value.metric) ? value.metric : undefined;
  if (metric === undefined) failures.push(`${path}.metric is unknown`);
  const baselineItems =
    metric === undefined
      ? undefined
      : parseOrphanBaselineItems(value.baselineItems, path, metric, failures);
  if (
    testId === undefined ||
    ruleId === undefined ||
    metric === undefined ||
    baselineItems === undefined
  ) {
    return undefined;
  }
  return { testId, ruleId, metric, baselineItems };
}
