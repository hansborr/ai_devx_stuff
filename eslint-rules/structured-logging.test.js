// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./structured-logging.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("structured-logging", () => {
  it("runs", () => {
    ruleTester.run("structured-logging", rule, {
      valid: [
        // Static-string messages on every Pino level.
        { code: "server.log.error({ err }, 'failed')" },
        { code: "ctx.req.server.log.warn({ id }, 'failed')" },
        { code: "params.log.info('ok')" },
        { code: "params.log.debug('debug')" },
        { code: "params.log.fatal('fatal')" },
        { code: "params.log.trace('trace')" },
        // Template literal with no expressions is still a static message.
        { code: "params.log.info(`ok`)" },
        // Error/TRPCError constructors are explicitly out of scope.
        { code: "throw new Error(`failed for ${id}`)" },
        { code: "throw new TRPCError({ message: `failed for ${id}` })" },
        // Non-Pino calls — `.log()` (no level) and `.info()` (no `.log`).
        { code: "logger.info(`with ${value}`)" },
        { code: "log(`with ${value}`)" },
        // Bare console (not a `.log.<level>` chain).
        { code: "console.log(`with ${value}`)" },
      ],
      invalid: [
        // Template literal with expressions on a Pino level.
        {
          code: "server.log.error(`failed for ${id}`)",
          errors: [{ messageId: "noTemplate" }],
        },
        // Deeper accessor (`ctx.req.server.log.<level>`).
        {
          code: "ctx.req.server.log.warn(`failed for ${id}`)",
          errors: [{ messageId: "noTemplate" }],
        },
        // String concatenation as the message.
        {
          code: "server.log.info('hit ' + count)",
          errors: [{ messageId: "noConcat" }],
        },
        // Concatenation in second arg (after metadata) is also flagged —
        // the rule scans all args.
        {
          code: "server.log.info({ id }, 'hit ' + count)",
          errors: [{ messageId: "noConcat" }],
        },
      ],
    });
  });
});
