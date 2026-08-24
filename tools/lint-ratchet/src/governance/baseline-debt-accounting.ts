import { type LintRatchetBaseline, parseLintRatchetBaselineStructure } from "../kernel/baseline.js";
import {
  DEFAULT_BASELINE_FILENAME,
  DEFAULT_DEBT_LOG_FILENAME,
  type LintRatchetWorkflowVocabulary,
} from "../kernel/engine-context.js";
import { ConfigError } from "../kernel/metrics-types.js";
import { hasAccountingEntry } from "./baseline-debt-accounting-chains.js";
import {
  collectUnaccountedLifecycleChanges,
  type LifecycleAccountingFailure,
} from "./baseline-debt-accounting-lifecycle.js";
import { parseDebtLogJsonl } from "./debt-log-jsonl.js";
import type { LintRatchetDebtLogEntry } from "./debt-log-schema.js";

export { formatBaselineDebtAccountingFailures } from "./baseline-debt-accounting-format.js";

type BaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type BaselineItem = NonNullable<BaselineTest["items"][string]>;

type BaselineDebtIncreaseKind = "new-path" | "count" | "lines" | "complexity";

export interface BaselineDebtIncrease {
  readonly testId: string;
  readonly ruleId: string;
  readonly path: string;
  readonly kind: BaselineDebtIncreaseKind;
  readonly previousCount: number;
  readonly currentCount: number;
  readonly previousLines?: number;
  readonly currentLines?: number;
  readonly previousComplexity?: number;
  readonly currentComplexity?: number;
}

export interface BaselineDebtAccountingResult {
  readonly increases: readonly BaselineDebtIncrease[];
  readonly failures: readonly BaselineDebtAccountingFailure[];
}

export type BaselineDebtAccountingFailure = BaselineDebtIncrease | LifecycleAccountingFailure;

export interface BaselineDebtAccountingOptions {
  readonly baseBaselineText: string;
  readonly currentBaselineText: string;
  readonly baseDebtLogText: string;
  readonly currentDebtLogText: string;
  // Repo-relative display names for the diagnostic labels; default to the engine
  // conventions so Musi output is unchanged while an adapter with custom
  // baseline/debt-log paths surfaces its own names.
  readonly baselineDisplayName?: string;
  readonly debtLogDisplayName?: string;
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
}

interface ItemIncreaseContext {
  readonly testId: string;
  readonly test: BaselineTest;
  readonly path: string;
  readonly baseItem: BaselineItem;
  readonly currentItem: BaselineItem;
}

function parseBaseline(
  label: string,
  text: string,
  options: Pick<BaselineDebtAccountingOptions, "baselineDisplayName" | "workflowVocabulary">,
): LintRatchetBaseline {
  const parsed = parseLintRatchetBaselineStructure(
    text,
    options.workflowVocabulary,
    undefined,
    options.baselineDisplayName,
  );
  if (parsed.baseline === undefined) {
    throw new ConfigError(
      `${label} is not a valid lint-ratchet baseline:\n${parsed.failures.join("\n")}`,
    );
  }
  return parsed.baseline;
}

function assertDebtLogAppendOnly(
  baseDebtLogText: string,
  currentDebtLogText: string,
  debtLogName: string,
): void {
  if (currentDebtLogText.startsWith(baseDebtLogText)) return;
  throw new ConfigError(
    `${debtLogName} must be append-only: current content does not preserve the base file as an exact prefix. Restore historical lines and append new accepted-debt entries at the end.`,
  );
}

function addedDebtLogEntries(
  baseDebtLogText: string,
  currentDebtLogText: string,
  debtLogName: string,
): readonly LintRatchetDebtLogEntry[] {
  parseDebtLogJsonl(baseDebtLogText, `${debtLogName} at base`);
  assertDebtLogAppendOnly(baseDebtLogText, currentDebtLogText, debtLogName);
  let appendedText = currentDebtLogText.slice(baseDebtLogText.length);
  // When the base file lacked a trailing newline, the appender inserts the
  // missing separator before the new entry. That separator terminates the
  // base's last line — it is not part of the appended entries, and leaving it
  // would surface as an empty first "entry" that fails JSON parsing.
  if (baseDebtLogText.length > 0 && !baseDebtLogText.endsWith("\n")) {
    appendedText = appendedText.replace(/^\r?\n/u, "");
  }
  return parseDebtLogJsonl(appendedText, `${debtLogName} appended entries`);
}

function countIncrease(context: ItemIncreaseContext): BaselineDebtIncrease | undefined {
  if (context.currentItem.count <= context.baseItem.count) return undefined;
  return {
    testId: context.testId,
    ruleId: context.test.ruleId,
    path: context.path,
    kind: "count",
    previousCount: context.baseItem.count,
    currentCount: context.currentItem.count,
  };
}

function lineIncrease(context: ItemIncreaseContext): BaselineDebtIncrease | undefined {
  if (context.currentItem.lines === undefined) return undefined;
  if (context.baseItem.lines !== undefined && context.currentItem.lines <= context.baseItem.lines) {
    return undefined;
  }
  return {
    testId: context.testId,
    ruleId: context.test.ruleId,
    path: context.path,
    kind: "lines",
    previousCount: context.baseItem.count,
    currentCount: context.currentItem.count,
    ...(context.baseItem.lines === undefined ? {} : { previousLines: context.baseItem.lines }),
    currentLines: context.currentItem.lines,
  };
}

function complexityIncrease(context: ItemIncreaseContext): BaselineDebtIncrease | undefined {
  if (context.currentItem.maxComplexity === undefined) return undefined;
  if (
    context.baseItem.maxComplexity !== undefined &&
    context.currentItem.maxComplexity <= context.baseItem.maxComplexity
  ) {
    return undefined;
  }
  return {
    testId: context.testId,
    ruleId: context.test.ruleId,
    path: context.path,
    kind: "complexity",
    previousCount: context.baseItem.count,
    currentCount: context.currentItem.count,
    ...(context.baseItem.maxComplexity === undefined
      ? {}
      : { previousComplexity: context.baseItem.maxComplexity }),
    currentComplexity: context.currentItem.maxComplexity,
  };
}

function newPathIncrease(
  testId: string,
  test: BaselineTest,
  path: string,
  currentItem: BaselineItem,
): BaselineDebtIncrease {
  return {
    testId,
    ruleId: test.ruleId,
    path,
    kind: "new-path",
    previousCount: 0,
    currentCount: currentItem.count,
  };
}

function collectItemIncreases(context: ItemIncreaseContext): readonly BaselineDebtIncrease[] {
  const lines = lineIncrease(context);
  if (lines !== undefined) return [lines];
  const complexity = complexityIncrease(context);
  if (complexity !== undefined) return [complexity];
  const count = countIncrease(context);
  return count === undefined ? [] : [count];
}

// When the metric changed, the ESLint finding `count` is still comparable
// (every metric carries it), so a new path or a count increase is real debt even
// then; only the line/complexity deltas are incomparable across a migration. A
// metric change without an accompanying count increase yields nothing here and
// is accounted solely by the metric-migration lifecycle record.
function collectItemIncreasesForMetric(
  context: ItemIncreaseContext,
  metricsMatch: boolean,
): readonly BaselineDebtIncrease[] {
  if (metricsMatch) return collectItemIncreases(context);
  const count = countIncrease(context);
  return count === undefined ? [] : [count];
}

function collectBaselineIncreases(
  baseBaseline: LintRatchetBaseline,
  currentBaseline: LintRatchetBaseline,
): readonly BaselineDebtIncrease[] {
  const increases: BaselineDebtIncrease[] = [];
  for (const testId of Object.keys(currentBaseline.tests).sort()) {
    const currentTest = currentBaseline.tests[testId];
    const baseTest = baseBaseline.tests[testId];
    if (currentTest === undefined || baseTest === undefined) continue;
    const metricsMatch = currentTest.metric === baseTest.metric;
    for (const path of Object.keys(currentTest.items).sort()) {
      const currentItem = currentTest.items[path];
      if (currentItem === undefined) continue;
      const baseItem = baseTest.items[path];
      if (baseItem === undefined) {
        increases.push(newPathIncrease(testId, currentTest, path, currentItem));
        continue;
      }
      increases.push(
        ...collectItemIncreasesForMetric(
          { testId, test: currentTest, path, baseItem, currentItem },
          metricsMatch,
        ),
      );
    }
  }
  return increases;
}

export function checkBaselineDebtAccounting(
  options: BaselineDebtAccountingOptions,
): BaselineDebtAccountingResult {
  const baselineName = options.baselineDisplayName ?? DEFAULT_BASELINE_FILENAME;
  const debtLogName = options.debtLogDisplayName ?? DEFAULT_DEBT_LOG_FILENAME;
  const baseBaseline = parseBaseline(`${baselineName} at base`, options.baseBaselineText, options);
  const currentBaseline = parseBaseline(baselineName, options.currentBaselineText, options);
  const increases = collectBaselineIncreases(baseBaseline, currentBaseline);
  const addedEntries = addedDebtLogEntries(
    options.baseDebtLogText,
    options.currentDebtLogText,
    debtLogName,
  );
  const failures: BaselineDebtAccountingFailure[] = [
    ...increases.filter((increase) => !hasAccountingEntry(increase, addedEntries)),
    ...collectUnaccountedLifecycleChanges(baseBaseline, currentBaseline, addedEntries),
  ];
  return { increases, failures };
}
