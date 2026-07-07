// @ts-check

import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ratchetRestrictedDisableRuleIds } from "../eslint-config/ratchet-restricted-disable-rules.generated.js";
import { restrictedDisableRuleIds } from "../eslint-config/rule-groups.js";
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

/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedDisableOptions(config) {
  const entry = config.rules?.["eslint-comments/no-restricted-disable"];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1).filter((value) => typeof value === "string");
}

async function lintTextFor(/** @type {string} */ relPath, /** @type {string} */ code) {
  return eslint.lintText(code, { filePath: resolve(repoRoot, relPath) });
}

describe("eslint-comments restricted disable fence", () => {
  it(
    "resolves every ratcheted rule id plus the manual hard-fence rules",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/services/auth-service.ts");
      const restrictedOptions = restrictedDisableOptions(config);

      expect(severityOf(config, "eslint-comments/no-restricted-disable")).toBe(2);
      expect(restrictedOptions).toStrictEqual(restrictedDisableRuleIds);
      for (const ruleId of ratchetRestrictedDisableRuleIds) {
        expect(restrictedOptions, ruleId).toContain(ruleId);
      }
      for (const ruleId of [
        "local/concurrency-guard",
        "local/no-broadcast-in-transaction",
        "local/no-outer-client-in-transaction",
        "no-restricted-syntax",
      ]) {
        expect(restrictedOptions, ruleId).toContain(ruleId);
      }
    },
  );

  it(
    "reports inline disables for generated ratchet rule ids that normal lint also enables",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const [result] = await lintTextFor(
        "packages/server/src/services/auth-service.ts",
        [
          "// eslint-disable-next-line no-restricted-syntax -- fixture must be fenced",
          "process.exit(1);",
          "",
        ].join("\n"),
      );

      expect(
        result?.messages.some(
          (message) => message.ruleId === "eslint-comments/no-restricted-disable",
        ),
      ).toBe(true);
    },
  );

  it(
    "reports inline disables for manual hard-fence rule ids",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const [result] = await lintTextFor(
        "packages/server/src/services/auth-service.ts",
        [
          "// eslint-disable-next-line local/concurrency-guard -- fixture must be fenced",
          "export const value = 1;",
          "",
        ].join("\n"),
      );

      expect(
        result?.messages.some(
          (message) => message.ruleId === "eslint-comments/no-restricted-disable",
        ),
      ).toBe(true);
    },
  );
});
