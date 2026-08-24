import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LintRatchetGitRailAdapter } from "./executable-config.js";
import { postMergeLintRatchetBaseline } from "./executable-operations.js";

describe("postMergeLintRatchetBaseline", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function git(repoRoot: string, args: readonly string[]): void {
    expect(spawnSync("git", args, { cwd: repoRoot }).status).toBe(0);
  }

  function markerPath(repoRoot: string): string {
    return join(repoRoot, ".git", "musi", "lint-ratchet-baseline-postmerge-truth-up-required");
  }

  function writeMarker(repoRoot: string, stamp: string): string {
    const marker = markerPath(repoRoot);
    mkdirSync(join(repoRoot, ".git", "musi"), { recursive: true });
    writeFileSync(marker, `pre-merge-head=${stamp}\n`);
    return marker;
  }

  function makeAdapter(repoRoot: string, checkScript: string): LintRatchetGitRailAdapter {
    return {
      baselineFile: "lint-ratchet.baseline.json",
      debtLogFile: "lint-ratchet.debt-log.jsonl",
      executableModuleSpecifier: "@musi/lint-ratchet/git-rail/executable-cli.js",
      checkBaselineCommand: ["bash", checkScript],
      worseBaselineExitCode: 3,
      workflowVocabulary: {
        updateCommand: "ratchet update",
        regressionUpdateCommand: "ratchet accept",
        debtAcceptanceCommand: "ratchet accept",
        installMergeDriverCommand: "ratchet install-driver",
        restoreBaselineOursCommand: (path: string) => `ratchet restore ${path}`,
        trendAllCommand: "ratchet trend",
      },
      binding: { repoRoot, thirdPartyPluginAllowlist: [] },
      ratchets: [],
    };
  }

  it("skips post-commit truth-up on an ordinary commit without its own marker", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-post-commit-repo-"));
    roots.push(repoRoot);
    const baseline = "lint-ratchet.baseline.json";
    const checkLog = join(repoRoot, "check.log");
    const checkScript = join(repoRoot, "check.sh");
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.name", "Test"]);
    git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    writeFileSync(join(repoRoot, baseline), '{"version":2,"tests":{}}\n');
    writeFileSync(checkScript, `#!/usr/bin/env bash\nprintf 'ran\\n' >${checkLog}\n`);
    git(repoRoot, ["add", baseline]);
    git(repoRoot, ["commit", "-qm", "base"]);
    writeFileSync(join(repoRoot, baseline), '{"version":2,"tests":{"changed":{}}}\n');
    git(repoRoot, ["commit", "-qam", "ordinary baseline edit"]);
    const adapter = makeAdapter(repoRoot, checkScript);

    postMergeLintRatchetBaseline(adapter, "post-commit", true);

    expect(existsSync(checkLog)).toBe(false);
  });

  it("keeps a squash marker until the squash commit can run authoritative truth-up", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-squash-marker-repo-"));
    roots.push(repoRoot);
    const baseline = "lint-ratchet.baseline.json";
    const checkLog = join(repoRoot, "check.log");
    const checkScript = join(repoRoot, "check.sh");
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.name", "Test"]);
    git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    writeFileSync(join(repoRoot, baseline), '{"version":2,"tests":{}}\n');
    writeFileSync(checkScript, `#!/usr/bin/env bash\nprintf 'ran\\n' >>${checkLog}\n`);
    git(repoRoot, ["add", baseline]);
    git(repoRoot, ["commit", "-qm", "base"]);
    const preSquashHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).stdout.trim();
    writeFileSync(join(repoRoot, baseline), '{"version":2,"tests":{"squashed":{}}}\n');
    git(repoRoot, ["add", baseline]);
    const marker = writeMarker(repoRoot, preSquashHead);
    git(repoRoot, ["update-ref", "ORIG_HEAD", preSquashHead]);
    const adapter = makeAdapter(repoRoot, checkScript);

    postMergeLintRatchetBaseline(adapter, "post-merge", false);

    expect(existsSync(marker)).toBe(true);
    expect(existsSync(checkLog)).toBe(false);

    git(repoRoot, ["commit", "-qm", "squashed baseline change"]);
    postMergeLintRatchetBaseline(adapter, "post-commit", true);

    expect(existsSync(marker)).toBe(false);
    expect(existsSync(checkLog)).toBe(true);
  });

  it("discards a genuinely mismatched one-parent marker without running truth-up", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-stale-marker-repo-"));
    roots.push(repoRoot);
    const baseline = "lint-ratchet.baseline.json";
    const checkLog = join(repoRoot, "check.log");
    const checkScript = join(repoRoot, "check.sh");
    git(repoRoot, ["init", "-q", "-b", "main"]);
    git(repoRoot, ["config", "user.name", "Test"]);
    git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    writeFileSync(join(repoRoot, baseline), '{"version":2,"tests":{}}\n');
    writeFileSync(checkScript, `#!/usr/bin/env bash\nprintf 'ran\\n' >${checkLog}\n`);
    git(repoRoot, ["add", baseline]);
    git(repoRoot, ["commit", "-qm", "base"]);
    writeFileSync(join(repoRoot, "ordinary.txt"), "ordinary\n");
    git(repoRoot, ["add", "ordinary.txt"]);
    git(repoRoot, ["commit", "-qm", "ordinary commit"]);
    const marker = writeMarker(repoRoot, "a".repeat(40));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    postMergeLintRatchetBaseline(makeAdapter(repoRoot, checkScript), "post-commit", true);

    expect(existsSync(marker)).toBe(false);
    expect(existsSync(checkLog)).toBe(false);
    expect(error).toHaveBeenCalledWith("post-commit: ignoring stale lint-ratchet truth-up marker");
  });
});
