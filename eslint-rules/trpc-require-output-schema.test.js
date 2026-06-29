// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./trpc-require-output-schema.js";

const ruleTester = makeRuleTester();

describe("trpc-require-output-schema", () => {
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
      ],
    });
  });
});
