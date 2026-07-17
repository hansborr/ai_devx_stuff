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
const RULE_ID = "local/no-unbounded-promise-all";
const DYNAMIC_FAN_OUT = [
  "export async function loadAll(items: string[]) {",
  "  return Promise.all(items.map(async (item) => item));",
  "}",
].join("\n");

/** @returns {Promise<{ rules?: Record<string, unknown> }>} */
async function configFor(/** @type {string} */ relPath) {
  const config = await eslint.calculateConfigForFile(resolve(repoRoot, relPath));
  return { rules: config.rules };
}

/** @param {{ rules?: Record<string, unknown> }} config */
function severityOf(config) {
  const entry = config.rules?.[RULE_ID];
  if (Array.isArray(entry)) return entry[0];
  return entry;
}

async function ruleMessagesFor(/** @type {string} */ relPath) {
  const results = await eslint.lintText(DYNAMIC_FAN_OUT, {
    filePath: resolve(repoRoot, relPath),
  });
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === RULE_ID),
  );
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
        expect(severityOf(await configFor(file)), file).toBe(2);
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
        expect(severityOf(await configFor(file)), file).toBeUndefined();
        expect(await ruleMessagesFor(file), file).toHaveLength(0);
      }
    },
  );
});
