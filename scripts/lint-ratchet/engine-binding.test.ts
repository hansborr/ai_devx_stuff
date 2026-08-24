import { describe, expect, it } from "vitest";

import { lintRatchetGitRailAdapter, musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";

describe("Musi lint-ratchet workflow vocabulary", () => {
  it("pins the persisted and displayed command spellings byte-for-byte", () => {
    expect({
      updateCommand: musiLintRatchetWorkflowVocabulary.updateCommand,
      regressionUpdateCommand: musiLintRatchetWorkflowVocabulary.regressionUpdateCommand,
      debtAcceptanceCommand: musiLintRatchetWorkflowVocabulary.debtAcceptanceCommand,
      installMergeDriverCommand: musiLintRatchetWorkflowVocabulary.installMergeDriverCommand,
      trendAllCommand: musiLintRatchetWorkflowVocabulary.trendAllCommand,
    }).toEqual({
      updateCommand: "bun run lint:ratchet:update",
      regressionUpdateCommand:
        'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"',
      debtAcceptanceCommand: 'bun run lint:ratchet:update -- --allow-worse --reason "<why>"',
      installMergeDriverCommand: "bun run lint:ratchet:install-merge-driver",
      trendAllCommand: "bun run lint:ratchet:trend -- --all",
    });
    expect(
      musiLintRatchetWorkflowVocabulary.restoreBaselineOursCommand("lint-ratchet.baseline.json"),
    ).toBe("bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json");
  });

  it("pins Musi's concrete package git-rail data binding", () => {
    expect({
      baselineFile: lintRatchetGitRailAdapter.baselineFile,
      debtLogFile: lintRatchetGitRailAdapter.debtLogFile,
      executableModuleSpecifier: lintRatchetGitRailAdapter.executableModuleSpecifier,
      checkBaselineCommand: lintRatchetGitRailAdapter.checkBaselineCommand,
      worseBaselineExitCode: lintRatchetGitRailAdapter.worseBaselineExitCode,
    }).toEqual({
      baselineFile: "lint-ratchet.baseline.json",
      debtLogFile: "lint-ratchet.debt-log.jsonl",
      executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
      checkBaselineCommand: ["bun", "run", "lint:ratchet:check-baseline"],
      worseBaselineExitCode: 3,
    });
  });
});
