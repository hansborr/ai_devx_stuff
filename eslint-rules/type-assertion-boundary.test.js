// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./type-assertion-boundary.js";

const nonTestFilename = "packages/server/src/services/foo.ts";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("type-assertion-boundary", () => {
  it("requires boundary comments for non-test type assertions", () => {
    ruleTester.run("type-assertion-boundary", rule, {
      valid: [
        {
          code: "const x = value as const;",
          filename: nonTestFilename,
        },
        {
          code: "const x = { count: 5 } as const;",
          filename: nonTestFilename,
        },
        {
          code: "const x = value as Foo;",
          filename: "packages/server/src/services/foo.test.ts",
        },
        {
          code: "const x = value as Foo;",
          filename: "packages/server/src/services/foo.test-helper.ts",
        },
        {
          code: "const x = value as Foo;",
          filename: "e2e/foo.spec.ts",
        },
        {
          code: [
            "const x = JSON.parse(raw) as Report; // type-assertion-boundary: json - parsed persisted report payload",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/** type-assertion-boundary: framework - jsdoc accepted */",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/**",
            " * type-assertion-boundary: framework - multi-line jsdoc accepted",
            " */",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: framework - fastify request body validated by zod handler schema",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: prisma - include shape is fixed by local query helper",
            "const campaign = result as CampaignWithCharacters;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: test - partial mock intentionally covers only this branch",
            "const fake = value as MockedService;",
          ].join("\n"),
          filename: "packages/server/src/services/test-support.ts",
        },
        {
          code: [
            "/* type-assertion-boundary: framework - inline before cast */ const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "/** type-assertion-boundary: framework - jsdoc inline before cast */ const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: framework - prettier inserted a blank line",
            "",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          code: [
            "// type-assertion-boundary: interop - upstream package omits stable runtime field",
            "const event = value as LibraryEvent;",
          ].join("\n"),
          filename: nonTestFilename,
        },
        {
          // Reviewer judgment catches vague reasons; the rule only requires a non-empty reason.
          code: [
            "// type-assertion-boundary: framework - make TS happy",
            "const body = req.body as LoginInput;",
          ].join("\n"),
          filename: nonTestFilename,
        },
      ],
      invalid: [
        {
          code: "const x = value as Foo;",
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: [
            "// type-assertion-boundary: convenience - I hate types",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "invalidCategory" }],
        },
        {
          code: [
            "// type-assertion-boundary: framework -   ",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "emptyReason" }],
        },
        {
          code: [
            "// type-assertion-boundary: framework - request body",
            'console.log("interrupt");',
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: [
            "// type-assertion-boundary: framework - too far away",
            "",
            "",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          // Line comments must not accept a `*` prefix (that shape is JSDoc-only).
          code: [
            "// * type-assertion-boundary: framework - stray asterisk in line comment",
            "const x = value as Foo;",
          ].join("\n"),
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
        {
          code: "const x = <Foo>value;",
          filename: nonTestFilename,
          errors: [{ messageId: "missingBoundary" }],
        },
      ],
    });
  });
});
