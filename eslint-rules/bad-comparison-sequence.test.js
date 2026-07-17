// @ts-check
import { describe, it } from "vitest";

import rule from "./bad-comparison-sequence.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();
const typedRuleTester = makeRuleTester({
  projectService: {
    allowDefaultProject: ["bad-comparison-sequence-fixture.ts"],
    defaultProject: "../tsconfig.json",
  },
  tsconfigRootDir: import.meta.dirname,
});
const typedFilename = "bad-comparison-sequence-fixture.ts";

describe("bad-comparison-sequence", () => {
  it("reports comparisons that reuse an intermediate boolean result", () => {
    ruleTester.run("bad-comparison-sequence", rule, {
      valid: [
        { code: "if (0 <= ratio && ratio <= 1) accept(ratio);" },
        { code: "const isIncreasing = (start < end) === true;" },
        { code: "const isDifferent = (left !== right) !== false;" },
        { code: "const total = a + b + c;" },
      ],
      invalid: [
        {
          code: "if (0 <= ratio <= 1) accept(ratio);",
          errors: [{ messageId: "badComparisonSequence" }],
        },
        {
          code: "const inside = min < value < max;",
          errors: [{ messageId: "badComparisonSequence" }],
        },
        {
          code: "if (a === b === c) sync();",
          errors: [{ messageId: "badComparisonSequence" }],
        },
        {
          code: "const isSmall = (0 < count) < 10;",
          errors: [{ messageId: "badComparisonSequence" }],
        },
      ],
    });

    typedRuleTester.run("bad-comparison-sequence", rule, {
      valid: [
        {
          code: "declare const start: number, end: number, expectedBoolean: boolean; const matches = (start < end) === expectedBoolean;",
          filename: typedFilename,
        },
      ],
      invalid: [
        {
          code: "declare const start: number, end: number, count: number; const matches = (start < end) === count;",
          filename: typedFilename,
          errors: [{ messageId: "badComparisonSequence" }],
        },
      ],
    });
  });
});
