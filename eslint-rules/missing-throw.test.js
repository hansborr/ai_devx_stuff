// @ts-check
import { describe, it } from "vitest";

import rule from "./missing-throw.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

describe("missing-throw", () => {
  it("reports discarded built-in Error constructions and inserts throw", () => {
    ruleTester.run("missing-throw", rule, {
      valid: [
        { code: "function fail() { throw new Error('boom'); }" },
        { code: "const makeError = () => new Error('boom');" },
        { code: "const error = new Error('boom');" },
        { code: "[new Error('boom')];" },
        {
          code: "function fail(Error: new (message: string) => unknown) { new Error('boom'); }",
        },
        {
          code: "function fail(Error: (message: string) => unknown) { Error('boom'); }",
        },
        {
          code: "function fail() { class TypeError { constructor(message: string) { console.info(message); } } new TypeError('bad type'); }",
        },
      ],
      invalid: [
        {
          code: "function fail() { new Error('boom'); }",
          output: "function fail() { throw new Error('boom'); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { new TypeError('bad type'); }",
          output: "function fail() { throw new TypeError('bad type'); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { Error('boom'); }",
          output: "function fail() { throw Error('boom'); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { TypeError('bad type'); }",
          output: "function fail() { throw TypeError('bad type'); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail(errors: Error[]) { new AggregateError(errors, 'boom'); }",
          output: "function fail(errors: Error[]) { throw new AggregateError(errors, 'boom'); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { new Error('boom') as Error; }",
          output: "function fail() { throw new Error('boom') as Error; }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { new Error('boom')!; }",
          output: "function fail() { throw new Error('boom')!; }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { (new Error('boom')); }",
          output: "function fail() { throw (new Error('boom')); }",
          errors: [{ messageId: "missingThrow" }],
        },
        {
          code: "function fail() { <Error>new Error('boom'); }",
          output: "function fail() { throw <Error>new Error('boom'); }",
          errors: [{ messageId: "missingThrow" }],
        },
      ],
    });
  });
});
