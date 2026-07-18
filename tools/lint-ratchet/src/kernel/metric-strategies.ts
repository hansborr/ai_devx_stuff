// Per-metric behavior registered once, so adding a ratchet metric becomes a
// registration rather than a cross-cutting edit across collection, comparison,
// and merge. Before this registry the collector hardcoded the `local/max-lines`
// and `complexity` rule names inline.
//
// A strategy owns its metric's collection reduction, item codec (format +
// validate), and — folded in by later slices — comparison and semantic-minimum
// merge. The metrics-format/metrics-validation entry points delegate here so the
// codec lives in exactly one place.

import { sameCanonicalValue } from "./baseline-merge-values.js";
import type { LintRatchetConfig, LintRatchetMetric } from "./config-types.js";
import type { ESLintMessage } from "./eslint-runner.js";
import {
  compareComplexitySeverityItem,
  compareEffectiveLineCountItem,
  compareMessageCountItem,
  type MetricItemComparison,
  type MetricItemComparisonContext,
} from "./metric-comparison.js";
import {
  compareComplexityFunction,
  maxComplexityFor,
  parseComplexitySeverityMessage,
} from "./metrics-complexity.js";
import {
  ConfigError,
  type LintRatchetComplexityFunction,
  type LintRatchetMetricItem,
} from "./metrics-types.js";

// One ESLint message reduced to a metric's per-finding contribution. The
// collector folds a file's findings into a `LintRatchetCurrentItem` from these.
export interface MetricFinding {
  readonly lines?: number;
  readonly complexity?: LintRatchetComplexityFunction;
  readonly message?: string;
  readonly messageId?: string;
}

// Outcome of merging two items KNOWN to carry equal count: the semantic minimum
// on the metric's non-count axis (`item`), whether the merge should flag a
// post-merge truth-up, or a `failure` message when the sides disagree
// irreconcilably and a human must regenerate. Exactly one of `item`/`failure`
// is set.
interface SameCountMerge {
  readonly item?: LintRatchetMetricItem;
  readonly postMergeTruthUpRequired: boolean;
  readonly failure?: string;
}

export interface MetricStrategy {
  readonly metric: LintRatchetMetric;
  // The ESLint rule id a ratchet on this metric must use, or undefined when the
  // metric is rule-agnostic (message-count). Enforced at collection time.
  readonly requiredRuleId?: string;
  // Whether findings on this metric contribute a message-identity fingerprint
  // (message-count only): the SHA of the sorted message-identity list.
  readonly recordsMessageIdentity: boolean;
  // Reduce one ESLint message to this metric's per-finding contribution.
  reduceMessage(ratchet: LintRatchetConfig, path: string, message: ESLintMessage): MetricFinding;
  // Canonical committed-baseline form of an item: the metric's gating fields
  // only, deterministically ordered. The framework derives file bytes and
  // equality from this, so it must be pure.
  formatItem(item: LintRatchetMetricItem): LintRatchetMetricItem;
  // Append a failure for every field that is invalid or missing for this metric.
  validateItem(path: string, item: LintRatchetMetricItem, failures: string[]): void;
  // Compare one visited current item with its committed counterpart. Each
  // strategy owns the precedence of its non-count axis relative to count and
  // informational payload changes.
  compareItem(context: MetricItemComparisonContext): MetricItemComparison;
  // Merge two items KNOWN to have equal count, resolving the metric's non-count
  // axis to its semantic minimum. `path` is only used to render a failure
  // message. Different-count items resolve to the lower count generically (the
  // count is the floor) and never reach here.
  meetSameCountItem(
    path: string,
    left: LintRatchetMetricItem,
    right: LintRatchetMetricItem,
  ): SameCountMerge;
}

// A merged item's messagesFingerprint must be a deterministic function of both
// sides (order-independent), so a rebase that swaps the sides yields the same
// bytes. The lower fingerprint wins; a difference flags a truth-up because the
// finding set changed even though the count did not.
function deterministicMessagesFingerprint(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (left === right) return left;
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left < right ? left : right;
}

const MAX_LINES_MESSAGE_PATTERN =
  /This file has (?<lines>\d+) effective lines, above the \d+ line limit/u;

function requireRuleId(ratchet: LintRatchetConfig, metric: string, ruleId: string): void {
  if (ratchet.ruleId !== ruleId) {
    throw new ConfigError(`ratchet ${ratchet.id}: ${metric} requires ${ruleId}`);
  }
}

function effectiveLineCountFor(
  ratchet: LintRatchetConfig,
  path: string,
  message: ESLintMessage,
): number {
  const lines = MAX_LINES_MESSAGE_PATTERN.exec(message.message)?.groups?.lines;
  if (lines === undefined) {
    throw new ConfigError(
      `ratchet ${ratchet.id}: could not parse effective line count for ${path}: ${message.message}`,
    );
  }
  return Number(lines);
}

function sortedComplexityFunctions(
  item: LintRatchetMetricItem,
): readonly LintRatchetComplexityFunction[] | undefined {
  return item.perFunction === undefined
    ? undefined
    : [...item.perFunction].sort(compareComplexityFunction);
}

const messageCountStrategy: MetricStrategy = {
  metric: "message-count",
  recordsMessageIdentity: true,
  reduceMessage: (_ratchet, _path, message) => ({
    message: message.message,
    messageId: message.messageId,
  }),
  formatItem: (item) =>
    item.messagesFingerprint === undefined
      ? { count: item.count }
      : { count: item.count, messagesFingerprint: item.messagesFingerprint },
  validateItem: (path, item, failures) => {
    if (item.lines !== undefined)
      failures.push(`${path}.lines is only valid for effective-line-count`);
    if (item.maxComplexity !== undefined)
      failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
    if (item.perFunction !== undefined)
      failures.push(`${path}.perFunction is only valid for complexity-severity`);
  },
  compareItem: compareMessageCountItem,
  meetSameCountItem: (_path, left, right) => {
    const fingerprint = deterministicMessagesFingerprint(
      left.messagesFingerprint,
      right.messagesFingerprint,
    );
    return {
      item:
        fingerprint === undefined
          ? { count: left.count }
          : { count: left.count, messagesFingerprint: fingerprint },
      postMergeTruthUpRequired: left.messagesFingerprint !== right.messagesFingerprint,
    };
  },
};

const effectiveLineCountStrategy: MetricStrategy = {
  metric: "effective-line-count",
  requiredRuleId: "local/max-lines",
  recordsMessageIdentity: false,
  reduceMessage: (ratchet, path, message) => {
    requireRuleId(ratchet, "effective-line-count", "local/max-lines");
    return { lines: effectiveLineCountFor(ratchet, path, message) };
  },
  formatItem: (item) =>
    item.lines === undefined ? { count: item.count } : { count: item.count, lines: item.lines },
  validateItem: (path, item, failures) => {
    if (item.lines === undefined)
      failures.push(`${path}.lines is required for effective-line-count`);
    if (item.maxComplexity !== undefined)
      failures.push(`${path}.maxComplexity is only valid for complexity-severity`);
    if (item.perFunction !== undefined)
      failures.push(`${path}.perFunction is only valid for complexity-severity`);
    if (item.messagesFingerprint !== undefined)
      failures.push(`${path}.messagesFingerprint is only valid for message-count`);
  },
  compareItem: compareEffectiveLineCountItem,
  meetSameCountItem: (path, left, right) => {
    if (left.lines === undefined || right.lines === undefined) {
      return {
        postMergeTruthUpRequired: false,
        failure: `${path}: effective-line-count items need lines on both sides`,
      };
    }
    return {
      item: { count: left.count, lines: Math.min(left.lines, right.lines) },
      postMergeTruthUpRequired: left.lines !== right.lines,
    };
  },
};

const complexitySeverityStrategy: MetricStrategy = {
  metric: "complexity-severity",
  requiredRuleId: "complexity",
  recordsMessageIdentity: false,
  reduceMessage: (ratchet, path, message) => {
    requireRuleId(ratchet, "complexity-severity", "complexity");
    return { complexity: parseComplexitySeverityMessage(ratchet.id, path, message) };
  },
  formatItem: (item) => {
    const perFunction = sortedComplexityFunctions(item);
    const maxComplexity = maxComplexityFor(perFunction);
    return perFunction === undefined || maxComplexity === undefined
      ? { count: item.count }
      : { count: item.count, maxComplexity, perFunction };
  },
  validateItem: (path, item, failures) => {
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
  },
  compareItem: compareComplexitySeverityItem,
  meetSameCountItem: (path, left, right) => {
    const formattedLeft = complexitySeverityStrategy.formatItem(left);
    if (sameCanonicalValue(formattedLeft, complexitySeverityStrategy.formatItem(right))) {
      return { item: formattedLeft, postMergeTruthUpRequired: false };
    }
    return {
      postMergeTruthUpRequired: false,
      failure: `${path}: equal-count complexity-severity payloads differ`,
    };
  },
};

const METRIC_STRATEGIES: Record<LintRatchetMetric, MetricStrategy> = {
  "message-count": messageCountStrategy,
  "effective-line-count": effectiveLineCountStrategy,
  "complexity-severity": complexitySeverityStrategy,
};

export function metricStrategy(metric: LintRatchetMetric): MetricStrategy {
  return METRIC_STRATEGIES[metric];
}

export function metricStrategies(): readonly MetricStrategy[] {
  return Object.values(METRIC_STRATEGIES);
}
