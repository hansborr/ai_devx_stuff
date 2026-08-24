import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  makeFixture,
  perTestTmpRepo,
  runLintRatchet,
  stageFixtureFiles,
  writeDebugSource,
  writeDebugSourceAt,
  writeExplicitAnySource,
} from "./output-fixture.test-helper.js";

describe("lint ratchet propose mode", () => {
  it(
    "prints a would-be baseline without writing the committed baseline",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      writeDebugSourceAt(fixtureRoot, "packages/app/src/untracked.ts");

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "no-debugger",
        "packages/app/src/**/*.ts",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("lint:ratchet:propose no-debugger OK");
      expect(result.stdout).toContain("file globs: packages/app/src/**/*.ts");
      expect(result.stdout).toContain(
        "ignore globs: **/dist/**, **/generated/**, **/node_modules/**",
      );
      expect(result.stdout).toContain("metric: message-count");
      expect(result.stdout).toContain("rule options: []");
      expect(result.stdout).toContain("files with findings: 1");
      expect(result.stdout).toContain("total findings: 1");
      expect(result.stdout).toContain("top files:");
      expect(result.stdout).toContain("packages/app/src/example.ts: 1");
      expect(result.stdout).not.toContain("packages/app/src/untracked.ts");
      expect(result.stdout).toContain('"ratchet/propose"');
      expect(result.stdout).toContain('"ruleId": "no-debugger"');
      expect(result.stdout).toContain("ratchet/propose id, configHash, and ruleSourceHash");
      // Observes where the CLI writes; existsSync follows symlinks, so the emission lstat guard pins isolation.
      expect(existsSync(join(fixtureRoot, "node_modules/.cache/eslint-ratchet/configs"))).toBe(
        true,
      );
      expect(existsSync(join(fixtureRoot, "lint-ratchet.baseline.json"))).toBe(false);
    },
  );

  it(
    "applies propose ignore flags before collecting tracked files",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "no-debugger",
        "packages/app/src/**/*.ts",
        "--ignore",
        "packages/app/src/example.ts",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("ignore globs:");
      expect(result.stdout).toContain("packages/app/src/example.ts");
      expect(result.stdout).toContain("files with findings: 0");
      expect(result.stdout).toContain("total findings: 0");
    },
  );

  it(
    "infers an allowlisted third-party module and emits a promotable config",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture(perTestTmpRepo, {
        thirdPartyPluginAllowlist: [
          {
            pluginModule: "typescript-eslint",
            ruleNamespace: "@typescript-eslint",
            pluginExport: "plugin",
          },
        ],
      });
      writeExplicitAnySource(fixtureRoot);
      stageFixtureFiles(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "@typescript-eslint/no-explicit-any",
        "packages/app/src/**/*.ts",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("source: third-party");
      expect(result.stdout).toContain("total findings: 1");
      expect(result.stdout).toContain(
        'source: { kind: "third-party", pluginModule: "typescript-eslint" }',
      );
      expect(result.stdout).not.toContain("required governance addition");
    },
  );

  it(
    "collects with a synthesized allowlist entry and prints the required governance change",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();
      writeExplicitAnySource(fixtureRoot);
      stageFixtureFiles(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "@typescript-eslint/no-explicit-any",
        "packages/app/src/**/*.ts",
        "--plugin=typescript-eslint",
        "--plugin-export",
        "plugin",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("total findings: 1");
      expect(result.stdout).toContain("required governance addition");
      expect(result.stdout).toContain('ruleNamespace: "@typescript-eslint"');
      expect(result.stdout).toContain('pluginExport: "plugin"');
    },
  );

  it(
    "reports a bad plugin export as an actionable configuration error",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "vitest/no-focused-tests",
        "packages/app/src/**/*.ts",
        "--plugin",
        "@vitest/eslint-plugin",
        "--plugin-export",
        "plugin",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "--plugin-export plugin did not resolve a usable plugin object",
      );
      expect(result.stderr).not.toContain("TypeError:");
    },
  );

  it(
    "suggests the named plugin export when the default export carries no rules",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();

      const result = await runLintRatchet(fixtureRoot, [
        "--propose",
        "@typescript-eslint/no-explicit-any",
        "packages/app/src/**/*.ts",
        "--plugin",
        "typescript-eslint",
        "--plugin-export",
        "default",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "--plugin-export default did not resolve a usable plugin object from typescript-eslint",
      );
      expect(result.stderr).toContain("use --plugin-export plugin");
    },
  );

  it("rejects a rule the selected plugin object does not define", { timeout: 15_000 }, async () => {
    const fixtureRoot = makeFixture();

    const result = await runLintRatchet(fixtureRoot, [
      "--propose",
      "@typescript-eslint/no-such-rule",
      "packages/app/src/**/*.ts",
      "--plugin",
      "typescript-eslint",
      "--plugin-export",
      "plugin",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "typescript-eslint does not define @typescript-eslint/no-such-rule",
    );
    expect(result.stderr).toContain("verify the rule id");
  });
});
