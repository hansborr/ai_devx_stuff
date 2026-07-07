import { existsSync, rmSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runLintProbeRuleCli } from "./lint-probe-rule.js";
import type { LintRatchetConfig } from "./lint-ratchet/lint-ratchet-config.js";

describe("lint-probe-rule", () => {
  it("writes a single-rule ratchet config and runs ESLint against positional files", () => {
    const writtenRatchets: LintRatchetConfig[] = [];
    let eslintArgs: readonly string[] = [];

    const result = runLintProbeRuleCli({
      argv: ["local/no-llm-artifacts", "scripts/example.ts"],
      runEslint: (args) => {
        eslintArgs = args;
        return 1;
      },
      writeConfig: (ratchet) => {
        writtenRatchets.push(ratchet);
        return "/tmp/lint-probe.mjs";
      },
    });

    expect(result).toEqual({ exitCode: 1, stderr: "", stdout: "" });
    expect(writtenRatchets).toHaveLength(1);
    expect(writtenRatchets[0]).toMatchObject({
      id: "probe/local-no-llm-artifacts",
      ruleId: "local/no-llm-artifacts",
      files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
      mode: "no-new",
      metric: "message-count",
    });
    expect(eslintArgs).toEqual([
      "--no-config-lookup",
      "--no-error-on-unmatched-pattern",
      "--config",
      "/tmp/lint-probe.mjs",
      "scripts/example.ts",
    ]);
  });

  it("supports stdin probes with an explicit filename", () => {
    let eslintArgs: readonly string[] = [];

    const result = runLintProbeRuleCli({
      argv: ["--stdin", "--filename", "scripts/probe.ts", "local/no-llm-artifacts"],
      runEslint: (args) => {
        eslintArgs = args;
        return 0;
      },
      writeConfig: () => "/tmp/lint-probe.mjs",
    });

    expect(result.exitCode).toBe(0);
    expect(eslintArgs).toEqual([
      "--no-config-lookup",
      "--no-error-on-unmatched-pattern",
      "--config",
      "/tmp/lint-probe.mjs",
      "--stdin",
      "--stdin-filename",
      "scripts/probe.ts",
    ]);
  });

  it("writes default probe configs outside the shared ratchet cache and cleans them up", () => {
    let configPath = "";
    let configExistsDuringRun = false;

    const result = runLintProbeRuleCli({
      argv: ["local/no-llm-artifacts", "scripts/example.ts"],
      runEslint: (args) => {
        configPath = String(args[3]);
        configExistsDuringRun = existsSync(configPath);
        return 0;
      },
    });
    const configExistsAfterRun = existsSync(configPath);
    if (configPath.includes("node_modules/.cache/eslint-ratchet")) {
      rmSync(configPath, { force: true });
    }

    expect(result.exitCode).toBe(0);
    expect(configPath).not.toContain("node_modules/.cache/eslint-ratchet");
    expect(configExistsDuringRun).toBe(true);
    expect(configExistsAfterRun).toBe(false);
  });

  it("rejects non-local rule ids and missing probe subjects", () => {
    const nonLocalRule = runLintProbeRuleCli({ argv: ["no-console", "scripts/example.ts"] });

    expect(nonLocalRule.exitCode).toBe(2);
    expect(nonLocalRule.stderr).toContain("rule id must start with local/");

    const missingSubject = runLintProbeRuleCli({ argv: ["local/no-llm-artifacts"] });

    expect(missingSubject.exitCode).toBe(2);
    expect(missingSubject.stderr).toContain("provide at least one file");
  });
});
