import type { LintRatchetBaseline } from "./baseline.js";
import {
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  lintRatchetBaselineRegenerateForVersion,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import { formatLintRatchetBaseline } from "./baseline-format.js";
import {
  lintRatchetBaselineFromGrouped,
  type LintRatchetBaselineGroupMeta,
  lintRatchetBaselineSpec,
  lintRatchetBaselineToGrouped,
} from "./baseline-spec.js";
import { parseLintRatchetBaselineStructure } from "./baseline-validation.js";
import { mergeGroupedBaseline, type MergeGroupedBaselineResult } from "./group-baseline.js";
import { validateMetricItem } from "./metrics.js";
import type { LintRatchetMetricItem } from "./metrics-types.js";

export interface MergeLintRatchetBaselinesOptions {
  readonly baseText: string;
  readonly currentText: string;
  readonly otherText: string;
  readonly versionPolicy?: LintRatchetBaselineVersionPolicy;
}

export interface MergeLintRatchetBaselinesResult {
  readonly mergedText?: string;
  readonly failures: readonly string[];
  readonly postMergeTruthUpRequired: boolean;
}

function ratchetMergeFailure(failure: string): string {
  return failure
    .replace(
      ": baseline group metadata differs between sides;",
      ": ratchet metadata differs between sides;",
    )
    .replace(
      ": one side removed the baseline group while the other changed it;",
      ": one side removed the ratchet while the other changed it;",
    );
}

function mergedBaseline(
  result: MergeGroupedBaselineResult<LintRatchetBaselineGroupMeta, LintRatchetMetricItem>,
  versionPolicy: LintRatchetBaselineVersionPolicy,
): LintRatchetBaseline | undefined {
  const baseline = result.baseline ?? result.partialBaseline;
  if (baseline === undefined) return undefined;
  return lintRatchetBaselineFromGrouped(baseline, versionPolicy);
}

function parseMergeBaseline(
  label: string,
  text: string,
  failures: string[],
  versionPolicy: LintRatchetBaselineVersionPolicy,
): LintRatchetBaseline | undefined {
  if (label === "base" && text.trim() === "") {
    const regenerate = lintRatchetBaselineRegenerateForVersion(versionPolicy.writeVersion);
    return {
      version: versionPolicy.writeVersion,
      ...(regenerate === undefined ? {} : { regenerate }),
      tests: {},
    };
  }
  const result = parseLintRatchetBaselineStructure(text, versionPolicy);
  if (result.baseline !== undefined) return result.baseline;
  failures.push(...result.failures.map((failure) => `${label} ${failure}`));
  return undefined;
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

export function mergeLintRatchetBaselines(
  options: MergeLintRatchetBaselinesOptions,
): MergeLintRatchetBaselinesResult {
  const versionPolicy = options.versionPolicy ?? LINT_RATCHET_BASELINE_VERSION_POLICY;
  const parseFailures: string[] = [];
  const base = parseMergeBaseline("base", options.baseText, parseFailures, versionPolicy);
  const current = parseMergeBaseline("current", options.currentText, parseFailures, versionPolicy);
  const other = parseMergeBaseline("other", options.otherText, parseFailures, versionPolicy);
  if (base === undefined || current === undefined || other === undefined) {
    return { failures: parseFailures, postMergeTruthUpRequired: false };
  }

  const grouped = mergeGroupedBaseline(lintRatchetBaselineSpec(versionPolicy), {
    base: lintRatchetBaselineToGrouped(base),
    current: lintRatchetBaselineToGrouped(current),
    other: lintRatchetBaselineToGrouped(other),
  });
  const baseline = mergedBaseline(grouped, versionPolicy);
  if (baseline === undefined) {
    throw new Error("grouped lint-ratchet merge returned without a baseline");
  }
  const failures = [
    ...grouped.failures.map(ratchetMergeFailure),
    ...validateMergedBaseline(baseline),
  ];
  if (failures.length > 0) return { failures, postMergeTruthUpRequired: false };
  return {
    mergedText: formatLintRatchetBaseline(baseline),
    failures: [],
    postMergeTruthUpRequired: grouped.postMergeTruthUpRequired,
  };
}
