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
async function configFor(/** @type {string} */ filePath) {
  const config = await eslint.calculateConfigForFile(filePath);
  return { rules: config.rules };
}

/** @param {{ rules?: Record<string, unknown> }} config */
function severityOf(config, /** @type {string} */ ruleId) {
  const entry = config.rules?.[ruleId];
  if (Array.isArray(entry)) return entry[0];
  return entry;
}

describe("e2e selector lint config", () => {
  it(
    "keeps selector rules enabled on clean e2e files",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor(resolve(repoRoot, "e2e/auth-refresh.spec.ts"));

      expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(2);
      expect(severityOf(config, "playwright/no-nth-methods")).toBe(2);
      expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
      expect(severityOf(config, "playwright/no-raw-locators")).toBeUndefined();
    },
  );

  // The selector debt drain (lint-followups-2026-06 leaves 03a-03f) removed
  // every debt-file override set, so formerly ratcheted files must get the
  // same unconditional error severities as born-clean files.
  for (const drainedFile of [
    "e2e/helpers/auth.setup.ts",
    "e2e/campaign-chat.spec.ts",
    "e2e/homebrew-sharing.spec.ts",
    "e2e/navigation-errors.spec.ts",
  ]) {
    it(
      `keeps selector rules at error on drained debt file ${drainedFile}`,
      { timeout: resolvedConfigTestTimeoutMs },
      async () => {
        const config = await configFor(resolve(repoRoot, drainedFile));

        expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(2);
        expect(severityOf(config, "playwright/no-nth-methods")).toBe(2);
        expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
      },
    );
  }
});
