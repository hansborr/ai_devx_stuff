// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./test-file-location.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("test-file-location", () => {
  it("runs", () => {
    ruleTester.run("test-file-location", rule, {
      valid: [
        // Properly named .test.ts with a describe/it block.
        {
          filename: "packages/server/src/foo.test.ts",
          code: "describe('foo', () => { it('works', () => {}); });",
        },
        // .test.tsx with a bare test() call.
        {
          filename: "packages/client/src/foo.test.tsx",
          code: "test('works', () => {});",
        },
        // Non-e2e .spec.ts files use the scripts test convention.
        {
          filename: "scripts/code-intel/overview-query.spec.ts",
          code: "describe('overview', () => { it('works', () => {}); });",
        },
        // describe.each(...) and it.skip(...) member-expression callees count.
        {
          filename: "packages/server/src/foo.test.ts",
          code: "describe.each([1])('x', () => { it.skip('y', () => {}); });",
        },
        // Non-test files are out of scope entirely.
        {
          filename: "packages/server/src/foo.ts",
          code: "export const x = 1;",
        },
        // Playwright specs stay out of scope.
        {
          filename: "e2e/foo.spec.ts",
          code: "test('e2e', () => {});",
        },
      ],
      invalid: [
        // .test.ts with no feature prefix — must point to colocated naming guidance.
        {
          filename: "packages/server/src/.test.ts",
          code: "it('works', () => {});",
          errors: [{ message: /Rename to `<feature>\.test\.ts`/u }],
        },
        // .spec.ts also needs a feature prefix when it is a non-e2e test file.
        {
          filename: "scripts/code-intel/.spec.ts",
          code: "it('works', () => {});",
          errors: [{ message: /Rename to `<feature>\.test\.ts`/u }],
        },
        // .test.ts with only setup/teardown hooks — must flag missingTests.
        {
          filename: "packages/server/src/setup.test.ts",
          code: "beforeEach(() => {}); afterEach(() => {});",
          errors: [{ message: /helpers belong outside the test-file naming/u }],
        },
        // .spec.ts with only setup/teardown hooks — must flag missingTests.
        {
          filename: "scripts/code-intel/setup.spec.ts",
          code: "beforeEach(() => {}); afterEach(() => {});",
          errors: [{ messageId: "missingTests" }],
        },
        // .test.ts with no test blocks at all.
        {
          filename: "packages/server/src/empty.test.ts",
          code: "export const x = 1;",
          errors: [{ messageId: "missingTests" }],
        },
        // Bare assertions don't count.
        {
          filename: "packages/server/src/bare.test.ts",
          code: "expect(1).toBe(1);",
          errors: [{ messageId: "missingTests" }],
        },
      ],
    });
  });
});
