// @ts-check

import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});

/** @returns {Promise<{ rules?: Record<string, unknown> }>} */
async function configFor(/** @type {string} */ relPath) {
  const config = await eslint.calculateConfigForFile(resolve(repoRoot, relPath));
  return { rules: config.rules };
}

/** @param {{ rules?: Record<string, unknown> }} config */
function severityOf(config, /** @type {string} */ ruleId) {
  const entry = config.rules?.[ruleId];
  if (Array.isArray(entry)) return entry[0];
  return entry;
}

async function lintTextFor(/** @type {string} */ relPath, /** @type {string} */ code) {
  return eslint.lintText(code, { filePath: resolve(repoRoot, relPath) });
}

/**
 * @param {Awaited<ReturnType<typeof lintTextFor>>} results
 * @param {string} ruleId
 */
function messagesFor(results, ruleId) {
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === ruleId),
  );
}

describe("eval-family security fences", () => {
  it(
    "enables every eval-family rule as an error across maintained code",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.ts",
        "packages/server/src/services/auth-service.test.ts",
        "packages/client/src/lib/api-base.ts",
        "scripts/drift-ai.ts",
        "eslint-rules/no-barrel.js",
      ]) {
        const config = await configFor(file);
        for (const ruleId of ["no-eval", "no-implied-eval", "no-new-func"]) {
          expect(severityOf(config, ruleId), `${file} must enable ${ruleId}`).toBe(2);
        }
      }
    },
  );

  it(
    "reports direct eval, string timers, and Function construction",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const file = "packages/server/src/services/auth-service.ts";
      const probes = [
        { ruleId: "no-eval", code: 'eval("2 + 2");' },
        {
          ruleId: "no-implied-eval",
          code: 'globalThis.setTimeout("runTask()", 10);',
        },
        { ruleId: "no-new-func", code: 'const buildValue = new Function("return 1");' },
      ];

      for (const probe of probes) {
        const messages = messagesFor(await lintTextFor(file, probe.code), probe.ruleId);
        expect(messages, probe.ruleId).toHaveLength(1);
      }
    },
  );
});

describe("server weak-randomness security fence", () => {
  it(
    "reports Math.random in server production code with a crypto alternative",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.ts",
        "packages/server/prisma/seed.ts",
        "packages/server/prisma/seed-template.ts",
        "packages/server/scripts/pgexec.ts",
      ]) {
        const messages = messagesFor(
          await lintTextFor(file, "export const inviteToken = Math.random().toString(36);"),
          "no-restricted-properties",
        );

        expect(messages, file).toHaveLength(1);
        expect(messages[0]?.message, file).toMatch(/crypto\.(randomBytes|randomUUID)/u);
      }
    },
  );

  it(
    "allows Math.random in server tests and helpers",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.test.ts",
        "packages/server/src/test/prepare-test-db.ts",
        "packages/server/src/services/level-up/level-up-test-helper.ts",
        "packages/server/src/utils/__type-tests__/character-stats-restrictions.ts",
      ]) {
        const messages = messagesFor(
          await lintTextFor(file, "export const randomValue = Math.random();"),
          "no-restricted-properties",
        );
        expect(messages, file).toHaveLength(0);
      }
    },
  );
});
