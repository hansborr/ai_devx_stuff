import {
  type ItemMergeOutcome,
  type ItemMergePolicy,
  mergeItemMaps,
} from "../lib/baseline/item-merge.js";
import { compareByCodepoint } from "../lib/codepoint-compare.js";
import type { LintRatchetBaseline } from "./baseline.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import { formatLintRatchetBaseline, type LintRatchetBaselineTest } from "./baseline-format.js";
import { sameCanonicalValue } from "./baseline-merge-values.js";
import { parseLintRatchetBaselineStructure } from "./baseline-validation.js";
import type { LintRatchetMetric } from "./lint-ratchet-config.js";
import { metricStrategy } from "./metric-strategies.js";
import { validateMetricItem } from "./metrics.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

export interface MergeLintRatchetBaselinesOptions {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
}

export interface MergeLintRatchetBaselinesResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

interface PostMergeTruthUpState {
  required: boolean;
}

interface MergeItemContext {
  readonly testId: string;
  readonly metric: LintRatchetMetric;
  readonly failures: string[];
  readonly postMergeTruthUp: PostMergeTruthUpState;
  readonly baseItems: Readonly<Record<string, LintRatchetMetricItem>>;
}

interface MergeTestContext {
  readonly testId: string;
  readonly failures: string[];
  readonly postMergeTruthUp: PostMergeTruthUpState;
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

function baselineTestMetadata(test: LintRatchetBaselineTest): Readonly<Record<string, unknown>> {
  return {
    ruleId: test.ruleId,
    mode: test.mode,
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
  return sameCanonicalValue(baselineTestMetadata(left), baselineTestMetadata(right));
}

function lowerCountItem(
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): LintRatchetMetricItem | undefined {
  if (left.count < right.count) return left;
  if (right.count < left.count) return right;
  return undefined;
}

// A shared item resolves to the lower count (the stricter floor); an equal-count
// tie defers to the metric's semantic-minimum on its non-count axis, owned by
// the strategy so a new metric registers rather than adding a branch here.
function mergeMetricItem(
  metric: LintRatchetMetric,
  path: string,
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): ItemMergeOutcome<LintRatchetMetricItem> {
  const lower = lowerCountItem(left, right);
  if (lower !== undefined) return { item: lower, truthUp: true };
  const result = metricStrategy(metric).meetSameCountItem(path, left, right);
  if (result.failure !== undefined) return { failure: result.failure };
  return { item: result.item, truthUp: result.postMergeTruthUpRequired };
}

// The ratchet's nested `tests -> items` document reuses the shared union-key
// item-merge core: a shared path takes the metric meet, and a one-sided path is
// kept only when the base never carried it (a genuine addition), otherwise it is
// a drain that flags a truth-up.
function ratchetItemPolicy(
  testId: string,
  metric: LintRatchetMetric,
): ItemMergePolicy<LintRatchetMetricItem> {
  return {
    count: (item) => item.count,
    mergeShared: (path, current, other) =>
      mergeMetricItem(metric, `${testId}.items.${path}`, current, other),
    mergeOneSided: (_path, present, base) =>
      base === undefined ? { item: present } : { truthUp: true },
  };
}

function mergeItems(
  context: MergeItemContext,
  currentItems: Readonly<Record<string, LintRatchetMetricItem>>,
  otherItems: Readonly<Record<string, LintRatchetMetricItem>>,
): Readonly<Record<string, LintRatchetMetricItem>> {
  const result = mergeItemMaps(ratchetItemPolicy(context.testId, context.metric), {
    base: new Map(Object.entries(context.baseItems)),
    current: new Map(Object.entries(currentItems)),
    other: new Map(Object.entries(otherItems)),
    compareKeys: compareByCodepoint,
  });
  context.failures.push(...result.failures);
  if (result.truthUpRequired) context.postMergeTruthUp.required = true;
  const merged: Record<string, LintRatchetMetricItem> = {};
  for (const { key, item } of result.merged) merged[key] = item;
  return merged;
}

function mergeChangedTests(
  context: MergeTestContext,
  base: LintRatchetBaselineTest | undefined,
  current: LintRatchetBaselineTest,
  other: LintRatchetBaselineTest,
): LintRatchetBaselineTest | undefined {
  if (!sameBaselineTestMetadata(current, other)) {
    context.failures.push(
      `${context.testId}: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts`,
    );
    return undefined;
  }
  return {
    ...current,
    items: mergeItems(
      {
        testId: context.testId,
        metric: current.metric,
        failures: context.failures,
        postMergeTruthUp: context.postMergeTruthUp,
        baseItems: base?.items ?? {},
      },
      current.items,
      other.items,
    ),
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
  if (current !== undefined && sameCanonicalValue(current, base)) return resolvedTest(other);
  if (other !== undefined && sameCanonicalValue(other, base)) return resolvedTest(current);
  return unresolvedTest();
}

function chooseSimpleTestMerge(versions: MergeTestVersions): TestDecision {
  const { base, current, other } = versions;
  if (current === undefined && other === undefined) return resolvedTest(undefined);
  if (current !== undefined && other !== undefined && sameCanonicalValue(current, other))
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

  return mergeChangedTests(context, versions.base, versions.current, versions.other);
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
    return { failures: parseFailures, postMergeTruthUpRequired: false };
  }

  const failures: string[] = [];
  const postMergeTruthUp: PostMergeTruthUpState = { required: false };
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const testId of sortedBaselineTestIds(base, current, other)) {
    const mergedTest = mergeTest(
      { testId, failures, postMergeTruthUp },
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
  if (failures.length > 0) return { failures, postMergeTruthUpRequired: false };
  return {
    mergedText: formatLintRatchetBaseline(mergedBaseline),
    failures: [],
    postMergeTruthUpRequired: postMergeTruthUp.required,
  };
}
