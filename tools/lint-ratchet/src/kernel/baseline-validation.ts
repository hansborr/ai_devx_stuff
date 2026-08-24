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
  LINT_RATCHET_BASELINE_VERSION_POLICY,
  type LintRatchetBaselineVersionPolicy,
} from "./baseline-constants.js";
import { stableJson } from "./baseline-hash.js";
import { lintRatchetBaselineFromGrouped, lintRatchetBaselineSpec } from "./baseline-spec.js";
import type { LintRatchetConfig } from "./config-types.js";
import { DEFAULT_BASELINE_FILENAME, type LintRatchetWorkflowVocabulary } from "./engine-context.js";
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
  context: Pick<
    BaselineTestValidationContext,
    "expectedRuleSourceHash" | "test" | "testId" | "workflowVocabulary"
  >,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  if (context.test.ruleSourceHash === "") {
    pushFailure(
      failures,
      "rule-source-hash-required",
      `${context.testId}.ruleSourceHash is required`,
    );
  } else if (context.test.ruleSourceHash !== context.expectedRuleSourceHash) {
    pushFailure(
      failures,
      "rule-source-drift",
      `${context.testId}.ruleSourceHash is stale (run "${context.workflowVocabulary.updateCommand}" to regenerate)`,
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
  readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
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
  validateBaselineRuleSourceHash(context, failures);
  validateBaselineMetricItems(context.testId, context.test, failures);
}

export function validateBaselineTestForRatchet(
  testId: string,
  test: LintRatchetBaselineTest,
  ratchet: LintRatchetConfig,
  options: {
    readonly expectedRuleSourceHash: string;
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
  },
): readonly string[] {
  const failures: LintRatchetBaselineValidationFailure[] = [];
  validateBaselineTestAgainstRatchet(
    {
      testId,
      test,
      ratchet,
      expectedRuleSourceHash: options.expectedRuleSourceHash,
      workflowVocabulary: options.workflowVocabulary,
    },
    failures,
  );
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
  context: {
    readonly baseline: LintRatchetBaseline;
    readonly ratchets: readonly LintRatchetConfig[];
    readonly ruleSourceHashesById: LintRatchetRuleSourceHashesById;
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
  },
  failures: LintRatchetBaselineValidationFailure[],
): void {
  const registryById = new Map(context.ratchets.map((ratchet) => [ratchet.id, ratchet]));
  for (const testId of Object.keys(context.baseline.tests)) {
    const ratchet = registryById.get(testId);
    if (ratchet === undefined) {
      pushFailure(
        failures,
        "orphan-ratchet",
        `${testId}: baseline has no matching ratchet registry entry`,
      );
      continue;
    }
    const test = context.baseline.tests[testId];
    if (test === undefined) continue;
    validateBaselineTestAgainstRatchet(
      {
        testId,
        test,
        ratchet,
        expectedRuleSourceHash: context.ruleSourceHashesById.get(testId) ?? "",
        workflowVocabulary: context.workflowVocabulary,
      },
      failures,
    );
  }
  for (const ratchet of context.ratchets) {
    if (context.baseline.tests[ratchet.id] === undefined) {
      pushFailure(
        failures,
        "missing-ratchet",
        `${ratchet.id}: baseline is missing registry ratchet`,
      );
    }
  }
}

function regenerateWarning(
  baseline: LintRatchetBaseline,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string | undefined {
  const committed = baseline.regenerate;
  if (committed === undefined || committed === workflowVocabulary.updateCommand) return undefined;
  return `baseline regenerate annotation is stale; regenerate with \`${workflowVocabulary.updateCommand}\` (committed ${JSON.stringify(committed)})`;
}

export function parseLintRatchetBaselineStructure(
  text: string,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
  versionPolicy: LintRatchetBaselineVersionPolicy = LINT_RATCHET_BASELINE_VERSION_POLICY,
  baselineFile: string = DEFAULT_BASELINE_FILENAME,
): StructuralLintRatchetBaseline {
  const parsed = parseGroupedBaseline(
    lintRatchetBaselineSpec(versionPolicy, workflowVocabulary, baselineFile),
    text,
  );
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
  options: {
    readonly workflowVocabulary: LintRatchetWorkflowVocabulary;
    readonly versionPolicy?: LintRatchetBaselineVersionPolicy;
    readonly baselineFile?: string;
  },
): ParsedLintRatchetBaseline {
  const versionPolicy = options.versionPolicy ?? LINT_RATCHET_BASELINE_VERSION_POLICY;
  const baselineFile = options.baselineFile ?? DEFAULT_BASELINE_FILENAME;
  const structural = parseLintRatchetBaselineStructure(
    text,
    options.workflowVocabulary,
    versionPolicy,
    baselineFile,
  );
  if (structural.baseline === undefined) {
    const validationFailures = structuralValidationFailures(structural.failures);
    return { failures: structural.failures, validationFailures, warnings: [] };
  }
  const validationFailures: LintRatchetBaselineValidationFailure[] = [
    ...structuralValidationFailures(structural.failures),
  ];
  validateBaselineAgainstRegistry(
    {
      baseline: structural.baseline,
      ratchets,
      ruleSourceHashesById,
      workflowVocabulary: options.workflowVocabulary,
    },
    validationFailures,
  );
  if (
    validationFailures.length === 0 &&
    formatLintRatchetBaseline(structural.baseline, options.workflowVocabulary) !== text
  ) {
    pushFailure(
      validationFailures,
      "nondeterministic-json",
      `baseline JSON is not deterministic; run ${options.workflowVocabulary.updateCommand}`,
    );
  }
  const failures = messagesFromFailures(validationFailures);
  const warning = regenerateWarning(structural.baseline, options.workflowVocabulary);
  const warnings = warning === undefined ? [] : [warning];
  return failures.length > 0
    ? { failures, validationFailures, warnings }
    : { baseline: structural.baseline, failures: [], validationFailures: [], warnings };
}
