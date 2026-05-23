import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import type { LintRatchetBaseline, LintRatchetComparison, LintRatchetCurrentById, LintRatchetCurrentItem, LintRatchetRegression } from "./lint-ratchet-baseline.js";
import { complexityDelta, type LintRatchetComplexityFunction } from "./lint-ratchet-metrics.js";

type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type LintRatchetBaselineItem = NonNullable<LintRatchetBaselineTest["items"][string]>;
type LintRatchetImprovement = LintRatchetComparison["improvements"][number];
type LintRatchetComplexityDelta = NonNullable<ReturnType<typeof complexityDelta>>;

function linePayload(line: number | undefined): Partial<Pick<LintRatchetRegression, "line">> {
  return line === undefined ? {} : { line };
}

function defaultNewPathSeverityPayload(current: LintRatchetCurrentItem): Partial<Pick<LintRatchetRegression, "line">> {
  return linePayload(current.firstLine);
}

function effectiveLineCountNewPathPayload(
  current: LintRatchetCurrentItem,
): Partial<Pick<LintRatchetRegression, "currentLines" | "line">> {
  if (current.lines === undefined) return defaultNewPathSeverityPayload(current);
  return { currentLines: current.lines, ...linePayload(current.firstLine) };
}

function highestComplexityFunction(current: LintRatchetCurrentItem): LintRatchetComplexityFunction | undefined {
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
  ratchet: LintRatchetConfig,
  path: string,
  baselineItem: LintRatchetBaselineItem | undefined,
  current: LintRatchetCurrentItem,
  baselineCount: number,
): LintRatchetRegression | undefined {
  if (ratchet.metric !== "effective-line-count") return undefined;
  if (baselineItem?.lines === undefined) return undefined;
  if (current.lines === undefined) return undefined;
  if (current.lines <= baselineItem.lines) return undefined;
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    baselineLines: baselineItem.lines,
    currentLines: current.lines,
    reason: "increased-lines",
    ...linePayload(current.firstLine),
  };
}

function increasedComplexityRegression(
  ratchet: LintRatchetConfig,
  path: string,
  current: LintRatchetCurrentItem,
  baselineCount: number,
  complexityChange: LintRatchetComplexityDelta | undefined,
): LintRatchetRegression | undefined {
  if (complexityChange?.regression !== true) return undefined;
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    baselineComplexity: complexityChange.baselineComplexity,
    currentComplexity: complexityChange.currentComplexity,
    reason: "increased-complexity",
    ...linePayload(complexityChange.line),
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
  } as const;
  return baselineCount === 0 ? { ...base, ...newPathSeverityPayload(ratchet, current) } : { ...base, ...linePayload(current.firstLine) };
}

function countDecreaseImprovement(
  ratchet: LintRatchetConfig,
  path: string,
  current: LintRatchetCurrentItem,
  baselineCount: number,
): LintRatchetImprovement | undefined {
  if (current.count >= baselineCount) return undefined;
  return { testId: ratchet.id, ruleId: ratchet.ruleId, path, baselineCount, currentCount: current.count, reason: "lower-count" };
}

function lowerLinesImprovement(
  ratchet: LintRatchetConfig,
  path: string,
  baselineItem: LintRatchetBaselineItem | undefined,
  current: LintRatchetCurrentItem,
  baselineCount: number,
): LintRatchetImprovement | undefined {
  if (ratchet.metric !== "effective-line-count") return undefined;
  if (baselineItem?.lines === undefined) return undefined;
  if (current.lines === undefined) return undefined;
  if (current.lines >= baselineItem.lines) return undefined;
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    baselineLines: baselineItem.lines,
    currentLines: current.lines,
    reason: "lower-lines",
  };
}

function lowerComplexityImprovement(
  ratchet: LintRatchetConfig,
  path: string,
  current: LintRatchetCurrentItem,
  baselineCount: number,
  complexityChange: LintRatchetComplexityDelta | undefined,
): LintRatchetImprovement | undefined {
  if (complexityChange === undefined) return undefined;
  if (complexityChange.regression) return undefined;
  return {
    testId: ratchet.id,
    ruleId: ratchet.ruleId,
    path,
    baselineCount,
    currentCount: current.count,
    baselineComplexity: complexityChange.baselineComplexity,
    currentComplexity: complexityChange.currentComplexity,
    reason: "lower-complexity",
  };
}

interface ComparedCurrentItem {
  readonly regression?: LintRatchetRegression;
  readonly improvement?: LintRatchetImprovement;
}

function compareCurrentItemToBaseline(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  path: string,
  current: LintRatchetCurrentItem,
): ComparedCurrentItem {
  const baselineItem = test.items[path];
  const baselineCount = baselineItem?.count ?? 0;
  const lineRegression = increasedLinesRegression(ratchet, path, baselineItem, current, baselineCount);
  if (lineRegression !== undefined) return { regression: lineRegression };
  const complexityChange = ratchet.metric === "complexity-severity" ? complexityDelta(baselineItem, current) : undefined;
  const complexityRegression = increasedComplexityRegression(ratchet, path, current, baselineCount, complexityChange);
  if (complexityRegression !== undefined) return { regression: complexityRegression };
  const countRegression = countIncreaseRegression(ratchet, path, current, baselineCount);
  if (countRegression !== undefined) return { regression: countRegression };
  const countImprovement = countDecreaseImprovement(ratchet, path, current, baselineCount);
  if (countImprovement !== undefined) return { improvement: countImprovement };
  const lineImprovement = lowerLinesImprovement(ratchet, path, baselineItem, current, baselineCount);
  if (lineImprovement !== undefined) return { improvement: lineImprovement };
  const complexityImprovement = lowerComplexityImprovement(ratchet, path, current, baselineCount, complexityChange);
  return complexityImprovement === undefined ? {} : { improvement: complexityImprovement };
}

function compareCurrentItemsToBaseline(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem>,
  regressions: LintRatchetRegression[],
  improvements: LintRatchetImprovement[],
): void {
  for (const [path, current] of currentItems.entries()) {
    const compared = compareCurrentItemToBaseline(ratchet, test, path, current);
    if (compared.regression !== undefined) regressions.push(compared.regression);
    if (compared.improvement !== undefined) improvements.push(compared.improvement);
  }
}

function collectRemovedPathImprovements(
  ratchet: LintRatchetConfig,
  test: LintRatchetBaselineTest,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem>,
  improvements: LintRatchetImprovement[],
): void {
  for (const [path, item] of Object.entries(test.items)) {
    if (!currentItems.has(path)) {
      improvements.push({
        testId: ratchet.id,
        ruleId: ratchet.ruleId,
        path,
        baselineCount: item.count,
        currentCount: 0,
        reason: "removed-path",
      });
    }
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
  for (const ratchet of ratchets) {
    const test = baseline.tests[ratchet.id];
    if (test === undefined) continue;
    const currentItems = currentById.get(ratchet.id) ?? new Map<string, LintRatchetCurrentItem>();
    compareCurrentItemsToBaseline(ratchet, test, currentItems, regressions, improvements);
    collectRemovedPathImprovements(ratchet, test, currentItems, improvements);
  }
  regressions.sort(compareByTestIdThenPath);
  improvements.sort(compareByTestIdThenPath);
  return { regressions, improvements };
}
