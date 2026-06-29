// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./structured-logging.js";

const ruleTester = makeRuleTester();

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
        { code: "server.log.info({ event: 'socket.connected', count })" },
        // Template literal with no expressions is still a static message.
        { code: "params.log.info(`ok`)" },
        // Error/TRPCError constructors are explicitly out of scope.
        { code: "throw new Error(`failed for ${id}`)" },
        { code: "throw new TRPCError({ message: `failed for ${id}` })" },
        // Non-Pino calls — `.log()` (no level) and `.info()` (no `.log`).
        { code: "logger.info({ value: `with ${value}`, text: 'hit ' + count }, 'ok')" },
        { code: "logger.info(payload)" },
        { code: "ctx.logger?.warn({ id }, 'ok')" },
        { code: "log(`with ${value}`)" },
        // Direct console is allowed only in the adapter and startup failure path.
        {
          code: "console.error('Failed to start server:', error)",
          filename: "/repo/packages/server/src/main.ts",
        },
        {
          code: "console.log(JSON.stringify({ event: 'script.progress' }))",
          filename: "/repo/packages/server/src/utils/script-logger.ts",
        },
        {
          code: "import { createScriptLogger } from '../utils/script-logger.js';",
          filename: "/repo/packages/server/src/seed/seed-srd.ts",
        },
        {
          code: "import { createScriptLogger } from '../src/utils/script-logger.js';",
          filename: "/repo/packages/server/scripts/maintenance.ts",
        },
        {
          code: "import { createScriptLogger } from '../src/utils/script-logger.js';",
          filename: "/repo/packages/server/prisma/seed.ts",
        },
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
        // Dynamic message variables fragment log aggregation just like direct
        // interpolation. Values belong in metadata fields.
        {
          code: "server.log.info({ id }, message)",
          errors: [{ messageId: "noDynamic" }],
        },
        {
          code: "server.log.warn(message)",
          errors: [{ messageId: "noDynamic" }],
        },
        // The repo's request/script logger wrappers follow the same
        // static-message convention even though they expose `.info/.warn/.error`
        // directly instead of through Pino's `.log`.
        {
          code: "logger.info({}, `hit ${count}`)",
          errors: [{ messageId: "noTemplate" }],
        },
        {
          code: "ctx.logger?.warn({ id }, 'hit ' + count)",
          errors: [{ messageId: "noConcat" }],
        },
        {
          code: "logger.info({ id }, message)",
          errors: [{ messageId: "noDynamic" }],
        },
        {
          code: "ctx.logger?.warn({ id }, message)",
          errors: [{ messageId: "noDynamic" }],
        },
        // Direct console calls are rejected where structured logging is required.
        {
          code: "console.log('seeded')",
          filename: "/repo/packages/server/src/seed/seed-srd.ts",
          errors: [
            {
              message:
                "Why: Direct console calls bypass structured logging fields, request context, and log formatting. How to fix: Use structured logging instead, or run `bun run codemod:structured-logging-fix -- <file>`.",
            },
          ],
        },
        {
          code: "console.warn('runtime issue')",
          filename: "/repo/packages/server/src/routers/map.ts",
          errors: [{ messageId: "noConsole" }],
        },
        {
          code: "console['error']('seed failed', error)",
          filename: "/repo/packages/server/prisma/seed.ts",
          errors: [{ messageId: "noConsole" }],
        },
        {
          code: "console.log('not startup failure')",
          filename: "/repo/packages/server/src/main.ts",
          errors: [{ messageId: "noConsole" }],
        },
        {
          code: "console.error('Some other startup-adjacent failure:', error)",
          filename: "/repo/packages/server/src/main.ts",
          errors: [{ messageId: "noConsole" }],
        },
        {
          code: "import { createScriptLogger } from '../utils/script-logger.js';",
          filename: "/repo/packages/server/src/routers/map.ts",
          errors: [{ messageId: "noScriptLoggerImport" }],
        },
        {
          code: "import { createScriptLogger as makeLogger } from './script-logger.js';",
          filename: "/repo/packages/server/src/utils/runtime-helper.ts",
          errors: [{ messageId: "noScriptLoggerImport" }],
        },
      ],
    });
  });
});
