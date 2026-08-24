// @ts-check

import { describe, expect, it } from "vitest";

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { resolvedConfigFor } from "./repo-config-harness.js";
import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-retired-parse-success-import.js";

const ruleTester = makeRuleTester();

describe("no-retired-parse-success-import", () => {
  it(
    "is enabled through the repository flat config",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await resolvedConfigFor("packages/shared/src/schemas/auth.test.ts");

      expect(config?.rules?.["local/no-retired-parse-success-import"]?.[0]).toBe(2);
    },
  );

  it("restricts only the retired named import from parse helpers", () => {
    ruleTester.run("no-retired-parse-success-import", rule, {
      valid: [
        `import { expectParseResultSuccess } from "../test/parse-helpers.js";`,
        `import { expectSchemaParseSuccess } from "@musi/shared/test/parse-helpers.js";`,
        `import { expectParseSuccess } from "./unrelated-helpers.js";`,
        `import parseHelpers from "../test/parse-helpers.js";`,
        `export { expectParseResultSuccess } from "../test/parse-helpers.js";`,
        `export { expectSchemaParseSuccess } from "@musi/shared/test/parse-helpers.js";`,
        `export { expectParseSuccess } from "./unrelated-helpers.js";`,
        `export { expectParseSuccess };`,
      ],
      invalid: [
        {
          code: `import { expectParseSuccess } from "../test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `import { expectParseSuccess as expectOkay } from "../../test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `import { expectParseSuccess } from "@musi/shared/test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `import { expectParseSuccess } from "./parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `export { expectParseSuccess } from "../test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `export { expectParseSuccess as expectOkay } from "../../test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `export { expectParseSuccess } from "@musi/shared/test/parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
        {
          code: `export { expectParseSuccess } from "./parse-helpers.js";`,
          errors: [{ messageId: "retired" }],
        },
      ],
    });
  });
});
