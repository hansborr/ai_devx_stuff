import type {
  LintRatchetBaseline,
  LintRatchetRuleSourceHashesById,
  ParsedLintRatchetBaseline,
  StructuralLintRatchetBaseline,
} from "../lint-ratchet-baseline.js";
import { parseBaselineTest } from "../lint-ratchet-baseline-parse.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { validateMetricItem } from "../lint-ratchet-metrics.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import {
  baselineTestFromConfig,
  formatLintRatchetBaseline,
  type LintRatchetBaselineTest,
} from "./baseline-format.js";
import { isRecord, stableJson } from "./baseline-hash.js";

function validateBaselineTestMetadata(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: string[],
): void {
  if (test.ruleId !== expected.ruleId) failures.push(`${testId}.ruleId is stale`);
  if (test.mode !== expected.mode) failures.push(`${testId}.mode is stale`);
  if (test.target !== expected.target) failures.push(`${testId}.target is stale`);
  if (test.metric !== expected.metric) failures.push(`${testId}.metric is stale`);
  if (stableJson(test.files) !== stableJson(expected.files))
    failures.push(`${testId}.files is stale`);
  if (stableJson(test.ignores) !== stableJson(expected.ignores))
    failures.push(`${testId}.ignores is stale`);
  if (stableJson(test.ruleOptions) !== stableJson(expected.ruleOptions)) {
    failures.push(`${testId}.ruleOptions is stale`);
  }
  if (test.configHash !== expected.configHash) failures.push(`${testId}.configHash is stale`);
}

function validateBaselineRuleSourceHash(
  testId: string,
  test: LintRatchetBaselineTest,
  expected: LintRatchetBaselineTest,
  failures: string[],
): void {
  if (test.ruleSourceHash === "") {
    failures.push(`${testId}.ruleSourceHash is required`);
  } else if (test.ruleSourceHash !== expected.ruleSourceHash) {
    failures.push(
      `${testId}.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)`,
    );
  }
}

function validateBaselineMetricItems(
  testId: string,
  test: LintRatchetBaselineTest,
  failures: string[],
): void {
  for (const [itemPath, item] of Object.entries(test.items)) {
    validateMetricItem(`${testId}.items.${itemPath}`, test.metric, item, failures);
  }
}

function validateBaselineTestAgainstRatchet(
  testId: string,
  test: LintRatchetBaselineTest,
  ratchet: LintRatchetConfig,
  expectedRuleSourceHash: string,
  failures: string[],
): void {
  const expected = baselineTestFromConfig(ratchet, undefined, expectedRuleSourceHash);
  validateBaselineTestMetadata(testId, test, expected, failures);
  validateBaselineRuleSourceHash(testId, test, expected, failures);
  validateBaselineMetricItems(testId, test, failures);
}

function validateBaselineAgainstRegistry(
  baseline: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
  failures: string[],
): void {
  const registryById = new Map(ratchets.map((ratchet) => [ratchet.id, ratchet]));
  for (const testId of Object.keys(baseline.tests)) {
    const ratchet = registryById.get(testId);
    if (ratchet === undefined) {
      failures.push(`${testId}: baseline has no matching ratchet registry entry`);
      continue;
    }
    const test = baseline.tests[testId];
    if (test === undefined) continue;
    validateBaselineTestAgainstRatchet(
      testId,
      test,
      ratchet,
      ruleSourceHashesById.get(testId) ?? "",
      failures,
    );
  }
  for (const ratchet of ratchets) {
    if (baseline.tests[ratchet.id] === undefined) {
      failures.push(`${ratchet.id}: baseline is missing registry ratchet`);
    }
  }
}

export function parseLintRatchetBaselineStructure(text: string): StructuralLintRatchetBaseline {
  const failures: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
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
  if (structural.baseline === undefined) return { failures: structural.failures };
  const failures: string[] = [...structural.failures];
  validateBaselineAgainstRegistry(structural.baseline, ratchets, ruleSourceHashesById, failures);
  if (failures.length === 0 && formatLintRatchetBaseline(structural.baseline) !== text) {
    failures.push("baseline JSON is not deterministic; run bun run lint:ratchet:update");
  }
  return failures.length > 0 ? { failures } : { baseline: structural.baseline, failures: [] };
}
