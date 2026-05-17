// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./strict-trpc-input.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("strict-trpc-input", () => {
  it("runs", () => {
    ruleTester.run("strict-trpc-input", rule, {
      valid: [
        // Inline z.object with .strict() at the end.
        { code: "p.input(z.object({ id: z.string() }).strict())" },
        // Strict at the end of a longer chain.
        {
          code: "p.input(z.object({ id: z.string() }).describe('x').strict())",
        },
        // Named identifier — out of scope, rule must stay silent.
        { code: "p.input(SomeNamedSchema)" },
        // Non-object root (union, etc.) — out of scope.
        { code: "p.input(z.union([z.string(), z.number()]))" },
        // Discriminated union — out of scope.
        {
          code: "p.input(z.discriminatedUnion('kind', [z.object({ kind: z.literal('a') })]))",
        },
        // .input() with no args.
        { code: "p.input()" },
        // strictObject is its own form; not yet supported by this rule but
        // also not what it targets — confirm it stays silent on non-z.object.
        { code: "p.input(z.strictObject({ id: z.string() }))" },
      ],
      invalid: [
        // Bare z.object.
        {
          code: "p.input(z.object({ id: z.string() }))",
          errors: [{ message: /docs\/guides\/add-trpc-procedure\.md/u }],
        },
        // Chained but no mode call.
        {
          code: "p.input(z.object({ id: z.string() }).describe('x'))",
          errors: [{ messageId: "needsStrict" }],
        },
        // .strict() then .passthrough() — passthrough wins, must flag.
        {
          code: "p.input(z.object({ id: z.string() }).strict().passthrough())",
          errors: [{ messageId: "needsStrict" }],
        },
        // .strict() then .strip() — strip wins, must flag.
        {
          code: "p.input(z.object({ id: z.string() }).strict().strip())",
          errors: [{ messageId: "needsStrict" }],
        },
        // .strict() then .catchall() — catchall wins, must flag.
        {
          code: "p.input(z.object({ id: z.string() }).strict().catchall(z.unknown()))",
          errors: [{ messageId: "needsStrict" }],
        },
        // Bare passthrough.
        {
          code: "p.input(z.object({ id: z.string() }).passthrough())",
          errors: [{ messageId: "needsStrict" }],
        },
      ],
    });
  });
});
