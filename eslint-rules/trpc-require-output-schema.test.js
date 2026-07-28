// @ts-check
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./trpc-require-output-schema.js";

const ruleTester = makeRuleTester();

describe("trpc-require-output-schema", () => {
  it("names the shared-schema boundary decision", () => {
    expect(rule.meta.messages.missingOutput).toContain("ADR-0004");
  });

  it("requires output schemas on tRPC query and mutation chains", () => {
    ruleTester.run("trpc-require-output-schema", rule, {
      valid: [
        {
          code: "protectedProcedure.output(resultSchema).query(async () => value);",
        },
        {
          code: "protectedProcedure.input(inputSchema).output(resultSchema).mutation(async () => value);",
        },
        {
          code: "publicProcedure.use(middleware).input(inputSchema).output(resultSchema).query(() => value);",
        },
        {
          code: [
            "const authed = protectedProcedure.input(inputSchema).output(resultSchema);",
            "authed.query(async () => value);",
          ].join("\n"),
        },
        {
          code: [
            "const base = protectedProcedure.input(inputSchema);",
            "base.output(resultSchema).mutation(async () => value);",
          ].join("\n"),
        },
        {
          code: [
            "import { authed } from './procedures.js';",
            "authed.query(async () => value);",
          ].join("\n"),
        },
        {
          // A *Procedure-named alias must resolve through its initializer
          // before the name heuristic: the pre-applied .output counts.
          code: [
            "const orgProcedure = protectedProcedure.output(resultSchema);",
            "orgProcedure.query(async () => value);",
          ].join("\n"),
        },
        {
          code: "queryClient.invalidateQueries(queryOptions);",
        },
        {
          code: "builder.mutation(() => value);",
        },
      ],
      invalid: [
        {
          code: "protectedProcedure.input(inputSchema).query(async () => value);",
          errors: [{ messageId: "missingOutput" }],
        },
        {
          code: "publicProcedure.mutation(async () => true);",
          errors: [{ messageId: "missingOutput" }],
        },
        {
          code: "campaignProcedure.input(inputSchema).mutation(async () => value);",
          errors: [{ messageId: "missingOutput" }],
        },
        {
          code: [
            "const authed = protectedProcedure.input(inputSchema);",
            "authed.query(async () => value);",
          ].join("\n"),
          errors: [{ messageId: "missingOutput" }],
        },
        {
          // Control for the alias-before-name-heuristic path: a *Procedure
          // alias whose initializer never applies .output stays flagged.
          code: [
            "const orgProcedure = protectedProcedure.input(inputSchema);",
            "orgProcedure.query(async () => value);",
          ].join("\n"),
          errors: [{ messageId: "missingOutput" }],
        },
        {
          code: [
            "const base = protectedProcedure.input(inputSchema);",
            "const authed = base.use(middleware);",
            "authed.mutation(async () => value);",
          ].join("\n"),
          errors: [{ messageId: "missingOutput" }],
        },
        {
          code: [
            "const authed = protectedProcedure.input(inputSchema);",
            "authed.query(async () => value);",
            "authed.output(resultSchema).mutation(async () => value);",
          ].join("\n"),
          errors: [{ messageId: "missingOutput" }],
        },
      ],
    });
  });
});
