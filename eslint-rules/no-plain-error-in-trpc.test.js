// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-plain-error-in-trpc.js";

const ruleTester = makeRuleTester();

describe("no-plain-error-in-trpc", () => {
  it("blocks direct plain Error throws in tRPC-adjacent surfaces", () => {
    ruleTester.run("no-plain-error-in-trpc", rule, {
      valid: [
        {
          code: 'throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid input" });',
        },
        {
          code: "throw err;",
        },
        {
          code: 'throw new UploadValidationError("File is empty");',
        },
        {
          code: 'return new Error("not thrown");',
        },
        {
          code: 'throw errorFor("not the built-in Error constructor");',
        },
      ],
      invalid: [
        {
          code: 'throw new Error("Map not found");',
          errors: [{ messageId: "plainError" }],
        },
        {
          code: 'throw Error("Map not found");',
          errors: [{ messageId: "plainError" }],
        },
      ],
    });
  });
});
