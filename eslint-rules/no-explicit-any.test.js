// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-explicit-any.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("no-explicit-any", () => {
  it("reports any with repair guidance", () => {
    ruleTester.run("no-explicit-any", rule, {
      valid: [
        { code: "const value: unknown = input;" },
        { code: "type Payload = { id: string; value: number };" },
        {
          code: [
            "// eslint-disable-next-line rule-to-test/no-explicit-any -- framework callback payload is intentionally untyped here",
            "const value: any = input;",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          code: "const value: any = input;",
          errors: [
            {
              message:
                /Do not add noisy types just to satisfy lint\. If `any` is the clearer boundary, suppress this exact line with `\/\/ eslint-disable-next-line local\/no-explicit-any -- <why this boundary is intentionally untyped>`\./u,
            },
          ],
        },
        {
          code: "function parse(value: any): any { return value; }",
          errors: [{ messageId: "noAny" }, { messageId: "noAny" }],
        },
        {
          code: "type Items = Array<any>;",
          errors: [{ messageId: "noAny" }],
        },
      ],
    });
  });
});
