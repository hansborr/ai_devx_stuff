import { assertNever } from "../kernel/runtime-config.js";
import type { BaselineDebtIncrease } from "./baseline-debt-accounting.js";
import type {
  LintRatchetAcceptedDebtLogEntry,
  LintRatchetDebtLogEntry,
} from "./debt-log-schema.js";

type DebtLogRegression = LintRatchetAcceptedDebtLogEntry["regressions"][number];

function matchingRegressions(
  increase: BaselineDebtIncrease,
  entries: readonly LintRatchetDebtLogEntry[],
): readonly DebtLogRegression[] {
  return entries.flatMap((entry) => {
    switch (entry.kind) {
      case "accepted-debt":
        return entry.regressions.filter(
          (regression) =>
            regression.testId === increase.testId &&
            regression.ruleId === increase.ruleId &&
            regression.path === increase.path,
        );
      case "coverage-shrink":
      case "metric-migration":
      case "retirement":
        return [];
      default:
        return assertNever(entry);
    }
  });
}

function isNextCountTransition(
  regression: DebtLogRegression,
  count: number,
  expectedReason: DebtLogRegression["reason"],
): boolean {
  return (
    regression.reason === expectedReason &&
    regression.baselineCount === count &&
    regression.currentCount > regression.baselineCount
  );
}

function countChainAccountsForIncrease(
  increase: BaselineDebtIncrease,
  regressions: readonly DebtLogRegression[],
): boolean {
  let count = increase.previousCount;
  let sawNewPath = increase.kind !== "new-path";
  for (const regression of regressions) {
    if (!sawNewPath && isNextCountTransition(regression, count, "new-path")) {
      count = regression.currentCount;
      sawNewPath = true;
      continue;
    }
    if (sawNewPath && isNextCountTransition(regression, count, "increased-count")) {
      count = regression.currentCount;
    }
  }
  return sawNewPath && count === increase.currentCount;
}

function lineChainAccountsForIncrease(
  increase: BaselineDebtIncrease,
  regressions: readonly DebtLogRegression[],
): boolean {
  if (increase.previousLines === undefined || increase.currentLines === undefined) return false;
  let lines = increase.previousLines;
  let endpointCount: number | undefined;
  for (const regression of regressions) {
    if (
      regression.reason === "increased-lines" &&
      regression.baselineLines !== undefined &&
      regression.currentLines !== undefined &&
      regression.baselineLines === lines &&
      regression.currentLines > regression.baselineLines
    ) {
      lines = regression.currentLines;
      endpointCount = regression.currentCount;
    }
  }
  return lines === increase.currentLines && endpointCount === increase.currentCount;
}

function complexityChainAccountsForIncrease(
  increase: BaselineDebtIncrease,
  regressions: readonly DebtLogRegression[],
): boolean {
  if (increase.previousComplexity === undefined || increase.currentComplexity === undefined) {
    return false;
  }
  let complexity = increase.previousComplexity;
  let endpointCount: number | undefined;
  for (const regression of regressions) {
    if (
      regression.reason === "increased-complexity" &&
      regression.baselineComplexity !== undefined &&
      regression.currentComplexity !== undefined &&
      regression.baselineComplexity === complexity &&
      regression.currentComplexity > regression.baselineComplexity
    ) {
      complexity = regression.currentComplexity;
      endpointCount = regression.currentCount;
    }
  }
  return complexity === increase.currentComplexity && endpointCount === increase.currentCount;
}

export function hasAccountingEntry(
  increase: BaselineDebtIncrease,
  entries: readonly LintRatchetDebtLogEntry[],
): boolean {
  const regressions = matchingRegressions(increase, entries);
  if (increase.kind === "lines") return lineChainAccountsForIncrease(increase, regressions);
  if (increase.kind === "complexity") {
    return complexityChainAccountsForIncrease(increase, regressions);
  }
  return countChainAccountsForIncrease(increase, regressions);
}
