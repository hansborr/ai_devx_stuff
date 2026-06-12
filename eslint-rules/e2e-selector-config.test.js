// @ts-check

import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});
const resolvedConfigTestTimeoutMs = 15_000;

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

  it(
    "limits local selector suppression to ratcheted raw-locator debt files",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor(resolve(repoRoot, "e2e/helpers/auth.setup.ts"));

      expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(0);
      expect(severityOf(config, "playwright/no-nth-methods")).toBe(2);
      expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
    },
  );

  it(
    "limits no-nth-methods suppression to ratcheted nth debt files",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor(resolve(repoRoot, "e2e/campaign-chat.spec.ts"));

      expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(2);
      expect(severityOf(config, "playwright/no-nth-methods")).toBe(0);
      expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
    },
  );

  it(
    "can suppress all ratcheted selector rules on files with all three debt kinds",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor(resolve(repoRoot, "e2e/page-objects/spells-panel.po.ts"));

      expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(0);
      expect(severityOf(config, "playwright/no-nth-methods")).toBe(0);
      expect(severityOf(config, "playwright/prefer-native-locators")).toBe(0);
    },
  );
});
