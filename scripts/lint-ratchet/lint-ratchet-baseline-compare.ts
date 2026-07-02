import type {
  LintRatchetBaseline,
  LintRatchetComparison,
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetInfo,
  LintRatchetRegression,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { complexityDelta, type LintRatchetComplexityFunction } from "./lint-ratchet-metrics.js";
import { equalCountMessageSwapInfo } from "./message-swap-info.js";
import { collectRemovedPathImprovements } from "./removed-path-improvements.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type LintRatchetBaselineItem = NonNullable<LintRatchetBaselineTest["items"][string]>;
type LintRatchetImprovement = LintRatchetComparison["improvements"][number];
type LintRatchetComplexityDelta = NonNullable<ReturnType<typeof complexityDelta>>;

interface CurrentItemComparisonContext {
  readonly ratchet: LintRatchetConfig;
  readonly path: string;
  readonly baselineItem: LintRatchetBaselineItem | undefined;
  readonly current: LintRatchetCurrentItem;
  readonly baselineCount: number;
  readonly complexityChange: LintRatchetComplexityDelta | undefined;
}

interface ComparisonDeltas {
  readonly regressions: LintRatchetRegression[];
  readonly improvements: LintRatchetImprovement[];
  readonly infos: LintRatchetInfo[];
}

function linePayload(line: number | undefined): Partial<Pick<LintRatchetRegression, "line">> {
  return line === undefined ? {} : { line };
}

function messageContextPayload(
  ratchet: LintRatchetConfig,
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "firstMessage" | "firstMessageId">> {
  if (ratchet.metric !== "message-count") return {};
  if (current.firstMessage === undefined) return {};
  return {
    firstMessage: current.firstMessage,
    ...(current.firstMessageId === undefined ? {} : { firstMessageId: current.firstMessageId }),
  };
}

function defaultNewPathSeverityPayload(
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "line">> {
  return linePayload(current.firstLine);
}

function effectiveLineCountNewPathPayload(
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "currentLines" | "line">> {
  if (current.lines === undefined) return defaultNewPathSeverityPayload(current);
  return { currentLines: current.lines, ...linePayload(current.firstLine) };
}

function highestComplexityFunction(
  current: LintRatchetCurrentItem,
): LintRatchetComplexityFunction | undefined {
  return current.perFunction?.reduce<LintRatchetComplexityFunction | undefined>(
    (best, entry) => (best === undefined || entry.complexity > best.complexity ? entry : best),
    undefined,
  );
}

function complexitySeverityNewPathPayload(
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "currentComplexity" | "line">> {
  const maxEntry = highestComplexityFunction(current);
  const currentComplexity = maxEntry?.complexity ?? current.maxComplexity;
  if (currentComplexity === undefined) return defaultNewPathSeverityPayload(current);
  return { currentComplexity, ...linePayload(maxEntry?.line ?? current.firstLine) };
}

function newPathSeverityPayload(
  ratchet: LintRatchetConfig,
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "currentComplexity" | "currentLines" | "line">> {
  switch (ratchet.metric) {
    case "effective-line-count":
      return effectiveLineCountNewPathPayload(current);
    case "complexity-severity":
      return complexitySeverityNewPathPayload(current);
    case "message-count":
      return defaultNewPathSeverityPayload(current);
    default:
      return defaultNewPathSeverityPayload(current);
  }
}

function increasedLinesRegression(
  context: CurrentItemComparisonContext,
): LintRatchetRegression | undefined {
  if (context.ratchet.metric !== "effective-line-count") return undefined;
  if (context.baselineItem?.lines === undefined) return undefined;
  if (context.current.lines === undefined) return undefined;
  if (context.current.lines <= context.baselineItem.lines) return undefined;
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount: context.baselineCount,
    currentCount: context.current.count,
    baselineLines: context.baselineItem.lines,
    currentLines: context.current.lines,
    reason: "increased-lines",
    ...linePayload(context.current.firstLine),
  };
}

function increasedComplexityRegression(
  context: CurrentItemComparisonContext,
): LintRatchetRegression | undefined {
  if (context.complexityChange?.regression !== true) return undefined;
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount: context.baselineCount,
    currentCount: context.current.count,
    baselineComplexity: context.complexityChange.baselineComplexity,
    currentComplexity: context.complexityChange.currentComplexity,
    reason: "increased-complexity",
    ...linePayload(context.complexityChange.line),
  };
}

function countIncreaseRegression(
  ratchet: LintRatchetConfig,
  path: string,
  current: LintRatchetCurrentItem,
  baselineCount: number,
): LintRatchetRegression | undefined {
  if (current.count <= baselineCount) return undefined;
  const base = {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    reason: baselineCount === 0 ? "new-path" : "increased-count",
    ...messageContextPayload(ratchet, current),
  } as const;
  return baselineCount === 0
    ? { ...base, ...newPathSeverityPayload(ratchet, current) }
    : { ...base, ...linePayload(current.firstLine) };
}

function countDecreaseImprovement(
  ratchet: LintRatchetConfig,
  path: string,
  current: LintRatchetCurrentItem,
  baselineCount: number,
): LintRatchetImprovement | undefined {
  if (current.count >= baselineCount) return undefined;
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    reason: "lower-count",
  };
}

function lowerLinesImprovement(
  context: CurrentItemComparisonContext,
): LintRatchetImprovement | undefined {
  if (context.ratchet.metric !== "effective-line-count") return undefined;
  if (context.baselineItem?.lines === undefined) return undefined;
  if (context.current.lines === undefined) return undefined;
  if (context.current.lines >= context.baselineItem.lines) return undefined;
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount: context.baselineCount,
    currentCount: context.current.count,
    baselineLines: context.baselineItem.lines,
    currentLines: context.current.lines,
    reason: "lower-lines",
  };
}

function lowerComplexityImprovement(
  context: CurrentItemComparisonContext,
): LintRatchetImprovement | undefined {
  if (context.complexityChange === undefined) return undefined;
  if (context.complexityChange.regression) return undefined;
  return {
    testId: context.ratchet.id,
    ruleId: context.ratchet.ruleId,
    path: context.path,
    baselineCount: context.baselineCount,
    currentCount: context.current.count,
    baselineComplexity: context.complexityChange.baselineComplexity,
    currentComplexity: context.complexityChange.currentComplexity,
    reason: "lower-complexity",
  };
}

interface ComparedCurrentItem {
  readonly regression?: LintRatchetRegression;
  readonly improvement?: LintRatchetImprovement;
  readonly info?: LintRatchetInfo;
}

function compareNonCountDeltas(context: CurrentItemComparisonContext): ComparedCurrentItem {
  const lineImprovement = lowerLinesImprovement(context);
  if (lineImprovement !== undefined) return { improvement: lineImprovement };
  const complexityImprovement = lowerComplexityImprovement(context);
  if (complexityImprovement !== undefined) return { improvement: complexityImprovement };
  const info = equalCountMessageSwapInfo(context);
  return info === undefined ? {} : { info };
}

function compareCurrentItemToBaseline(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  path: string,
  current: LintRatchetCurrentItem,
): ComparedCurrentItem {
  const baselineItem = test.items[path];
  const baselineCount = baselineItem?.count ?? 0;
  const complexityChange =
    ratchet.metric === "complexity-severity" ? complexityDelta(baselineItem, current) : undefined;
  const context: CurrentItemComparisonContext = {
    ratchet,
    path,
    baselineItem,
    current,
    baselineCount,
    complexityChange,
  };
  const lineRegression = increasedLinesRegression(context);
  if (lineRegression !== undefined) return { regression: lineRegression };
  const complexityRegression = increasedComplexityRegression(context);
  if (complexityRegression !== undefined) return { regression: complexityRegression };
  const countRegression = countIncreaseRegression(ratchet, path, current, baselineCount);
  if (countRegression !== undefined) return { regression: countRegression };
  const countImprovement = countDecreaseImprovement(ratchet, path, current, baselineCount);
  if (countImprovement !== undefined) return { improvement: countImprovement };
  return compareNonCountDeltas(context);
}

function compareCurrentItemsToBaseline(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem>,
  deltas: ComparisonDeltas,
): void {
  for (const [path, current] of currentItems.entries()) {
    const compared = compareCurrentItemToBaseline(ratchet, test, path, current);
    if (compared.regression !== undefined) deltas.regressions.push(compared.regression);
    if (compared.improvement !== undefined) deltas.improvements.push(compared.improvement);
    if (compared.info !== undefined) deltas.infos.push(compared.info);
  }
}

function compareByTestIdThenPath(
  left: Pick<LintRatchetRegression, "testId" | "path">,
  right: Pick<LintRatchetRegression, "testId" | "path">,
): number {
  const testCompare = left.testId.localeCompare(right.testId);
  if (testCompare !== 0) return testCompare;
  return left.path.localeCompare(right.path);
}

export function compareCurrentToBaseline(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
): LintRatchetComparison {
  const regressions: LintRatchetRegression[] = [];
  const improvements: LintRatchetImprovement[] = [];
  const infos: LintRatchetInfo[] = [];
  for (const ratchet of ratchets) {
    const test = baseline.tests[ratchet.id];
    if (test === undefined) continue;
    const currentItems = currentById.get(ratchet.id) ?? new Map<string, LintRatchetCurrentItem>();
    compareCurrentItemsToBaseline(ratchet, test, currentItems, {
      regressions,
      improvements,
      infos,
    });
    collectRemovedPathImprovements(ratchet, test, currentItems, improvements);
  }
  regressions.sort(compareByTestIdThenPath);
  improvements.sort(compareByTestIdThenPath);
  infos.sort(compareByTestIdThenPath);
  return { regressions, improvements, infos };
}
