import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSurvivorSummary,
  formatTextSummary,
  runMutationSurvivors,
} from "./mutation-survivors.js";

const SAMPLE_REPORT = {
  schemaVersion: "1",
  files: {
    "packages/shared/src/rules/combat.ts": {
      mutants: [
        {
          id: "1",
          mutatorName: "ConditionalExpression",
          status: "Survived",
          replacement: "true",
          location: { start: { line: 12, column: 5 }, end: { line: 12, column: 20 } },
        },
        {
          id: "2",
          mutatorName: "EqualityOperator",
          status: "Survived",
          location: { start: { line: 30, column: 3 }, end: { line: 30, column: 9 } },
        },
        { id: "3", mutatorName: "BlockStatement", status: "Killed" },
      ],
    },
    "packages/shared/src/rules/spells.ts": {
      mutants: [
        {
          id: "4",
          mutatorName: "ArithmeticOperator",
          status: "NoCoverage",
          location: { start: { line: 7, column: 1 }, end: { line: 7, column: 4 } },
        },
      ],
    },
    "packages/shared/src/dice/roll.ts": {
      mutants: [
        { id: "5", mutatorName: "StringLiteral", status: "CompileError" },
        { id: "6", mutatorName: "BooleanLiteral", status: "Killed" },
      ],
    },
  },
};

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "musi-mutation-survivors-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("buildSurvivorSummary", () => {
  it("counts mutants by status and ranks files by actionable mutants", () => {
    const summary = buildSurvivorSummary(SAMPLE_REPORT);
    expect(summary.totals.mutants).toBe(6);
    expect(summary.totals.byStatus).toEqual({
      Survived: 2,
      Killed: 2,
      NoCoverage: 1,
      CompileError: 1,
    });
    expect(summary.totals.actionable).toBe(3);
    expect(summary.files.map((file) => file.path)).toEqual([
      "packages/shared/src/rules/combat.ts",
      "packages/shared/src/rules/spells.ts",
    ]);
    expect(summary.files[0]).toMatchObject({ survived: 2, noCoverage: 0, actionable: 2 });
  });

  it("rolls actionable counts up into directory areas", () => {
    const summary = buildSurvivorSummary(SAMPLE_REPORT);
    expect(summary.areas).toEqual([
      { area: "packages/shared/src/rules", survived: 2, noCoverage: 1, actionable: 3 },
    ]);
  });

  it("bounds sample mutants per file and keeps line and mutator info", () => {
    const summary = buildSurvivorSummary(SAMPLE_REPORT, { samplesPerFile: 1 });
    const [first] = summary.files;
    expect(first?.samples).toEqual([
      { line: 12, mutatorName: "ConditionalExpression", status: "Survived", replacement: "true" },
    ]);
  });

  it("bounds the ranked file list with the top option", () => {
    const summary = buildSurvivorSummary(SAMPLE_REPORT, { top: 1 });
    expect(summary.files).toHaveLength(1);
  });

  it("tolerates mutants whose location is present but partial", () => {
    // Real-world reports can carry a location object without start.line;
    // such mutants must fall back to no-line rendering instead of failing
    // the whole report.
    const summary = buildSurvivorSummary({
      files: {
        "a.ts": {
          mutants: [
            { mutatorName: "EqualityOperator", status: "Survived", location: {} },
            {
              mutatorName: "StringLiteral",
              status: "Survived",
              location: { end: { line: 9, column: 2 } },
            },
            {
              mutatorName: "BooleanLiteral",
              status: "Survived",
              location: { start: { column: 4 } },
            },
          ],
        },
      },
    });
    expect(summary.totals.actionable).toBe(3);
    expect(summary.files[0]?.samples.map((sample) => sample.line)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const text = formatTextSummary(summary);
    expect(text).toContain("L? EqualityOperator");
  });
});

describe("formatTextSummary", () => {
  it("renders totals, areas, files, and samples", () => {
    const text = formatTextSummary(buildSurvivorSummary(SAMPLE_REPORT));
    expect(text).toContain("mutation-survivors: 6 mutants");
    expect(text).toContain("actionable (Survived + NoCoverage): 3");
    expect(text).toContain("packages/shared/src/rules: 2 survived, 1 no-coverage");
    expect(text).toContain("packages/shared/src/rules/combat.ts: 2 survived, 0 no-coverage");
    expect(text).toContain("L12 ConditionalExpression -> `true`");
  });

  it("says so when there is nothing actionable", () => {
    const text = formatTextSummary(
      buildSurvivorSummary({ files: { "a.ts": { mutants: [{ status: "Killed" }] } } }),
    );
    expect(text).toContain("no surviving or uncovered mutants");
  });
});

describe("runMutationSurvivors", () => {
  it("reads a report file and exits 0 with a text summary", () => {
    const input = path.join(scratch, "mutation.json");
    writeFileSync(input, JSON.stringify(SAMPLE_REPORT));
    const result = runMutationSurvivors({ argv: ["--input", input] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mutation-survivors: 6 mutants");
  });

  it("emits JSON with --format json", () => {
    const input = path.join(scratch, "mutation.json");
    writeFileSync(input, JSON.stringify(SAMPLE_REPORT));
    const result = runMutationSurvivors({ argv: ["--input", input, "--format", "json"] });
    expect(result.exitCode).toBe(0);
    const parsed: { totals: { actionable: number } } = JSON.parse(result.stdout) as unknown as {
      totals: { actionable: number };
    };
    expect(parsed.totals.actionable).toBe(3);
  });

  it("exits 2 when the report is missing or malformed", () => {
    const missing = runMutationSurvivors({
      argv: ["--input", path.join(scratch, "nope.json")],
    });
    expect(missing.exitCode).toBe(2);
    expect(missing.stdout).toContain("could not read");

    const malformed = path.join(scratch, "bad.json");
    writeFileSync(malformed, "{not json");
    expect(runMutationSurvivors({ argv: ["--input", malformed] }).exitCode).toBe(2);

    const wrongShape = path.join(scratch, "shape.json");
    writeFileSync(wrongShape, JSON.stringify({ files: "nope" }));
    expect(runMutationSurvivors({ argv: ["--input", wrongShape] }).exitCode).toBe(2);
  });

  it("writes the summary to --output when given", () => {
    const input = path.join(scratch, "mutation.json");
    const output = path.join(scratch, "out", "survivors.txt");
    writeFileSync(input, JSON.stringify(SAMPLE_REPORT));
    const result = runMutationSurvivors({ argv: ["--input", input, "--output", output] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`wrote text report to ${output}`);
  });
});
