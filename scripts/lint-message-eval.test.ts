import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { evaluateLintMessageTrace, lintMessageVariantsFor } from "./lint-message-eval/evaluator.js";
import { formatLintMessageEvalMarkdown } from "./lint-message-eval/reporter.js";
import { parseLintMessageTrace } from "./lint-message-eval/trace.js";

const filename = "packages/server/src/services/lint-message-eval-fixture.ts";
const nestedSource = [
  "export function canAct(ready: boolean, valid: boolean, allowed: boolean, open: boolean): boolean {",
  "  if (ready) {",
  "    if (valid) {",
  "      if (allowed) {",
  "        if (open) return true;",
  "      }",
  "    }",
  "  }",
  "  return false;",
  "}",
].join("\n");
const flatSource = [
  "export function canAct(ready: boolean, valid: boolean, allowed: boolean, open: boolean): boolean {",
  "  if (!ready || !valid || !allowed || !open) return false;",
  "  return true;",
  "}",
].join("\n");

function fixtureEntry(
  id: string,
  controlAttempts: readonly string[],
  treatmentAttempts: readonly string[],
  treatmentMessage?: string,
): unknown {
  const variants = lintMessageVariantsFor(nestedSource, filename, "max-depth");
  return {
    id,
    filename,
    sourceLine: 1,
    sourceEndLine: nestedSource.split("\n").length,
    source: nestedSource,
    targetRuleId: "max-depth",
    arms: [
      {
        mode: "control",
        presentedMessage: variants.control,
        attempts: controlAttempts,
      },
      {
        mode: "treatment",
        presentedMessage: treatmentMessage ?? variants.treatment,
        attempts: treatmentAttempts,
      },
    ],
  };
}

function traceWithFixtures(fixtures: readonly unknown[]): unknown {
  return {
    version: 1,
    runId: "unit-test",
    generatedAt: "2026-07-15T00:00:00Z",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    agent: "fixture-agent",
    fixtures,
  };
}

function traceWithArms(
  controlAttempts: readonly string[],
  treatmentAttempts: readonly string[],
  treatmentMessage?: string,
): unknown {
  return traceWithFixtures([
    fixtureEntry("nested-guards", controlAttempts, treatmentAttempts, treatmentMessage),
  ]);
}

describe("lint message eval", () => {
  it("compares iterations-to-green for the same violation in both arms", () => {
    const result = evaluateLintMessageTrace(
      traceWithArms([nestedSource, flatSource], [flatSource]),
    );

    expect(result.fixtures[0]?.arms).toEqual([
      {
        mode: "control",
        iterationsToGreen: 2,
        outcome: "green",
        stuckRules: [],
        oscillatingRules: [],
        cascadingRules: [],
      },
      {
        mode: "treatment",
        iterationsToGreen: 1,
        outcome: "green",
        stuckRules: [],
        oscillatingRules: [],
        cascadingRules: [],
      },
    ]);
    expect(result.summary).toEqual({
      fixtureCount: 1,
      controlResolved: 1,
      treatmentResolved: 1,
      pairedResolved: 1,
      controlOnlyResolved: 0,
      treatmentOnlyResolved: 0,
      controlAverageIterations: 2,
      treatmentAverageIterations: 1,
      averageIterationDelta: -1,
    });
  });

  it("computes the iteration delta only over fixtures both arms resolved", () => {
    // Fixture 1 is paired (both arms resolve): control in 2, treatment in 1.
    // Fixture 2 is treatment-only: control never greens, treatment greens
    // slowly (3 iterations). Independently averaging resolved arms would fold
    // that slow, treatment-exclusive solve into the treatment mean and hide the
    // real paired improvement — the misleading comparison this pins against.
    const result = evaluateLintMessageTrace(
      traceWithFixtures([
        fixtureEntry("paired", [nestedSource, flatSource], [flatSource]),
        fixtureEntry(
          "treatment-only",
          [nestedSource, nestedSource],
          [nestedSource, nestedSource, flatSource],
        ),
      ]),
    );

    expect(result.summary).toEqual({
      fixtureCount: 2,
      controlResolved: 1,
      treatmentResolved: 2,
      pairedResolved: 1,
      controlOnlyResolved: 0,
      treatmentOnlyResolved: 1,
      controlAverageIterations: 2,
      treatmentAverageIterations: 2,
      averageIterationDelta: -1,
    });
  });

  it("classifies stuck, oscillating, and cascading rule interactions", () => {
    const tooManyParams =
      "export function canAct(ready, valid, allowed, open, extra) { return extra; }";
    const result = evaluateLintMessageTrace(
      traceWithArms(
        [nestedSource, tooManyParams, nestedSource, tooManyParams],
        [nestedSource, nestedSource],
      ),
    );

    expect(result.fixtures[0]?.arms).toEqual([
      {
        mode: "control",
        iterationsToGreen: null,
        outcome: "unresolved",
        stuckRules: [],
        oscillatingRules: ["max-depth", "max-params"],
        cascadingRules: ["max-params"],
      },
      {
        mode: "treatment",
        iterationsToGreen: null,
        outcome: "unresolved",
        stuckRules: ["max-depth"],
        oscillatingRules: [],
        cascadingRules: [],
      },
    ]);
  });

  it("does not label a cascading rule's first appearance as a return", () => {
    const tooManyParams =
      "export function canAct(ready: boolean, valid: boolean, allowed: boolean, open: boolean, extra: boolean): boolean { return extra; }";
    const result = evaluateLintMessageTrace(
      traceWithArms([tooManyParams, tooManyParams], [flatSource]),
    );

    expect(result.fixtures[0]?.arms[0]).toMatchObject({
      oscillatingRules: [],
      cascadingRules: ["max-params"],
    });
  });

  it("rejects recorded messages that no longer match the current lint surface", () => {
    expect(() =>
      evaluateLintMessageTrace(traceWithArms([flatSource], [flatSource], "stale treatment")),
    ).toThrow(/stale treatment message/u);
  });

  it("replays the committed pilot trace and renders its null result", () => {
    const input: unknown = JSON.parse(
      readFileSync("scripts/fixtures/lint-message-eval/2026-07-15-codex-pilot.json", "utf8"),
    );
    const trace = parseLintMessageTrace(input);
    for (const fixture of trace.fixtures) {
      const attributedSource = readFileSync(fixture.filename, "utf8")
        .split("\n")
        .slice(fixture.sourceLine - 1, fixture.sourceEndLine)
        .join("\n");
      expect(fixture.source, `${fixture.filename}:${String(fixture.sourceLine)} provenance`).toBe(
        attributedSource,
      );
    }
    const result = evaluateLintMessageTrace(input);

    expect(result.summary).toEqual({
      fixtureCount: 2,
      controlResolved: 2,
      treatmentResolved: 2,
      pairedResolved: 2,
      controlOnlyResolved: 0,
      treatmentOnlyResolved: 0,
      controlAverageIterations: 1,
      treatmentAverageIterations: 1,
      averageIterationDelta: 0,
    });
    expect(formatLintMessageEvalMarkdown(result)).toContain(
      "This is a small directional pilot, not a causal benchmark.",
    );
  });
});
