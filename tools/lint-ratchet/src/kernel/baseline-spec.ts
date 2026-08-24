import type { LintRatchetBaseline, LintRatchetBaselineTest } from "./baseline.js";
import {
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  lintRatchetBaselineRegenerateForVersion,
  type LintRatchetBaselineVersion,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import { normalizeRuleOptions, normalizeStringList } from "./baseline-hash.js";
import { parseLintRatchetBaselineItem } from "./baseline-item-parse.js";
import { sameCanonicalValue } from "./baseline-merge-values.js";
import {
  type LintRatchetBaselineGroupMeta,
  parseLintRatchetGroupMeta,
  relativeLintRatchetItemFailure,
} from "./baseline-spec-parse.js";
import { compareByCodepoint } from "./codepoint-compare.js";
import { DEFAULT_BASELINE_FILENAME, type LintRatchetWorkflowVocabulary } from "./engine-context.js";
import type {
  GroupedBaseline,
  GroupedBaselineSpec,
  GroupedItemMergePolicy,
} from "./group-baseline.js";
import type { ItemMergeOutcome } from "./item-merge.js";
import { metricStrategy } from "./metric-strategies.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

export type { LintRatchetBaselineGroupMeta } from "./baseline-spec-parse.js";

function lowerCountItem(
  left: LintRatchetMetricItem,
  right: LintRatchetMetricItem,
): LintRatchetMetricItem | undefined {
  if (left.count < right.count) return left;
  if (right.count < left.count) return right;
  return undefined;
}

function mergeSharedItem(
  context: {
    readonly meta: LintRatchetBaselineGroupMeta;
    readonly testId: string;
  },
  path: string,
  current: LintRatchetMetricItem,
  other: LintRatchetMetricItem,
): ItemMergeOutcome<LintRatchetMetricItem> {
  const lower = lowerCountItem(current, other);
  if (lower !== undefined) return { item: lower, truthUp: true };
  const result = metricStrategy(context.meta.metric).meetSameCountItem(
    `${context.testId}.items.${path}`,
    current,
    other,
  );
  if (result.failure !== undefined) return { failure: result.failure };
  return { item: result.item, truthUp: result.postMergeTruthUpRequired };
}

function itemMergePolicy(
  testId: string,
  meta: LintRatchetBaselineGroupMeta,
): GroupedItemMergePolicy<LintRatchetMetricItem> {
  return {
    mergeShared: (path, current, other) => mergeSharedItem({ meta, testId }, path, current, other),
    mergeOneSided: (_path, present, base) =>
      base === undefined ? { item: present } : { truthUp: true },
  };
}

function parseItem(
  testId: string,
  path: string | undefined,
  raw: unknown,
):
  | {
      readonly ok: true;
      readonly value: { readonly key: string; readonly item: LintRatchetMetricItem };
    }
  | { readonly ok: false; readonly error: string; readonly errors: readonly string[] } {
  if (path === undefined) {
    const error = `${testId}.items path is required`;
    return { ok: false, error, errors: [error] };
  }
  const failures: string[] = [];
  const location = `${testId}.items.${path}`;
  const item = parseLintRatchetBaselineItem(path, raw, location, failures);
  if (item !== undefined && failures.length === 0) return { ok: true, value: { key: path, item } };
  const errors = (failures.length > 0 ? failures : ["item is invalid"]).map((failure) =>
    relativeLintRatchetItemFailure(location, failure),
  );
  return { ok: false, error: errors[0] ?? "item is invalid", errors };
}

function formatGroupMeta(meta: LintRatchetBaselineGroupMeta): Readonly<Record<string, unknown>> {
  return {
    ruleId: meta.ruleId,
    mode: meta.mode,
    metric: meta.metric,
    files: normalizeStringList(meta.files),
    ignores: normalizeStringList(meta.ignores),
    ruleOptions: normalizeRuleOptions(meta.ruleOptions),
    configHash: meta.configHash,
    ruleSourceHash: meta.ruleSourceHash,
  };
}

export function lintRatchetBaselineSpec(
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
  baselineFile: string = DEFAULT_BASELINE_FILENAME,
): GroupedBaselineSpec<LintRatchetBaselineGroupMeta, LintRatchetMetricItem> {
  return {
    writeVersion: versionPolicy.writeVersion,
    acceptedReadVersions: versionPolicy.acceptedVersions,
    rootKey: "tests",
    regenerate: lintRatchetBaselineRegenerateForVersion(
      versionPolicy.writeVersion,
      workflowVocabulary.updateCommand,
    ),
    preserveRegenerateOnFormat: true,
    conflictMarkerRemediation: {
      baselineFile,
      installerCommand: workflowVocabulary.installMergeDriverCommand,
      restoreOursCommand: workflowVocabulary.restoreBaselineOursCommand(baselineFile),
      updateCommand: workflowVocabulary.updateCommand,
    },
    requireSortedKeysOnParse: false,
    compareGroupKeys: compareByCodepoint,
    compareItemKeys: compareByCodepoint,
    parseGroupMeta: (testId, raw) => parseLintRatchetGroupMeta(testId, raw),
    formatGroupMeta: (_testId, meta) => formatGroupMeta(meta),
    sameGroupMeta: (left, right) => sameCanonicalValue(left, right),
    parseItem,
    formatItem: (_testId, _path, item, meta) => metricStrategy(meta.metric).formatItem(item),
    itemCount: (item) => item.count,
    itemMergePolicy,
  };
}

function positiveItemMap(
  items: Readonly<Record<string, LintRatchetMetricItem>>,
): ReadonlyMap<string, LintRatchetMetricItem> {
  return new Map(Object.entries(items).filter(([, item]) => item.count > 0));
}

export function lintRatchetBaselineToGrouped(
  baseline: LintRatchetBaseline,
): GroupedBaseline<LintRatchetBaselineGroupMeta, LintRatchetMetricItem> {
  const groups = new Map<
    string,
    {
      readonly meta: LintRatchetBaselineGroupMeta;
      readonly items: ReadonlyMap<string, LintRatchetMetricItem>;
    }
  >();
  for (const testId of Object.keys(baseline.tests)) {
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    groups.set(testId, {
      meta: {
        ruleId: test.ruleId,
        mode: test.mode,
        metric: test.metric,
        files: test.files,
        ignores: test.ignores,
        ruleOptions: test.ruleOptions,
        configHash: test.configHash,
        ruleSourceHash: test.ruleSourceHash,
      },
      items: positiveItemMap(test.items),
    });
  }
  return {
    version: baseline.version,
    ...(baseline.regenerate === undefined ? {} : { regenerate: baseline.regenerate }),
    groups,
  };
}

function acceptedVersion(
  version: number,
  versionPolicy: LintRatchetBaselineVersionPolicy,
): version is LintRatchetBaselineVersion {
  return versionPolicy.acceptedVersions.some((accepted) => accepted === version);
}

function baselineTestFromGroup(
  meta: LintRatchetBaselineGroupMeta,
  items: ReadonlyMap<string, LintRatchetMetricItem>,
): LintRatchetBaselineTest {
  return {
    ...meta,
    items: Object.fromEntries([...items.entries()].filter(([, item]) => item.count > 0)),
  };
}

export function lintRatchetBaselineFromGrouped(
  baseline: GroupedBaseline<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>,
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
): LintRatchetBaseline {
  if (!acceptedVersion(baseline.version, versionPolicy)) {
    throw new Error(
      `lint-ratchet grouped baseline has unsupported version ${String(baseline.version)}`,
    );
  }
  return {
    version: baseline.version,
    ...(baseline.regenerate === undefined ? {} : { regenerate: baseline.regenerate }),
    tests: Object.fromEntries(
      [...baseline.groups.entries()].map(([testId, group]) => [
        testId,
        baselineTestFromGroup(group.meta, group.items),
      ]),
    ),
  };
}
