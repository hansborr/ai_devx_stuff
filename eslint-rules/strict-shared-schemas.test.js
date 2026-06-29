// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./strict-shared-schemas.js";

const ruleTester = makeRuleTester();

describe("strict-shared-schemas", () => {
  it("runs", () => {
    ruleTester.run("strict-shared-schemas", rule, {
      valid: [
        // Strict at end of chain.
        {
          code: "export const FooInputSchema = z.object({ id: z.string() }).strict();",
        },
        // Passthrough at end of chain.
        {
          code: "export const FooInputSchema = z.object({ id: z.string() }).passthrough();",
        },
        // z.strictObject counts as already-strict.
        {
          code: "export const FooInputSchema = z.strictObject({ id: z.string() });",
        },
        // Non-*InputSchema names: rule should ignore.
        {
          code: "export const FooSchema = z.object({ id: z.string() });",
        },
        // Non-object root — out of scope.
        {
          code: "export const FooInputSchema = z.union([z.string(), z.number()]);",
        },
        // Extending an identifier — out of scope (inherits behavior).
        {
          code: "export const FooInputSchema = BaseSchema.extend({ id: z.string() });",
        },
      ],
      invalid: [
        // Bare z.object — must flag and autofix to .strict().
        {
          code: "export const FooInputSchema = z.object({ id: z.string() });",
          errors: [{ messageId: "needsExplicit" }],
          output: "export const FooInputSchema = z.object({ id: z.string() }).strict();",
        },
        // .strict() then .strip() — strip wins, must flag.
        {
          code: "export const FooInputSchema = z.object({ id: z.string() }).strict().strip();",
          errors: [{ messageId: "needsExplicit" }],
        },
        // .strict() then .catchall() — catchall wins, must flag.
        {
          code: "export const FooInputSchema = z.object({ id: z.string() }).strict().catchall(z.unknown());",
          errors: [{ messageId: "needsExplicit" }],
        },
        // Chained but no mode call at all — autofix inserts `.strict()`
        // immediately after `z.object(...)` so the trailing `.describe()`
        // doesn't override it.
        {
          code: "export const FooInputSchema = z.object({ id: z.string() }).describe('x');",
          errors: [{ messageId: "needsExplicit" }],
          output:
            "export const FooInputSchema = z.object({ id: z.string() }).strict().describe('x');",
        },
      ],
    });
  });
});
