import { type LintRatchetDebtLogEntry, parseLintRatchetDebtLogEntry } from "./debt-log-schema.js";
import {
  type LintRatchetBaseline,
  parseLintRatchetBaselineStructure,
} from "./lint-ratchet-baseline.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import { BASELINE_FILENAME, DEBT_LOG_FILENAME } from "./paths.js";

type BaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;
type BaselineItem = NonNullable<BaselineTest["items"][string]>;

export type BaselineDebtIncreaseKind = "new-path" | "count" | "lines" | "complexity";

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
  readonly failures: readonly BaselineDebtIncrease[];
}

export interface BaselineDebtAccountingOptions {
  readonly baseBaselineText: string;
  readonly currentBaselineText: string;
  readonly baseDebtLogText: string;
  readonly currentDebtLogText: string;
}

interface ParsedDebtLogLine {
  readonly line: string;
  readonly entry: LintRatchetDebtLogEntry;
}

interface ItemIncreaseContext {
  readonly testId: string;
  readonly test: BaselineTest;
  readonly path: string;
  readonly baseItem: BaselineItem;
  readonly currentItem: BaselineItem;
}

function parseBaseline(label: string, text: string): LintRatchetBaseline {
  const parsed = parseLintRatchetBaselineStructure(text);
  if (parsed.baseline === undefined) {
    throw new ConfigError(
      `${label} is not a valid lint-ratchet baseline:\n${parsed.failures.join("\n")}`,
    );
  }
  return parsed.baseline;
}

function debtLogLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/u);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseDebtLogLine(line: string, lineNumber: number, label: string): ParsedDebtLogLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new ConfigError(`${label} line ${String(lineNumber)} is not valid JSON: ${message}`);
  }
  const parsed = parseLintRatchetDebtLogEntry(value);
  if (parsed.entry === undefined) {
    throw new ConfigError(
      `${label} line ${String(lineNumber)} is invalid:\n${parsed.failures.join("\n")}`,
    );
  }
  return { line, entry: parsed.entry };
}

function parseDebtLog(text: string, label: string): readonly ParsedDebtLogLine[] {
  return debtLogLines(text).map((line, index) => parseDebtLogLine(line, index + 1, label));
}

function assertDebtLogAppendOnly(baseDebtLogText: string, currentDebtLogText: string): void {
  if (currentDebtLogText.startsWith(baseDebtLogText)) return;
  throw new ConfigError(
    `${DEBT_LOG_FILENAME} must be append-only: current content does not preserve the base file as an exact prefix. Restore historical lines and append new accepted-debt entries at the end.`,
  );
}

function addedDebtLogEntries(
  baseDebtLogText: string,
  currentDebtLogText: string,
): readonly LintRatchetDebtLogEntry[] {
  parseDebtLog(baseDebtLogText, `${DEBT_LOG_FILENAME} at base`);
  assertDebtLogAppendOnly(baseDebtLogText, currentDebtLogText);
  return parseDebtLog(
    currentDebtLogText.slice(baseDebtLogText.length),
    `${DEBT_LOG_FILENAME} appended entries`,
  ).map(({ entry }) => entry);
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
  return [countIncrease(context), lineIncrease(context), complexityIncrease(context)].filter(
    (increase): increase is BaselineDebtIncrease => increase !== undefined,
  );
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
    if (currentTest.configHash !== baseTest.configHash) continue;
    for (const path of Object.keys(currentTest.items).sort()) {
      const currentItem = currentTest.items[path];
      if (currentItem === undefined) continue;
      const baseItem = baseTest.items[path];
      if (baseItem === undefined) {
        increases.push(newPathIncrease(testId, currentTest, path, currentItem));
        continue;
      }
      increases.push(
        ...collectItemIncreases({ testId, test: currentTest, path, baseItem, currentItem }),
      );
    }
  }
  return increases;
}

function regressionAccountsForIncrease(
  regression: LintRatchetDebtLogEntry["regressions"][number],
  increase: BaselineDebtIncrease,
): boolean {
  if (regression.testId !== increase.testId || regression.path !== increase.path) return false;
  if (regression.currentCount < increase.currentCount) return false;
  if (increase.kind === "lines") {
    return (
      regression.currentLines !== undefined &&
      increase.currentLines !== undefined &&
      regression.currentLines >= increase.currentLines
    );
  }
  if (increase.kind === "complexity") {
    return (
      regression.currentComplexity !== undefined &&
      increase.currentComplexity !== undefined &&
      regression.currentComplexity >= increase.currentComplexity
    );
  }
  return true;
}

function hasAccountingEntry(
  increase: BaselineDebtIncrease,
  entries: readonly LintRatchetDebtLogEntry[],
): boolean {
  return entries.some((entry) =>
    entry.regressions.some((regression) => regressionAccountsForIncrease(regression, increase)),
  );
}

export function checkBaselineDebtAccounting(
  options: BaselineDebtAccountingOptions,
): BaselineDebtAccountingResult {
  const baseBaseline = parseBaseline(`${BASELINE_FILENAME} at base`, options.baseBaselineText);
  const currentBaseline = parseBaseline(BASELINE_FILENAME, options.currentBaselineText);
  const increases = collectBaselineIncreases(baseBaseline, currentBaseline);
  const addedEntries = addedDebtLogEntries(options.baseDebtLogText, options.currentDebtLogText);
  const failures = increases.filter((increase) => !hasAccountingEntry(increase, addedEntries));
  return { increases, failures };
}

function increaseDetail(increase: BaselineDebtIncrease): string {
  const prefix = `${increase.testId} ${increase.path}`;
  if (increase.kind === "new-path") {
    return `${prefix}: new path baseline is ${String(increase.currentCount)} finding(s)`;
  }
  if (increase.kind === "lines") {
    return (
      `${prefix}: effective lines increased from ` +
      `${String(increase.previousLines ?? 0)} to ${String(increase.currentLines ?? 0)}`
    );
  }
  if (increase.kind === "complexity") {
    return (
      `${prefix}: max complexity increased from ` +
      `${String(increase.previousComplexity ?? 0)} to ${String(increase.currentComplexity ?? 0)}`
    );
  }
  return (
    `${prefix}: finding count increased from ` +
    `${String(increase.previousCount)} to ${String(increase.currentCount)}`
  );
}

export function formatBaselineDebtAccountingFailures(
  failures: readonly BaselineDebtIncrease[],
): string {
  return (
    `${BASELINE_FILENAME} has ${String(failures.length)} unaccounted baseline increase(s): ` +
    `${failures.map(increaseDetail).join("; ")}; ` +
    `accept intentional debt with bun run lint:ratchet:update -- --allow-worse --reason "<why>", ` +
    `and commit the paired ${DEBT_LOG_FILENAME} line`
  );
}
