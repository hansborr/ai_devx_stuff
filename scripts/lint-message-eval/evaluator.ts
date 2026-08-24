import { Linter } from "eslint";
import tseslint from "typescript-eslint";

import { defaultGitRunner, type GitRunner, readGitBlobAtRef } from "../lib/git.js";
import { lintAgentGuidanceOverlayFor } from "../lint-agent-guidance.js";
import { type MessageEvalFixture, type MessageEvalMode, parseLintMessageTrace } from "./trace.js";

export interface LintMessageVariants {
  readonly control: string;
  readonly treatment: string;
}

export interface MessageEvalArmResult {
  readonly mode: MessageEvalMode;
  readonly iterationsToGreen: number | null;
  readonly outcome: "green" | "unresolved";
  readonly stuckRules: readonly string[];
  readonly oscillatingRules: readonly string[];
  readonly cascadingRules: readonly string[];
}

export interface MessageEvalFixtureResult {
  readonly id: string;
  readonly sourceLocation: string;
  readonly targetRuleId: string;
  readonly arms: readonly MessageEvalArmResult[];
}

interface MessageEvalSummary {
  readonly fixtureCount: number;
  readonly controlResolved: number;
  readonly treatmentResolved: number;
  readonly pairedResolved: number;
  readonly controlOnlyResolved: number;
  readonly treatmentOnlyResolved: number;
  readonly controlAverageIterations: number | null;
  readonly treatmentAverageIterations: number | null;
  readonly averageIterationDelta: number | null;
}

export interface LintMessageEvalResult {
  readonly runId: string;
  readonly generatedAt: string;
  readonly gitCommit: string;
  readonly agent: string;
  readonly fixtures: readonly MessageEvalFixtureResult[];
  readonly summary: MessageEvalSummary;
}

interface EvaluateLintMessageTraceOptions {
  readonly git?: GitRunner;
}

const STRUCTURAL_LINT_CONFIG: Linter.Config[] = [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 2022, sourceType: "module" },
    },
    rules: {
      complexity: ["error", { max: 10 }],
      "max-depth": ["error", { max: 3 }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", { max: 4 }],
    },
  },
];

function lintRuleIds(source: string, filename: string): string[] {
  const messages = new Linter().verify(source, STRUCTURAL_LINT_CONFIG, { filename });
  const ruleIds: string[] = [];
  for (const message of messages) {
    if (message.ruleId === null) {
      throw new Error(`Could not parse ${filename}: ${message.message}`);
    }
    ruleIds.push(message.ruleId);
  }
  return [...new Set(ruleIds)].sort();
}

export function lintMessageVariantsFor(
  source: string,
  filename: string,
  targetRuleId: string,
): LintMessageVariants {
  const message = new Linter()
    .verify(source, STRUCTURAL_LINT_CONFIG, { filename })
    .find((entry) => entry.ruleId === targetRuleId);
  if (message === undefined) {
    throw new Error(`${filename} does not trigger target rule ${targetRuleId}`);
  }
  const overlay = lintAgentGuidanceOverlayFor(targetRuleId, message.messageId);
  if (overlay === undefined) {
    throw new Error(`${targetRuleId} has no lint-agent guidance overlay`);
  }
  return {
    control: message.message,
    treatment: `${message.message} Why: ${overlay.why} How to fix: ${overlay.howToFix}`,
  };
}

function patternResults(ruleIdsByStep: readonly (readonly string[])[]): {
  readonly stuckRules: string[];
  readonly oscillatingRules: string[];
  readonly cascadingRules: string[];
} {
  const initialRules = new Set(ruleIdsByStep[0]);
  const allRules = [...new Set(ruleIdsByStep.flat())].sort();
  const steps = ruleIdsByStep.map((ruleIds) => new Set(ruleIds));
  const unresolved = (ruleIdsByStep.at(-1)?.length ?? 0) > 0;
  const stuckRules = unresolved
    ? allRules.filter((ruleId) => steps.every((step) => step.has(ruleId)))
    : [];
  const oscillatingRules = allRules.filter((ruleId) => {
    let appeared = false;
    let disappearedAfterAppearance = false;
    for (const step of steps) {
      if (step.has(ruleId)) {
        if (disappearedAfterAppearance) return true;
        appeared = true;
      } else if (appeared) {
        disappearedAfterAppearance = true;
      }
    }
    return false;
  });
  const cascadingRules = allRules.filter((ruleId) => !initialRules.has(ruleId));
  return { stuckRules, oscillatingRules, cascadingRules };
}

function evaluateArm(
  fixture: MessageEvalFixture,
  mode: MessageEvalMode,
  presentedMessage: string,
  attempts: readonly string[],
): MessageEvalArmResult {
  const expectedMessage = lintMessageVariantsFor(
    fixture.source,
    fixture.filename,
    fixture.targetRuleId,
  )[mode];
  if (presentedMessage !== expectedMessage) {
    throw new Error(`${fixture.id} has a stale ${mode} message; record a fresh eval run`);
  }

  const ruleIdsByStep = [
    lintRuleIds(fixture.source, fixture.filename),
    ...attempts.map((attempt) => lintRuleIds(attempt, fixture.filename)),
  ];
  const greenStep = ruleIdsByStep.findIndex((ruleIds, index) => index > 0 && ruleIds.length === 0);
  const iterationsToGreen = greenStep === -1 ? null : greenStep;
  const inspectedSteps =
    iterationsToGreen === null ? ruleIdsByStep : ruleIdsByStep.slice(0, iterationsToGreen + 1);
  const patterns = patternResults(inspectedSteps);
  return {
    mode,
    iterationsToGreen,
    outcome: iterationsToGreen === null ? "unresolved" : "green",
    ...patterns,
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function armFor(
  fixture: MessageEvalFixtureResult,
  mode: MessageEvalMode,
): MessageEvalArmResult {
  const arm = fixture.arms.find((entry) => entry.mode === mode);
  if (arm === undefined) throw new Error(`${fixture.id} is missing its ${mode} arm`);
  return arm;
}

// The iteration delta is measured only over fixtures BOTH arms resolved. Each
// arm can resolve a different subset, so averaging the two arms' resolved
// iterations independently compares mismatched populations: a message change
// that newly resolves a hard fixture folds a slow, treatment-only solve into
// the treatment mean and reads as a regression. Report the paired mean
// difference plus the resolved-by-one-arm-only counts so that asymmetry is
// visible instead of silently skewing the delta.
function resultSummary(fixtures: readonly MessageEvalFixtureResult[]): MessageEvalSummary {
  const controlIterations: number[] = [];
  const treatmentIterations: number[] = [];
  const pairedDeltas: number[] = [];
  let controlOnlyResolved = 0;
  let treatmentOnlyResolved = 0;
  for (const fixture of fixtures) {
    const controlIter = armFor(fixture, "control").iterationsToGreen;
    const treatmentIter = armFor(fixture, "treatment").iterationsToGreen;
    if (controlIter !== null) controlIterations.push(controlIter);
    if (treatmentIter !== null) treatmentIterations.push(treatmentIter);
    if (controlIter !== null && treatmentIter !== null) {
      pairedDeltas.push(treatmentIter - controlIter);
    } else if (treatmentIter !== null) {
      treatmentOnlyResolved += 1;
    } else if (controlIter !== null) {
      controlOnlyResolved += 1;
    }
  }
  return {
    fixtureCount: fixtures.length,
    controlResolved: controlIterations.length,
    treatmentResolved: treatmentIterations.length,
    pairedResolved: pairedDeltas.length,
    controlOnlyResolved,
    treatmentOnlyResolved,
    controlAverageIterations: average(controlIterations),
    treatmentAverageIterations: average(treatmentIterations),
    averageIterationDelta: average(pairedDeltas),
  };
}

function validateFixtureSource(
  fixture: MessageEvalFixture,
  gitCommit: string,
  git: GitRunner,
): void {
  let blob: string;
  try {
    blob = readGitBlobAtRef(git, gitCommit, fixture.filename);
  } catch {
    throw new Error(`could not read ${fixture.id} source from ${gitCommit}:${fixture.filename}`);
  }
  const lines = blob.split("\n");
  if (blob.endsWith("\n")) lines.pop();
  if (fixture.sourceEndLine > lines.length) {
    throw new Error(
      `${fixture.id} source range ${String(fixture.sourceLine)}-${String(fixture.sourceEndLine)} exceeds ${gitCommit}:${fixture.filename} (${String(lines.length)} lines)`,
    );
  }
  const committedSource = lines.slice(fixture.sourceLine - 1, fixture.sourceEndLine).join("\n");
  if (committedSource !== fixture.source) {
    throw new Error(
      `${fixture.id} source does not match ${gitCommit}:${fixture.filename}:${String(fixture.sourceLine)}-${String(fixture.sourceEndLine)}`,
    );
  }
}

export function evaluateLintMessageTrace(
  input: unknown,
  options: EvaluateLintMessageTraceOptions = {},
): LintMessageEvalResult {
  const trace = parseLintMessageTrace(input);
  const git = options.git ?? defaultGitRunner({ stderr: "captured" });
  const fixtures = trace.fixtures.map((fixture) => {
    validateFixtureSource(fixture, trace.gitCommit, git);
    const modes = new Set(fixture.arms.map((arm) => arm.mode));
    if (!(["control", "treatment"] as const).every((mode) => modes.has(mode))) {
      throw new Error(`${fixture.id} must contain one control and one treatment arm`);
    }
    return {
      id: fixture.id,
      sourceLocation: `${fixture.filename}:${String(fixture.sourceLine)}`,
      targetRuleId: fixture.targetRuleId,
      arms: fixture.arms.map((arm) =>
        evaluateArm(fixture, arm.mode, arm.presentedMessage, arm.attempts),
      ),
    };
  });
  return {
    runId: trace.runId,
    generatedAt: trace.generatedAt,
    gitCommit: trace.gitCommit,
    agent: trace.agent,
    fixtures,
    summary: resultSummary(fixtures),
  };
}
