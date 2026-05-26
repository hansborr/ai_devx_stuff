import type {
  LintRatchetBaseline,
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetRuleSourceHashesById,
} from "../lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { type LintRatchetMetricItem, metricItemForFormat } from "../lint-ratchet-metrics.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import {
  computeLintRatchetConfigHash,
  normalizeRuleOptions,
  normalizeStringList,
} from "./baseline-hash.js";

type LintRatchetBaselineItem = LintRatchetMetricItem;
export type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

function positiveMetricItems(
  metric: LintRatchetConfig["metric"],
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
): Readonly<Record<string, LintRatchetBaselineItem>> {
  const items: Record<string, LintRatchetBaselineItem> = {};
  const sortedItems = [...(currentItems?.entries() ?? [])].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [path, item] of sortedItems) {
    if (item.count > 0) items[path] = metricItemForFormat(metric, item);
  }
  return items;
}

export function baselineTestFromConfig(
  config: LintRatchetConfig,
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
  ruleSourceHash: string,
): LintRatchetBaselineTest {
  return {
    ruleId: config.ruleId,
    mode: config.mode,
    target: config.target,
    metric: config.metric,
    files: normalizeStringList(config.files),
    ignores: normalizeStringList(config.ignores),
    ruleOptions: normalizeRuleOptions(config.ruleOptions),
    configHash: computeLintRatchetConfigHash(config),
    ruleSourceHash,
    items: positiveMetricItems(config.metric, currentItems),
  };
}

function requireRuleSourceHash(
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  ratchetId: string,
): string {
  const hash = ruleSourceHashesById.get(ratchetId);
  if (hash === undefined) {
    throw new Error(`lint-ratchet: missing rule source hash for ${ratchetId}`);
  }
  return hash;
}

export function buildLintRatchetBaseline(
  ratchets: readonly LintRatchetConfig[],
  currentById: LintRatchetCurrentById,
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): LintRatchetBaseline {
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const ratchet of ratchets) {
    tests[ratchet.id] = baselineTestFromConfig(
      ratchet,
      currentById.get(ratchet.id),
      requireRuleSourceHash(ruleSourceHashesById, ratchet.id),
    );
  }
  return { version: LINT_RATCHET_BASELINE_VERSION, tests };
}

export function currentByIdFromBaseline(baseline: LintRatchetBaseline): LintRatchetCurrentById {
  const currentById = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [testId, test] of Object.entries(baseline.tests)) {
    const items = new Map<string, LintRatchetCurrentItem>();
    for (const [path, item] of Object.entries(test.items)) items.set(path, item);
    currentById.set(testId, items);
  }
  return currentById;
}

function orderedBaselineForFormat(baseline: LintRatchetBaseline): LintRatchetBaseline {
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const testId of Object.keys(baseline.tests).sort()) {
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    tests[testId] = {
      ruleId: test.ruleId,
      mode: test.mode,
      target: test.target,
      metric: test.metric,
      files: normalizeStringList(test.files),
      ignores: normalizeStringList(test.ignores),
      ruleOptions: normalizeRuleOptions(test.ruleOptions),
      configHash: test.configHash,
      ruleSourceHash: test.ruleSourceHash,
      items: positiveMetricItems(test.metric, new Map(Object.entries(test.items))),
    };
  }
  return { version: LINT_RATCHET_BASELINE_VERSION, tests };
}

export function formatLintRatchetBaseline(baseline: LintRatchetBaseline): string {
  return `${JSON.stringify(orderedBaselineForFormat(baseline), null, 2)}\n`;
}
