import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LintRatchetGitRailAdapter } from "./executable-config.js";
import {
  checkLintRatchetMergeDriver,
  installLintRatchetMergeDriver,
} from "./executable-install.js";

describe("lint-ratchet merge-driver installation", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it("reports stale when installed bytes are current but the package bin cannot resolve", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-unresolved-bin-repo-"));
    roots.push(repoRoot);
    expect(spawnSync("git", ["init", "-q"], { cwd: repoRoot }).status).toBe(0);
    const adapter: LintRatchetGitRailAdapter = {
      baselineFile: "lint-ratchet.baseline.json",
      debtLogFile: "lint-ratchet.debt-log.jsonl",
      executableModuleSpecifier: "./missing-git-rail-executable.ts",
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
      binding: { repoRoot, thirdPartyPluginAllowlist: [] },
      ratchets: [],
    };

    expect(installLintRatchetMergeDriver(adapter, "scripts/lint-ratchet/adapter.ts")).toBe(true);
    expect(checkLintRatchetMergeDriver(adapter, "scripts/lint-ratchet/adapter.ts")).toBe(false);
  });
});
