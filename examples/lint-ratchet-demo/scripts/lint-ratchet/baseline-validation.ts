import type {
  LintRatchetBaseline,
  LintRatchetBaselineValidationFailure,
  LintRatchetBaselineValidationFailureCode,
  LintRatchetRuleSourceHashesById,
  ParsedLintRatchetBaseline,
  StructuralLintRatchetBaseline,
} from "./baseline.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import {
  baselineTestFromConfig,
  formatLintRatchetBaseline,
  type LintRatchetBaselineTest,
} from "./baseline-format.js";
import { isRecord, stableJson } from "./baseline-hash.js";
import { parseBaselineTest } from "./baseline-parse.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { validateMetricItem } from "./metrics.js";

const GIT_CONFLICT_MARKER_PATTERN = /^<{7} /mu;
const CONFLICT_MARKER_TRIPWIRE =
  "lint-ratchet.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:ratchet:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then resolve by regenerating with `bun run lint:ratchet:update`; never hand-merge this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.";

function validateBaselineTestMetadata(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: LintRatchetBaselineValidationFailure[],
): void {
  if (test.ruleId !== expected.ruleId)
    pushFailure(failures, "rule-id-mismatch", `${testId}.ruleId is stale`);
  // `mode` is single-valued (`no-new`); a stale value fails structural parse
  // (baseline-parse.ts `isLintRatchetMode`), so no metadata mismatch is possible.
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

export function parseLintRatchetBaselineStructure(text: string): StructuralLintRatchetBaseline {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (GIT_CONFLICT_MARKER_PATTERN.test(text)) return { failures: [CONFLICT_MARKER_TRIPWIRE] };
    const message = error instanceof Error ? error.message : "unknown parse error";
    return { failures: [`baseline JSON parse failed: ${message}`] };
  }

  if (!isRecord(parsed)) return { failures: ["baseline must be an object"] };
  if (parsed.version !== LINT_RATCHET_BASELINE_VERSION) {
    failures.push(`version must be ${String(LINT_RATCHET_BASELINE_VERSION)}`);
  }
  if (!isRecord(parsed.tests)) {
    failures.push("tests must be an object");
    return { failures };
  }

  const tests: Record<string, LintRatchetBaselineTest> = {};
  for (const [testId, rawTest] of Object.entries(parsed.tests)) {
    const test = parseBaselineTest(testId, rawTest, failures);
    if (test !== undefined) tests[testId] = test;
  }

  return failures.length > 0
    ? { failures }
    : { baseline: { version: LINT_RATCHET_BASELINE_VERSION, tests }, failures: [] };
}

export function parseLintRatchetBaseline(
  text: string,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): ParsedLintRatchetBaseline {
  const structural = parseLintRatchetBaselineStructure(text);
  if (structural.baseline === undefined) {
    const validationFailures = structuralValidationFailures(structural.failures);
    return { failures: structural.failures, validationFailures };
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
  return failures.length > 0
    ? { failures, validationFailures }
    : { baseline: structural.baseline, failures: [], validationFailures: [] };
}
