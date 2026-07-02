import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import { formatLintRatchetBaseline, type LintRatchetBaselineTest } from "./baseline-format.js";
import { parseLintRatchetBaselineStructure } from "./baseline-validation.js";
import type { LintRatchetBaseline } from "./lint-ratchet-baseline.js";
import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { metricItemForFormat, validateMetricItem } from "./lint-ratchet-metrics.js";
import type { LintRatchetMetricItem } from "./lint-ratchet-metrics-types.js";

export interface MergeLintRatchetBaselinesOptions {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
}

export interface MergeLintRatchetBaselinesResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
}

interface MergeItemContext {
  readonly testId: string;
  readonly metric: LintRatchetMetric;
  readonly failures: string[];
}

interface MergeTestContext {
  readonly testId: string;
  readonly failures: string[];
}

interface MergeTestVersions {
  readonly base: LintRatchetBaselineTest | undefined;
  readonly current: LintRatchetBaselineTest | undefined;
  readonly other: LintRatchetBaselineTest | undefined;
}

interface TestDecision {
  readonly resolved: boolean;
  readonly test: LintRatchetBaselineTest | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) normalized[key] = canonicalValue(value[key]);
  return normalized;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function baselineTestMetadata(test: LintRatchetBaselineTest): Readonly<Record<string, unknown>> {
  return {
    ruleId: test.ruleId,
    mode: test.mode,
    target: test.target,
    metric: test.metric,
    files: test.files,
    ignores: test.ignores,
    ruleOptions: test.ruleOptions,
    configHash: test.configHash,
    ruleSourceHash: test.ruleSourceHash,
  };
}

function sameBaselineTestMetadata(
  left: LintRatchetBaselineTest,
  right: LintRatchetBaselineTest,
): boolean {
  return sameValue(baselineTestMetadata(left), baselineTestMetadata(right));
}

function lowerCountItem(
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): LintRatchetMetricItem | undefined {
  if (left.count < right.count) return left;
  if (right.count < left.count) return right;
  return undefined;
}

function mergeEffectiveLineCountItem(
  path: string,
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
  failures: string[],
): LintRatchetMetricItem | undefined {
  if (left.lines === undefined || right.lines === undefined) {
    failures.push(`${path}: effective-line-count items need lines on both sides`);
    return undefined;
  }
  return { count: left.count, lines: Math.min(left.lines, right.lines) };
}

function mergeComplexitySeverityItem(
  path: string,
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
  failures: string[],
): LintRatchetMetricItem | undefined {
  const lower = lowerCountItem(left, right);
  if (lower !== undefined) return lower;

  const formattedLeft = metricItemForFormat("complexity-severity", left);
  const formattedRight = metricItemForFormat("complexity-severity", right);
  if (sameValue(formattedLeft, formattedRight)) return formattedLeft;

  failures.push(`${path}: equal-count complexity-severity payloads differ`);
  return undefined;
}

function mergeSameCountItem(
  context: MergeItemContext,
  path: string,
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): LintRatchetMetricItem | undefined {
  if (context.metric === "effective-line-count") {
    return mergeEffectiveLineCountItem(path, left, right, context.failures);
  }
  if (context.metric === "complexity-severity") {
    return mergeComplexitySeverityItem(path, left, right, context.failures);
  }
  return { count: left.count };
}

function mergeMetricItem(
  context: MergeItemContext,
  path: string,
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): LintRatchetMetricItem | undefined {
  const lower = lowerCountItem(left, right);
  if (lower !== undefined) return lower;
  return mergeSameCountItem(context, path, left, right);
}

function sortedUnionKeys(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): readonly string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function mergeItems(
  context: MergeItemContext,
  currentItems: Readonly<Record<string, LintRatchetMetricItem>>,
  otherItems: Readonly<Record<string, LintRatchetMetricItem>>,
): Readonly<Record<string, LintRatchetMetricItem>> {
  const merged: Record<string, LintRatchetMetricItem> = {};
  for (const path of sortedUnionKeys(currentItems, otherItems)) {
    const currentItem = currentItems[path];
    const otherItem = otherItems[path];
    if (currentItem === undefined || otherItem === undefined) continue;
    const mergedItem = mergeMetricItem(
      context,
      `${context.testId}.items.${path}`,
      currentItem,
      otherItem,
    );
    if (mergedItem !== undefined && mergedItem.count > 0) merged[path] = mergedItem;
  }
  return merged;
}

function mergeChangedTests(
  testId: string,
  current: LintRatchetBaselineTest,
  other: LintRatchetBaselineTest,
  failures: string[],
): LintRatchetBaselineTest | undefined {
  if (!sameBaselineTestMetadata(current, other)) {
    failures.push(
      `${testId}: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts`,
    );
    return undefined;
  }
  return {
    ...current,
    items: mergeItems({ testId, metric: current.metric, failures }, current.items, other.items),
  };
}

function resolvedTest(test: LintRatchetBaselineTest | undefined): TestDecision {
  return { resolved: true, test };
}

function unresolvedTest(): TestDecision {
  return { resolved: false, test: undefined };
}

function chooseWithoutBase(
  current: LintRatchetBaselineTest | undefined,
  other: LintRatchetBaselineTest | undefined,
): TestDecision {
  if (current === undefined) return resolvedTest(other);
  if (other === undefined) return resolvedTest(current);
  return unresolvedTest();
}

function chooseAgainstBase(
  base: LintRatchetBaselineTest | undefined,
  current: LintRatchetBaselineTest | undefined,
  other: LintRatchetBaselineTest | undefined,
): TestDecision {
  if (base === undefined) return chooseWithoutBase(current, other);
  if (current !== undefined && sameValue(current, base)) return resolvedTest(other);
  if (other !== undefined && sameValue(other, base)) return resolvedTest(current);
  return unresolvedTest();
}

function chooseSimpleTestMerge(versions: MergeTestVersions): TestDecision {
  const { base, current, other } = versions;
  if (current === undefined && other === undefined) return resolvedTest(undefined);
  if (current !== undefined && other !== undefined && sameValue(current, other))
    return resolvedTest(current);
  return chooseAgainstBase(base, current, other);
}

function mergeTest(
  context: MergeTestContext,
  versions: MergeTestVersions,
): LintRatchetBaselineTest | undefined {
  const simple = chooseSimpleTestMerge(versions);
  if (simple.resolved) return simple.test;

  if (versions.current === undefined || versions.other === undefined) {
    context.failures.push(
      `${context.testId}: one side removed the ratchet while the other changed it; regenerate the baseline after resolving other conflicts`,
    );
    return undefined;
  }

  return mergeChangedTests(context.testId, versions.current, versions.other, context.failures);
}

function validateMergedBaseline(baseline: LintRatchetBaseline): readonly string[] {
  const failures: string[] = [];
  for (const [testId, test] of Object.entries(baseline.tests)) {
    if (test.ruleSourceHash === "") failures.push(`${testId}.ruleSourceHash is required`);
    for (const [path, item] of Object.entries(test.items)) {
      validateMetricItem(`${testId}.items.${path}`, test.metric, item, failures);
    }
  }
  return failures;
}

function parseBaseline(
  label: string,
  text: string,
  failures: string[],
): LintRatchetBaseline | undefined {
  if (label === "base" && text.trim() === "") {
    return { version: LINT_RATCHET_BASELINE_VERSION, tests: {} };
  }
  const result = parseLintRatchetBaselineStructure(text);
  if (result.baseline !== undefined) return result.baseline;
  failures.push(...result.failures.map((failure) => `${label} ${failure}`));
  return undefined;
}

function sortedBaselineTestIds(
  base: LintRatchetBaseline,
  current: LintRatchetBaseline,
  other: LintRatchetBaseline,
): readonly string[] {
  const keys = new Set([
    ...Object.keys(base.tests),
    ...Object.keys(current.tests),
    ...Object.keys(other.tests),
  ]);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export function mergeLintRatchetBaselines(
  options: MergeLintRatchetBaselinesOptions,
): MergeLintRatchetBaselinesResult {
  const parseFailures: string[] = [];
  const base = parseBaseline("base", options.baseText, parseFailures);
  const current = parseBaseline("current", options.currentText, parseFailures);
  const other = parseBaseline("other", options.otherText, parseFailures);
  if (base === undefined || current === undefined || other === undefined) {
    return { failures: parseFailures };
  }

  const failures: string[] = [];
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const testId of sortedBaselineTestIds(base, current, other)) {
    const mergedTest = mergeTest(
      { testId, failures },
      {
        base: base.tests[testId],
        current: current.tests[testId],
        other: other.tests[testId],
      },
    );
    if (mergedTest !== undefined) tests[testId] = mergedTest;
  }

  const mergedBaseline: LintRatchetBaseline = { version: current.version, tests };
  failures.push(...validateMergedBaseline(mergedBaseline));
  if (failures.length > 0) return { failures };
  return { mergedText: formatLintRatchetBaseline(mergedBaseline), failures: [] };
}
