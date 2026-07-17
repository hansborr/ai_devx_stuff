import type {
  LintMessageEvalResult,
  MessageEvalArmResult,
  MessageEvalFixtureResult,
} from "./evaluator.js";

function displayNumber(value: number | null): string {
  return value === null ? "unresolved" : String(value);
}

function armFor(
  fixture: MessageEvalFixtureResult,
  mode: "control" | "treatment",
): MessageEvalArmResult {
  const arm = fixture.arms.find((entry) => entry.mode === mode);
  if (arm === undefined) throw new Error(`${fixture.id} is missing its ${mode} arm`);
  return arm;
}

function patternText(arm: MessageEvalArmResult): string {
  const parts = [
    arm.stuckRules.length === 0 ? "" : `stuck: ${arm.stuckRules.join(", ")}`,
    arm.oscillatingRules.length === 0 ? "" : `oscillating: ${arm.oscillatingRules.join(", ")}`,
    arm.cascadingRules.length === 0 ? "" : `cascading: ${arm.cascadingRules.join(", ")}`,
  ].filter((part) => part.length > 0);
  return parts.length === 0 ? "none" : parts.join("; ");
}

function fixtureRow(fixture: MessageEvalFixtureResult): string {
  const control = armFor(fixture, "control");
  const treatment = armFor(fixture, "treatment");
  return `| ${fixture.id} | ${fixture.sourceLocation} | ${fixture.targetRuleId} | ${displayNumber(control.iterationsToGreen)} | ${displayNumber(treatment.iterationsToGreen)} | ${patternText(control)} | ${patternText(treatment)} |`;
}

export function formatLintMessageEvalMarkdown(result: LintMessageEvalResult): string {
  const summary = result.summary;
  return [
    "# Lint message eval run",
    "",
    `- Run: \`${result.runId}\``,
    `- Recorded: ${result.generatedAt}`,
    `- Evaluated commit: \`${result.gitCommit}\``,
    `- Agent/sample caveat: ${result.agent}`,
    "",
    "| Fixture | Frozen source | Target rule | Control iterations | Treatment iterations | Control patterns | Treatment patterns |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
    ...result.fixtures.map(fixtureRow),
    "",
    `Resolved arms: control ${String(summary.controlResolved)}/${String(summary.fixtureCount)}, treatment ${String(summary.treatmentResolved)}/${String(summary.fixtureCount)}.`,
    `Average iterations among each arm's resolved fixtures: control ${displayNumber(summary.controlAverageIterations)}, treatment ${displayNumber(summary.treatmentAverageIterations)}.`,
    `Paired delta (fixtures both arms resolved, ${String(summary.pairedResolved)} of ${String(summary.fixtureCount)}): mean treatment-minus-control ${displayNumber(summary.averageIterationDelta)}.`,
    `Resolved by one arm only: treatment ${String(summary.treatmentOnlyResolved)} that control could not, control ${String(summary.controlOnlyResolved)} that treatment could not.`,
    "",
    "This is a small directional pilot, not a causal benchmark. Re-run with independent sessions and more samples before drawing a message-quality conclusion.",
    "",
  ].join("\n");
}
