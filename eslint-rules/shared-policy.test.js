// @ts-check
import { describe, expect, it } from "vitest";

import {
  codeFiles,
  configSurfaceEntries,
  codemodTestFiles,
  configFileReincludePatterns,
  eslintRulesConfigReincludePatterns,
  jsTsLintableExtensions,
  rootAndPackageTsConfigFiles,
  rootConfigReincludePatterns,
  rootJsConfigFiles,
  scriptFixtureIgnores,
  scriptProjectIgnores,
  scriptTestAssertFunctionNames,
  scriptTypeScriptFiles,
  tsConfigFiles,
  typescriptFiles,
} from "../eslint-config/shared-policy.js";
import { unitTestConfigs } from "../eslint-config/test-configs.js";
import { lintRatchets } from "../scripts/lint-ratchet/lint-ratchet-config.ts";

function getAssertFunctionNamesFromRule(rule) {
  if (
    !Array.isArray(rule) ||
    typeof rule[1] !== "object" ||
    rule[1] === null ||
    !("assertFunctionNames" in rule[1])
  ) {
    throw new Error("expected vitest/expect-expect rule options");
  }
  return rule[1].assertFunctionNames;
}

function getAssertFunctionNamesFromRatchetOptions(ruleOptions) {
  const firstOption = ruleOptions[0];
  if (
    typeof firstOption !== "object" ||
    firstOption === null ||
    !("assertFunctionNames" in firstOption)
  ) {
    throw new Error("expected ratchet assertFunctionNames options");
  }
  return firstOption.assertFunctionNames;
}

describe("shared lint policy", () => {
  it("derives JS/TS lint file globs from one canonical extension set", () => {
    expect(jsTsLintableExtensions).toEqual([
      ".js",
      ".jsx",
      ".cjs",
      ".mjs",
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
    ]);
    expect(codeFiles).toEqual(["**/*.{js,jsx,cjs,mjs,ts,tsx,mts,cts}"]);
    expect(typescriptFiles).toEqual(["**/*.{ts,tsx,mts,cts}"]);
  });

  it("derives maintained config file lists from the config surface manifest", () => {
    expect(rootJsConfigFiles).toEqual([
      "eslint.config.js",
      "commitlint.config.js",
      "stryker.config.mjs",
      "stryker.config.server.mjs",
      "stryker.shared.mjs",
      "scripts/stryker-scripts.mjs",
      "tools/stryker-lint-ratchet.mjs",
    ]);
    expect(rootAndPackageTsConfigFiles).toEqual([
      "knip.config.ts",
      "playwright.config.ts",
      "vitest.config.ts",
      "vitest.slow.config.ts",
      "packages/client/vite.config.ts",
      "packages/client/vitest.config.ts",
      "packages/server/prisma.config.ts",
      "packages/server/vitest.config.ts",
      "packages/server/vitest.mutation.config.ts",
      "packages/server/vitest.unit.config.ts",
      "packages/shared/vitest.config.ts",
      "tools/lint-ratchet/vitest.config.ts",
    ]);
    expect(tsConfigFiles).toEqual([
      ...rootAndPackageTsConfigFiles,
      "scripts/vitest.config.ts",
      "eslint-rules/vitest.config.ts",
    ]);
    expect(configSurfaceEntries.map((entry) => entry.path)).toEqual([
      ...rootJsConfigFiles,
      ...tsConfigFiles,
    ]);
  });

  it("lints script TypeScript by default through the scripts project", () => {
    expect(scriptTypeScriptFiles).toEqual(["scripts/**/*.ts"]);
  });

  it("keeps script fixtures outside the type-aware scripts project", () => {
    expect(scriptFixtureIgnores).toEqual([
      "scripts/codemods/fixtures/**",
      "scripts/drift-ai/fixtures/**",
      "scripts/fixtures/**",
      "scripts/harness-audit/fixtures/**",
      "scripts/logs-audit/fixtures/**",
    ]);
    expect(scriptProjectIgnores).toEqual([...scriptFixtureIgnores, "scripts/vitest.config.ts"]);
  });

  it("reincludes non-root config files at their matching ignore boundary", () => {
    expect(configFileReincludePatterns).toEqual([
      ...rootConfigReincludePatterns,
      "!scripts/vitest.config.ts",
    ]);
    expect(eslintRulesConfigReincludePatterns).toEqual(["!eslint-rules/vitest.config.ts"]);
    expect(scriptProjectIgnores).toContain("scripts/vitest.config.ts");
  });

  it("single-sources the script test assert-function allowlist", () => {
    expect(scriptTestAssertFunctionNames).toContain("expectParseResultSuccess");
    expect(scriptTestAssertFunctionNames).toContain("expectSchemaParseSuccess");
    expect(scriptTestAssertFunctionNames).not.toContain("expectParseSuccess");

    const normalVitestConfig = unitTestConfigs.find(
      (config) => config.plugins?.["vitest"] !== undefined,
    );
    if (normalVitestConfig === undefined) throw new Error("expected normal Vitest test config");

    const codemodTestConfig = unitTestConfigs.find((config) => config.files === codemodTestFiles);
    if (codemodTestConfig === undefined) throw new Error("expected codemod Vitest test config");

    const scriptTestRatchet = lintRatchets.find(
      (ratchet) => ratchet.id === "ratchet/vitest-expect-expect-script-tests",
    );
    if (scriptTestRatchet === undefined)
      throw new Error("expected script test expect-expect ratchet");

    expect(getAssertFunctionNamesFromRule(normalVitestConfig.rules?.["vitest/expect-expect"])).toBe(
      scriptTestAssertFunctionNames,
    );
    expect(getAssertFunctionNamesFromRatchetOptions(scriptTestRatchet.ruleOptions)).toBe(
      scriptTestAssertFunctionNames,
    );
    expect(
      getAssertFunctionNamesFromRule(codemodTestConfig.rules?.["vitest/expect-expect"]),
    ).toEqual([...scriptTestAssertFunctionNames, "runFixture"]);
  });

  it("scopes redundant central mock checks to client unit tests", () => {
    const redundantCentralMockConfig = unitTestConfigs.find(
      (config) => config.rules?.["local/no-redundant-central-mock"] !== undefined,
    );
    if (redundantCentralMockConfig === undefined)
      throw new Error("expected redundant central mock config");

    expect(redundantCentralMockConfig.files).toEqual([
      "packages/client/src/**/*.test.{ts,tsx}",
      "packages/client/src/**/*.spec.ts",
    ]);
  });
});
