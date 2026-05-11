// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-swallowed-errors.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("no-swallowed-errors", () => {
  it("reports catch blocks that only log to console and continue", () => {
    ruleTester.run("no-swallowed-errors", rule, {
      valid: [
        { code: "try { doWork(); } catch (error) {}" },
        { code: "try { doWork(); } catch (error) { ; }" },
        { code: "try { doWork(); } catch (error) { throw error; }" },
        {
          code: "try { doWork(); } catch (error) { throw new Error('Failed to sync', { cause: error }); }",
        },
        { code: "try { doWork(); } catch (error) { return { ok: false, error }; }" },
        { code: "try { doWork(); } catch (error) { logger.error({ error }, 'Failed'); }" },
        { code: "try { doWork(); } catch (error) { handleError(error); }" },
        {
          code: "try { doWork(); } catch (error) { console.error(error); throw error; }",
        },
        {
          code: "try { doWork(); } catch (error) { console.warn(error); return null; }",
        },
        {
          code: "try { doWork(); } catch (error) { console['error'](error); }",
        },
        {
          code: [
            "try {",
            "  doWork();",
            "} catch {",
            "  // Best effort cleanup; failure is intentionally ignored.",
            "}",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch (error) { console.log(error); }",
          errors: [{ messageId: "swallowedError" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.error('Failed', error); }",
          errors: [{ messageId: "swallowedError" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.warn(error); console.debug(error); }",
          errors: [{ messageId: "swallowedError" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); ; }",
          errors: [{ messageId: "swallowedError" }],
        },
      ],
    });
  });
});
