import { describe, expect, it } from "vitest";

import { parseMetricFields } from "./metrics-parse.js";

// Direct unit coverage for the `perFunction` field-validation guards in
// `parseMetricFields` (finding 84). The broader baseline tests only assert
// top-level presence (`maxComplexity is required`, `perFunction is required`)
// and never drive a structurally-malformed `perFunction` entry through the
// field-level checks, so the `isRecord` / `isNonNegativeInteger` / non-empty
// `label` / `isCompleteComplexityFunction` / non-array guards could all be
// flipped to always-pass while every test stayed green. These cases pin each
// guard by feeding malformed input and asserting it is rejected (a failure is
// recorded). Message matching is kept loose so copy edits to the exact wording
// do not break the tests; only the load-bearing substring is asserted.

/** Run parseMetricFields against a crafted item and return the recorded failures. */
function failuresFor(rawItem: Record<string, unknown>): string[] {
  const failures: string[] = [];
  parseMetricFields(rawItem, "item", failures);
  return failures;
}

/** A single perFunction entry that is structurally complete except for overrides. */
function complexityEntry(
  overrides: Partial<Record<"line" | "label" | "complexity", unknown>> = {},
): Record<string, unknown> {
  return { line: 10, label: "doWork", complexity: 12, ...overrides };
}

describe("parseMetricFields perFunction validation", () => {
  it("accepts a well-formed perFunction entry without recording failures", () => {
    const failures = failuresFor({ perFunction: [complexityEntry()] });
    expect(failures).toEqual([]);
  });

  it("rejects a non-array perFunction", () => {
    // Kills the `!Array.isArray(value)` guard: a non-array perFunction must be
    // reported as `.perFunction must be an array`, never silently accepted.
    const failures = failuresFor({ perFunction: { line: 1, label: "x", complexity: 2 } });
    expect(failures).toContainEqual(expect.stringMatching(/perFunction must be an array/u));
  });

  it("rejects a non-object perFunction element", () => {
    // Kills the `isRecord` guard: a primitive element must be reported as
    // `.perFunction[0] must be an object`.
    const failures = failuresFor({ perFunction: ["not-an-object"] });
    expect(failures).toContainEqual(expect.stringMatching(/perFunction\[0\] must be an object/u));
  });

  it("rejects a negative line", () => {
    const failures = failuresFor({ perFunction: [complexityEntry({ line: -1 })] });
    expect(failures).toContainEqual(
      expect.stringMatching(/\.line must be a non-negative integer/u),
    );
  });

  it("rejects a fractional line", () => {
    // Kills the `Number.isInteger` clause of `isNonNegativeInteger`: 10.5 is
    // non-negative but not an integer, so it must still be rejected.
    const failures = failuresFor({ perFunction: [complexityEntry({ line: 10.5 })] });
    expect(failures).toContainEqual(
      expect.stringMatching(/\.line must be a non-negative integer/u),
    );
  });

  it("rejects a negative complexity", () => {
    const failures = failuresFor({ perFunction: [complexityEntry({ complexity: -3 })] });
    expect(failures).toContainEqual(
      expect.stringMatching(/\.complexity must be a non-negative integer/u),
    );
  });

  it("rejects a fractional complexity", () => {
    const failures = failuresFor({ perFunction: [complexityEntry({ complexity: 3.2 })] });
    expect(failures).toContainEqual(
      expect.stringMatching(/\.complexity must be a non-negative integer/u),
    );
  });

  it("rejects an empty-string label", () => {
    // Kills the `value.length === 0` clause of the label guard.
    const failures = failuresFor({ perFunction: [complexityEntry({ label: "" })] });
    expect(failures).toContainEqual(expect.stringMatching(/\.label must be a non-empty string/u));
  });

  it("rejects a non-string label", () => {
    // Kills the `typeof value !== "string"` clause of the label guard.
    const failures = failuresFor({ perFunction: [complexityEntry({ label: 42 })] });
    expect(failures).toContainEqual(expect.stringMatching(/\.label must be a non-empty string/u));
  });

  it("rejects an entry that is missing a required field", () => {
    // An entry missing `complexity` is incomplete: the field guard records the
    // failure, and `isCompleteComplexityFunction` must not treat it as complete
    // (killing that guard's `-> true` mutant).
    const failures = failuresFor({ perFunction: [{ line: 4, label: "partial" }] });
    expect(failures).toContainEqual(
      expect.stringMatching(/\.complexity must be a non-negative integer/u),
    );
  });
});
