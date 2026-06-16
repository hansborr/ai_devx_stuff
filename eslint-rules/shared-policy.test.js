// @ts-check
import { describe, expect, it } from "vitest";

import {
  codemodTestFiles,
  configFileReincludePatterns,
  rootConfigReincludePatterns,
  scriptFixtureIgnores,
  scriptProjectIgnores,
  scriptTestAssertFunctionNames,
  scriptTypeScriptFiles,
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

  it("reincludes scripts/vitest.config.ts only for the config-file policy", () => {
    expect(configFileReincludePatterns).toEqual([
      ...rootConfigReincludePatterns,
      "!scripts/vitest.config.ts",
    ]);
    expect(scriptProjectIgnores).toContain("scripts/vitest.config.ts");
  });

  it("single-sources the script test assert-function allowlist", () => {
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
