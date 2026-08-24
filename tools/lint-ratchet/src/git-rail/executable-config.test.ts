import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { lintRatchetGitRailAdapterSchema, repoRelativeAdapterPath } from "./executable-config.js";

describe("lint-ratchet git-rail adapter", () => {
  it("accepts the package-owned rail seam and preserves executable argv", () => {
    const adapter = lintRatchetGitRailAdapterSchema.parse({
      baselineFile: "lint-ratchet.baseline.json",
      debtLogFile: "lint-ratchet.debt-log.jsonl",
      executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
      checkBaselineCommand: ["bun", "run", "lint:ratchet:check-baseline"],
      worseBaselineExitCode: 3,
      workflowVocabulary: {
        updateCommand: "bun run lint:ratchet:update",
        regressionUpdateCommand: "bun run lint:ratchet:update -- --allow-worse",
        debtAcceptanceCommand: "bun run lint:ratchet:update -- --allow-worse",
        installMergeDriverCommand: "bun run lint:ratchet:install-merge-driver",
        restoreBaselineOursCommand: () => "bun run baseline:restore-stage -- --ours",
        trendAllCommand: "bun run lint:ratchet:trend -- --all",
      },
      binding: { repoRoot: "/repo", thirdPartyPluginAllowlist: [] },
      ratchets: [],
    });

    expect(adapter.checkBaselineCommand).toEqual(["bun", "run", "lint:ratchet:check-baseline"]);
  });

  it("requires the adapter module to live inside its repository", () => {
    expect(repoRelativeAdapterPath("/repo", resolve("/repo/scripts/adapter.ts"))).toBe(
      "scripts/adapter.ts",
    );
    expect(() => repoRelativeAdapterPath("/repo", "/outside/adapter.ts")).toThrow(
      "adapter module must be inside the repository",
    );
  });

  it.each([
    "baseline file.json",
    "baseline[attr].json",
    "baseline\\name.json",
    "./lint-ratchet.baseline.json",
    "config/./lint-ratchet.baseline.json",
  ])("rejects a baseline path Git attributes would parse ambiguously: %s", (baselineFile) => {
    expect(() =>
      lintRatchetGitRailAdapterSchema.parse({
        baselineFile,
        debtLogFile: "lint-ratchet.debt-log.jsonl",
        executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
        checkBaselineCommand: ["bun", "run", "lint:ratchet:check-baseline"],
        worseBaselineExitCode: 3,
        workflowVocabulary: {
          updateCommand: "ratchet update",
          regressionUpdateCommand: "ratchet accept",
          debtAcceptanceCommand: "ratchet accept",
          installMergeDriverCommand: "ratchet install",
          restoreBaselineOursCommand: () => "ratchet restore",
          trendAllCommand: "ratchet trend",
        },
        binding: { repoRoot: "/repo", thirdPartyPluginAllowlist: [] },
        ratchets: [],
      }),
    ).toThrow("invalid lint-ratchet git-rail adapter");
  });
});
