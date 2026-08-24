// @ts-check

import { describe, expect, it } from "vitest";

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { configFor, lintTextFor, messagesFor, severityOf } from "./repo-config-harness.js";

const RULE_ID = "local/no-unbounded-promise-all";
const DYNAMIC_FAN_OUT = [
  "export async function loadAll(items: string[]) {",
  "  return Promise.all(items.map(async (item) => item));",
  "}",
].join("\n");

/** @param {{ rules?: Record<string, unknown> }} config */
function ruleSeverityOf(config) {
  return severityOf(config, RULE_ID);
}

async function ruleMessagesFor(/** @type {string} */ relPath) {
  return messagesFor(await lintTextFor(relPath, DYNAMIC_FAN_OUT), RULE_ID);
}

describe("no-unbounded-promise-all config", () => {
  it(
    "hard-errors in server production code",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.ts",
        "packages/server/prisma/seed.ts",
        "packages/server/scripts/pgexec.ts",
      ]) {
        expect(ruleSeverityOf(await configFor(file)), file).toBe(2);
        expect(await ruleMessagesFor(file), file).toHaveLength(1);
      }
    },
  );

  it(
    "does not apply to server tests or client code",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.test.ts",
        "packages/client/src/lib/api-base.ts",
      ]) {
        expect(ruleSeverityOf(await configFor(file)), file).toBeUndefined();
        expect(await ruleMessagesFor(file), file).toHaveLength(0);
      }
    },
  );
});
