// @ts-check

import { describe, expect, it } from "vitest";

import { createRepoCodeQualityConfigs } from "../eslint-config/code-quality-configs.js";
import { createTsConfigFileConfigs } from "../eslint-config/config-file-configs.js";
import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { eslint, repoRoot } from "./repo-config-harness.js";

const explicitReturnTypeRuleId = "@typescript-eslint/explicit-function-return-type";
const pluginProbeFiles = ["packages/shared/src/rules/combat.ts", "knip.config.ts"];

/** @param {readonly unknown[]} configs */
function configsWithExplicitReturnTypeRule(configs) {
  return configs.filter((config) => {
    if (config === null || typeof config !== "object") return false;
    const rules = /** @type {{ rules?: Record<string, unknown> }} */ (config).rules;
    return rules?.[explicitReturnTypeRuleId] !== undefined;
  });
}

/** @param {unknown} config */
function hasTypescriptEslintPlugin(config) {
  if (config === null || typeof config !== "object") return false;
  const plugins = /** @type {{ plugins?: Record<string, unknown> }} */ (config).plugins;
  return plugins?.["@typescript-eslint"] !== undefined;
}

describe("ESLint flat config plugin declarations", () => {
  it("declares @typescript-eslint where repo configs set explicit return types", () => {
    const localPlugin = { rules: {} };
    const configs = [
      ...createRepoCodeQualityConfigs(repoRoot, localPlugin),
      ...createTsConfigFileConfigs(repoRoot),
    ];

    const explicitReturnTypeConfigs = configsWithExplicitReturnTypeRule(configs);

    expect(explicitReturnTypeConfigs).toHaveLength(2);
    for (const config of explicitReturnTypeConfigs) {
      expect(hasTypescriptEslintPlugin(config)).toBe(true);
    }
  });

  it(
    "loads plugin-backed rule configs while linting representative files",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      await expect(eslint.lintFiles(pluginProbeFiles)).resolves.toEqual(expect.any(Array));
    },
  );
});
