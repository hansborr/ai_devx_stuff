import type {
  LintRatchetBaseline,
  LintRatchetCurrentById,
  LintRatchetCurrentItem,
  LintRatchetRuleSourceHashesById,
} from "./baseline.js";
import {
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  lintRatchetBaselineRegenerateForVersion,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import {
  computeLintRatchetConfigHash,
  normalizeRuleOptions,
  normalizeStringList,
} from "./baseline-hash.js";
import { lintRatchetBaselineSpec, lintRatchetBaselineToGrouped } from "./baseline-spec.js";
import { compareByCodepoint } from "./codepoint-compare.js";
import type { LintRatchetConfig } from "./config-types.js";
import { formatGroupedBaseline } from "./group-baseline.js";
import { type LintRatchetMetricItem, metricItemForFormat } from "./metrics.js";

type LintRatchetBaselineItem = LintRatchetMetricItem;
export type LintRatchetBaselineTest = NonNullable<LintRatchetBaseline["tests"][string]>;

function positiveMetricItems(
  metric: LintRatchetConfig["metric"],
  currentItems: ReadonlyMap<string, LintRatchetCurrentItem> | undefined,
): Readonly<Record<string, LintRatchetBaselineItem>> {
  const items: Record<string, LintRatchetBaselineItem> = {};
  const sortedItems = [...(currentItems?.entries() ?? [])].sort(([left], [right]) =>
    compareByCodepoint(left, right),
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
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
): LintRatchetBaseline {
  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const ratchet of ratchets) {
    tests[ratchet.id] = baselineTestFromConfig(
      ratchet,
      currentById.get(ratchet.id),
      requireRuleSourceHash(ruleSourceHashesById, ratchet.id),
    );
  }
  const regenerate = lintRatchetBaselineRegenerateForVersion(versionPolicy.writeVersion);
  return {
    version: versionPolicy.writeVersion,
    ...(regenerate === undefined ? {} : { regenerate }),
    tests,
  };
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

export function formatLintRatchetBaseline(baseline: LintRatchetBaseline): string {
  return formatGroupedBaseline(lintRatchetBaselineSpec(), lintRatchetBaselineToGrouped(baseline));
}
