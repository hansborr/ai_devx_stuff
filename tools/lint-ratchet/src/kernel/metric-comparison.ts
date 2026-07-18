import type {
  LintRatchetCurrentItem,
  LintRatchetImprovement,
  LintRatchetInfo,
  LintRatchetRegression,
} from "./baseline.js";
import type { LintRatchetConfig } from "./config-types.js";
import { equalCountMessageSwapInfo } from "./message-swap-info.js";
import { complexityDelta } from "./metrics-complexity.js";
import type {
  ComplexityDelta,
  LintRatchetComplexityFunction,
  LintRatchetMetricItem,
} from "./metrics-types.js";

export interface MetricItemComparisonContext {
  readonly ratchet: LintRatchetConfig;
  readonly path: string;
  readonly baselineItem: LintRatchetMetricItem | undefined;
  readonly current: LintRatchetCurrentItem;
}

export interface MetricItemComparison {
  readonly regression?: LintRatchetRegression;
  readonly improvement?: LintRatchetImprovement;
  readonly info?: LintRatchetInfo;
}

type NewPathPayload = Partial<
  Pick<
    LintRatchetRegression,
    "currentComplexity" | "currentLines" | "firstMessage" | "firstMessageId" | "line"
  >
>;

function linePayload(line: number | undefined): Partial<Pick<LintRatchetRegression, "line">> {
  return line === undefined ? {} : { line };
}

function messageContextPayload(
  context: MetricItemComparisonContext,
): Partial<Pick<LintRatchetRegression, "firstMessage" | "firstMessageId">> {
  if (context.current.firstMessage === undefined) return {};
  return {
    firstMessage: context.current.firstMessage,
    ...(context.current.firstMessageId === undefined
      ? {}
      : { firstMessageId: context.current.firstMessageId }),
  };
}

function highestComplexityFunction(
  current: LintRatchetCurrentItem,
): LintRatchetComplexityFunction | undefined {
  return current.perFunction?.reduce<LintRatchetComplexityFunction | undefined>(
    (best, entry) => (best === undefined || entry.complexity > best.complexity ? entry : best),
    undefined,
  );
}

function countIncreaseRegression(
  context: MetricItemComparisonContext,
  newPathPayload: NewPathPayload,
  existingPathPayload: NewPathPayload = linePayload(context.current.firstLine),
): LintRatchetRegression | undefined {
  const baselineCount = context.baselineItem?.count ?? 0;
  if (context.current.count <= baselineCount) return undefined;
  const base = {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount,
    currentCount: context.current.count,
    reason: baselineCount === 0 ? "new-path" : "increased-count",
  } as const;
  return baselineCount === 0 ? { ...base, ...newPathPayload } : { ...base, ...existingPathPayload };
}

function countDecreaseImprovement(
  context: MetricItemComparisonContext,
): LintRatchetImprovement | undefined {
  const baselineCount = context.baselineItem?.count ?? 0;
  if (context.current.count >= baselineCount) return undefined;
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount,
    currentCount: context.current.count,
    reason: "lower-count",
  };
}

function countComparison(
  context: MetricItemComparisonContext,
  newPathPayload: NewPathPayload,
  existingPathPayload?: NewPathPayload,
): MetricItemComparison | undefined {
  const regression = countIncreaseRegression(context, newPathPayload, existingPathPayload);
  if (regression !== undefined) return { regression };
  const improvement = countDecreaseImprovement(context);
  return improvement === undefined ? undefined : { improvement };
}

export function compareMessageCountItem(
  context: MetricItemComparisonContext,
): MetricItemComparison {
  const messagePayload = {
    ...messageContextPayload(context),
    ...linePayload(context.current.firstLine),
  };
  const count = countComparison(context, messagePayload, messagePayload);
  if (count !== undefined) return count;
  const info = equalCountMessageSwapInfo({
    ratchet: context.ratchet,
    path: context.path,
    baselineItem: context.baselineItem,
    current: context.current,
    baselineCount: context.baselineItem?.count ?? 0,
  });
  return info === undefined ? {} : { info };
}

function increasedLinesComparison(
  context: MetricItemComparisonContext,
  baselineLines: number | undefined,
  currentLines: number | undefined,
): MetricItemComparison | undefined {
  if (baselineLines === undefined || currentLines === undefined || currentLines <= baselineLines) {
    return undefined;
  }
  return {
    regression: {
      testId: context.ratchet.id,
      ruleId: context.ratchet.ruleId,
      path: context.path,
      baselineCount: context.baselineItem?.count ?? 0,
      currentCount: context.current.count,
      baselineLines,
      currentLines,
      reason: "increased-lines",
      ...linePayload(context.current.firstLine),
    },
  };
}

function lowerLinesComparison(
  context: MetricItemComparisonContext,
  baselineLines: number | undefined,
  currentLines: number | undefined,
): MetricItemComparison {
  if (baselineLines === undefined || currentLines === undefined || currentLines >= baselineLines) {
    return {};
  }
  return {
    improvement: {
      testId: context.ratchet.id,
      ruleId: context.ratchet.ruleId,
      path: context.path,
      baselineCount: context.baselineItem?.count ?? 0,
      currentCount: context.current.count,
      baselineLines,
      currentLines,
      reason: "lower-lines",
    },
  };
}

export function compareEffectiveLineCountItem(
  context: MetricItemComparisonContext,
): MetricItemComparison {
  const baselineLines = context.baselineItem?.lines;
  const currentLines = context.current.lines;
  const regression = increasedLinesComparison(context, baselineLines, currentLines);
  if (regression !== undefined) return regression;
  const count = countComparison(context, {
    ...(currentLines === undefined ? {} : { currentLines }),
    ...linePayload(context.current.firstLine),
  });
  return count ?? lowerLinesComparison(context, baselineLines, currentLines);
}

function increasedComplexityComparison(
  context: MetricItemComparisonContext,
  change: ComplexityDelta | undefined,
): MetricItemComparison | undefined {
  if (change?.regression !== true) return undefined;
  return {
    regression: {
      testId: context.ratchet.id,
      ruleId: context.ratchet.ruleId,
      path: context.path,
      baselineCount: context.baselineItem?.count ?? 0,
      currentCount: context.current.count,
      baselineComplexity: change.baselineComplexity,
      currentComplexity: change.currentComplexity,
      reason: "increased-complexity",
      ...linePayload(change.line),
    },
  };
}

function lowerComplexityComparison(
  context: MetricItemComparisonContext,
  change: ComplexityDelta | undefined,
): MetricItemComparison {
  if (change === undefined) return {};
  return {
    improvement: {
      testId: context.ratchet.id,
      ruleId: context.ratchet.ruleId,
      path: context.path,
      baselineCount: context.baselineItem?.count ?? 0,
      currentCount: context.current.count,
      baselineComplexity: change.baselineComplexity,
      currentComplexity: change.currentComplexity,
      reason: "lower-complexity",
    },
  };
}

export function compareComplexitySeverityItem(
  context: MetricItemComparisonContext,
): MetricItemComparison {
  const change = complexityDelta(context.baselineItem, context.current);
  const regression = increasedComplexityComparison(context, change);
  if (regression !== undefined) return regression;
  const maxEntry = highestComplexityFunction(context.current);
  const currentComplexity = maxEntry?.complexity ?? context.current.maxComplexity;
  const count = countComparison(context, {
    ...(currentComplexity === undefined ? {} : { currentComplexity }),
    ...linePayload(maxEntry?.line ?? context.current.firstLine),
  });
  return count ?? lowerComplexityComparison(context, change);
}
