// @ts-check
import { describe, it } from "vitest";

import rule from "./bad-min-max-func.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

describe("bad-min-max-func", () => {
  it("reports nested clamps whose inverted bounds force a constant", () => {
    ruleTester.run("bad-min-max-func", rule, {
      valid: [
        { code: "const clamped = Math.min(Math.max(value, 0), 100);" },
        { code: "const clamped = Math.max(Math.min(value, 100), 0);" },
        { code: "const fixed = Math.min(Math.max(value, 100), 100);" },
        { code: "const clamped = Math.min(Math.max(value, lower), upper);" },
        { code: "const clamped = Math.min(Math.max(value, getLower()), 100);" },
        { code: "const clamped = Math.min(Math.max(value, 100), 0, other);" },
        { code: "const clamped = Math.min(Math.max(value, 100, other), 0);" },
        { code: "const clamped = min(max(value, 100), 0);" },
        {
          code: "function clamp(Math: { min(left: number, right: number): number; max(left: number, right: number): number }, value: number) { return Math.min(Math.max(value, 100), 0); }",
        },
      ],
      invalid: [
        {
          code: "const clamped = Math.min(Math.max(100, value), 0);",
          errors: [{ messageId: "badMinMaxFunc" }],
        },
        {
          code: "const clamped = Math.min(Math.max(value, 100), 0);",
          errors: [{ messageId: "badMinMaxFunc" }],
        },
        {
          code: "const clamped = Math.max(Math.min(value, 0), 100);",
          errors: [{ messageId: "badMinMaxFunc" }],
        },
        {
          code: "const clamped = Math.max(Math.min(value, -1.5), 0);",
          errors: [{ messageId: "badMinMaxFunc" }],
        },
      ],
    });
  });
});
