// @ts-check
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-swallowed-errors.js";

const ruleTester = makeRuleTester();

describe("no-swallowed-errors", () => {
  it("reports catch blocks that only log to console and continue", () => {
    ruleTester.run("no-swallowed-errors", rule, {
      valid: [
        { code: "try { doWork(); } catch (error) { throw error; }" },
        {
          code: "try { doWork(); } catch (error) { throw new Error('Failed to sync', { cause: error }); }",
          filename: "scripts/sync-worker.ts",
        },
        {
          code: "try { doWork(); } catch (error) { throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: error }); }",
          filename: "packages/server/src/routers/sync.ts",
        },
        {
          code: "try { doWork(); } catch (error) { return Result.err(error); }",
        },
        { code: "try { doWork(); } catch (error) { return { ok: false, error }; }" },
        { code: "try { doWork(); } catch (error) { logger.error({ error }, 'Failed'); }" },
        { code: "try { doWork(); } catch (error) { handleError(error); }" },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch (error) {}",
          errors: [{ messageId: "emptyCatch" }],
        },
        {
          code: "try { doWork(); } catch (error) { ; }",
          errors: [{ messageId: "emptyCatch" }],
        },
        {
          code: [
            "try {",
            "  doWork();",
            "} catch {",
            "  // Best effort cleanup; failure is intentionally ignored.",
            "}",
          ].join("\n"),
          errors: [{ messageId: "emptyCatch" }],
        },
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
        {
          code: "try { doWork(); } catch (error) { console['error'](error); }",
          errors: [{ messageId: "swallowedError" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.warn(error); return null; }",
          errors: [{ messageId: "loggedFallback" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); throw error; }",
          errors: [{ messageId: "loggedRethrow" }],
        },
      ],
    });
  });

  it("supports independent hard-error and ratchet adoption", () => {
    const hardErrorOptions = {
      checkEmptyCatch: false,
      checkLoggedFallback: false,
    };
    ruleTester.run("no-swallowed-errors-hard-errors", rule, {
      valid: [
        { code: "try { doWork(); } catch {}", options: [hardErrorOptions] },
        {
          code: "try { doWork(); } catch (error) { console.warn(error); return null; }",
          options: [hardErrorOptions],
        },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch (error) { console.error(error); throw error; }",
          options: [hardErrorOptions],
          errors: [{ messageId: "loggedRethrow" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); }",
          options: [hardErrorOptions],
          errors: [{ messageId: "swallowedError" }],
        },
      ],
    });

    const ratchetOptions = {
      checkLoggedRethrow: false,
      checkSwallowedError: false,
    };
    ruleTester.run("no-swallowed-errors-ratchet", rule, {
      valid: [
        {
          code: "try { doWork(); } catch (error) { console.error(error); throw error; }",
          options: [ratchetOptions],
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); }",
          options: [ratchetOptions],
        },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch {}",
          options: [ratchetOptions],
          errors: [{ messageId: "emptyCatch" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.warn(error); return null; }",
          options: [ratchetOptions],
          errors: [{ messageId: "loggedFallback" }],
        },
      ],
    });
  });

  it("requires caught-error flow and preserves explicit failure signals", () => {
    ruleTester.run("no-swallowed-errors-error-flow", rule, {
      valid: [
        {
          code: "try { connect(); } catch (error) { console.error(error); return false; }",
        },
        {
          code: "try { connect(); } catch (error) { console.error(error); return Promise.reject(error); }",
        },
        {
          code: "try { connect(); } catch (error) { console.warn('database unavailable'); return false; }",
        },
        {
          code: "try { connect(); } catch (error) { console.warn('using cached value'); return null; }",
        },
        {
          code: "try { connect(); } catch (error) { console.error(error); throw new Error('retry limit reached'); }",
        },
        {
          code: [
            "try { connect(); } catch (error) {",
            "  const message = error instanceof Error ? error.message : String(error);",
            "  console.error('database unavailable', message);",
            "  return false;",
            "}",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          code: [
            "try { connect(); } catch (error) {",
            "  const message = error instanceof Error ? error.message : String(error);",
            "  console.error('database unavailable', message);",
            "  return null;",
            "}",
          ].join("\n"),
          errors: [{ messageId: "loggedFallback" }],
        },
        {
          code: [
            "try { connect(); } catch (error) {",
            "  const failure = new Error('connect failed', { cause: error });",
            "  console.error(failure);",
            "  throw failure;",
            "}",
          ].join("\n"),
          errors: [{ messageId: "loggedRethrow" }],
        },
      ],
    });
  });

  it("finds logged error semantics through nested catch statements", () => {
    ruleTester.run("no-swallowed-errors-nested-statements", rule, {
      valid: [
        {
          code: "try { doWork(); } catch (error) { const report = () => console.error(error); return null; }",
        },
        {
          code: "try { doWork(); } catch (error) { function report() { console.error(error); } return null; }",
        },
        {
          code: "try { doWork(); } catch (error) { console[method](error); throw error; }",
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); if (failed) return false; recover(); }",
        },
        {
          code: "try { doWork(); } catch (error) { if (error instanceof KnownError) { console.error(error); process.exitCode = 1; return; } throw error; }",
        },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch (error) { if (debug) console.error(error); throw error; }",
          errors: [{ messageId: "loggedRethrow" }],
        },
        {
          code: "try { doWork(); } catch (error) { console.error(error); if (recoverable) return null; recover(); }",
          errors: [{ messageId: "loggedFallback" }],
        },
        {
          code: "try { doWork(); } catch (error) { console['error'](error); throw error; }",
          errors: [{ messageId: "loggedRethrow" }],
        },
        {
          code: "try { doWork(); } catch (error) { if (debug) console['warn']({ error }); return undefined; }",
          errors: [{ messageId: "loggedFallback" }],
        },
      ],
    });
  });

  it("treats no-op expression statements as empty catches", () => {
    ruleTester.run("no-swallowed-errors-no-op-catches", rule, {
      valid: [
        { code: "try { doWork(); } catch (error) { void cleanup(error); }" },
        { code: "try { doWork(); } catch (error) { 0; cleanup(error); }" },
      ],
      invalid: [
        {
          code: "try { doWork(); } catch (error) { void error; }",
          errors: [{ messageId: "emptyCatch" }],
        },
        {
          code: "try { doWork(); } catch { 0; 'ignored'; }",
          errors: [{ messageId: "emptyCatch" }],
        },
        {
          code: "try { doWork(); } catch (error) { error; undefined; }",
          errors: [{ messageId: "emptyCatch" }],
        },
      ],
    });
  });

  it("steers repairs to Musi error conventions", () => {
    for (const message of Object.values(rule.meta.messages)) {
      expect(message).toContain("coded `TRPCError`");
      expect(message).toContain("docs/authorization.md");
      expect(message).not.toContain("Rethrow with `cause`");
      expect(message).not.toContain("return an explicit failure value");
    }
  });
});
