import {
  baselineTestFromConfig,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetBaselineTest,
  type LintRatchetBaselineValidationFailure,
  type LintRatchetBaselineValidationFailureCode,
  type LintRatchetRuleSourceHashesById,
  type ParsedLintRatchetBaseline,
  type StructuralLintRatchetBaseline,
} from "./baseline.js";
import {
  LINT_RATCHET_BASELINE_REGENERATE,
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import { stableJson } from "./baseline-hash.js";
import { lintRatchetBaselineFromGrouped, lintRatchetBaselineSpec } from "./baseline-spec.js";
import type { LintRatchetConfig } from "./config-types.js";
import { parseGroupedBaseline } from "./group-baseline.js";
import { validateMetricItem } from "./metric-strategies.js";

function validateBaselineTestMetadata(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  if (test.ruleId !== expected.ruleId)
    pushFailure(failures, "rule-id-mismatch", `${testId}.ruleId is stale`);
  // `mode` is single-valued (`no-new`); the grouped spec's metadata codec
  // rejects a stale value during structural parsing, so no mismatch is possible.
  if (test.metric !== expected.metric)
    pushFailure(failures, "metric-mismatch", `${testId}.metric is stale`);
  if (stableJson(test.files) !== stableJson(expected.files))
    pushFailure(failures, "files-mismatch", `${testId}.files is stale`);
  if (stableJson(test.ignores) !== stableJson(expected.ignores))
    pushFailure(failures, "ignores-mismatch", `${testId}.ignores is stale`);
  if (stableJson(test.ruleOptions) !== stableJson(expected.ruleOptions)) {
    pushFailure(failures, "rule-options-mismatch", `${testId}.ruleOptions is stale`);
  }
  if (test.configHash !== expected.configHash)
    pushFailure(failures, "config-hash-mismatch", `${testId}.configHash is stale`);
}

function validateBaselineRuleSourceHash(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  if (test.ruleSourceHash === "") {
    pushFailure(failures, "rule-source-hash-required", `${testId}.ruleSourceHash is required`);
  } else if (test.ruleSourceHash !== expected.ruleSourceHash) {
    pushFailure(
      failures,
      "rule-source-drift",
      `${testId}.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)`,
    );
  }
}

function validateBaselineMetricItems(
  testId: string,
  test: LintRatchetBaselineTest,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  for (const [itemPath, item] of Object.entries(test.items)) {
    const metricFailures: string[] = [];
    validateMetricItem(`${testId}.items.${itemPath}`, test.metric, item, metricFailures);
    for (const failure of metricFailures) {
      pushFailure(failures, "metric-item-invalid", failure);
    }
  }
}

interface BaselineTestValidationContext {
  readonly testId: string;
  readonly test: LintRatchetBaselineTest;
  readonly ratchet: LintRatchetConfig;
  readonly expectedRuleSourceHash: string;
}

function validateBaselineTestAgainstRatchet(
  context: BaselineTestValidationContext,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  const expected = baselineTestFromConfig(
    context.ratchet,
    undefined,
    context.expectedRuleSourceHash,
  );
  validateBaselineTestMetadata(context.testId, context.test, expected, failures);
  validateBaselineRuleSourceHash(context.testId, context.test, expected, failures);
  validateBaselineMetricItems(context.testId, context.test, failures);
}

export function validateBaselineTestForRatchet(
  testId: string,
  test: LintRatchetBaselineTest,
  ratchet: LintRatchetConfig,
  expectedRuleSourceHash: string,
): readonly string[] {
  const failures: LintRatchetBaselineValidationFailure[] = [];
  validateBaselineTestAgainstRatchet({ testId, test, ratchet, expectedRuleSourceHash }, failures);
  return failures.map((failure) => failure.message);
}

function pushFailure(
  failures: LintRatchetBaselineValidationFailure[],
  code: LintRatchetBaselineValidationFailureCode,
  message: string,
): void {
  failures.push({ code, message });
}

function messagesFromFailures(
  failures: readonly LintRatchetBaselineValidationFailure[],
): readonly string[] {
  return failures.map((failure) => failure.message);
}

function structuralValidationFailures(
  failures: readonly string[],
): readonly LintRatchetBaselineValidationFailure[] {
  return failures.map((message) => ({ code: "structure", message }));
}

function validateBaselineAgainstRegistry(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  const registryById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  for (const testId of Object.keys(baseline.tests)) {
    const ratchet = registryById.get(testId);
    if (ratchet === undefined) {
      pushFailure(
        failures,
        "orphan-ratchet",
        `${testId}: baseline has no matching ratchet registry entry`,
      );
      continue;
    }
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    validateBaselineTestAgainstRatchet(
      {
        testId,
        test,
        ratchet,
        expectedRuleSourceHash: ruleSourceHashesById.get(testId) ?? "",
      },
      failures,
    );
  }
  for (const ratchet of ratchets) {
    if (baseline.tests[ratchet.id] === undefined) {
      pushFailure(
        failures,
        "missing-ratchet",
        `${ratchet.id}: baseline is missing registry ratchet`,
      );
    }
  }
}

function regenerateWarning(baseline: LintRatchetBaseline): string | undefined {
  const committed = baseline.regenerate;
  if (committed === undefined || committed === LINT_RATCHET_BASELINE_REGENERATE) return undefined;
  return `baseline regenerate annotation is stale; regenerate with \`${LINT_RATCHET_BASELINE_REGENERATE}\` (committed ${JSON.stringify(committed)})`;
}

export function parseLintRatchetBaselineStructure(
  text: string,
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
): StructuralLintRatchetBaseline {
  const parsed = parseGroupedBaseline(lintRatchetBaselineSpec(versionPolicy), text);
  if (!parsed.ok) {
    return { failures: parsed.errors ?? [parsed.error] };
  }
  return {
    baseline: lintRatchetBaselineFromGrouped(parsed.value, versionPolicy),
    failures: [],
  };
}

export function parseLintRatchetBaseline(
  text: string,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
): ParsedLintRatchetBaseline {
  const structural = parseLintRatchetBaselineStructure(text, versionPolicy);
  if (structural.baseline === undefined) {
    const validationFailures = structuralValidationFailures(structural.failures);
    return { failures: structural.failures, validationFailures, warnings: [] };
  }
  const validationFailures: LintRatchetBaselineValidationFailure[] = [
    ...structuralValidationFailures(structural.failures),
  ];
  validateBaselineAgainstRegistry(
    structural.baseline,
    ratchets,
    ruleSourceHashesById,
    validationFailures,
  );
  if (validationFailures.length === 0 && formatLintRatchetBaseline(structural.baseline) !== text) {
    pushFailure(
      validationFailures,
      "nondeterministic-json",
      "baseline JSON is not deterministic; run bun run lint:ratchet:update",
    );
  }
  const failures = messagesFromFailures(validationFailures);
  const warning = regenerateWarning(structural.baseline);
  const warnings = warning === undefined ? [] : [warning];
  return failures.length > 0
    ? { failures, validationFailures, warnings }
    : { baseline: structural.baseline, failures: [], validationFailures: [], warnings };
}
