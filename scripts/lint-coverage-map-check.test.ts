import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runLintCoverageMapCheck } from "./lint-coverage-map-check.js";

const FIXTURE_MAP = `# Fixture

## Scripts

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/**/*.ts\` | 1 .ts | yes | \`ratchet/known\` | ESLint | none | linted + ratcheted | — |
| \`docs/stale.md\` | 1 .md | no | none | — | none | not-code | — |
| \`scripts/tool.ts\` | 1 .ts | no | \`ratchet/missing\` | ESLint | none | proposed | — |
| \`config.json\` | 1 .json | yes | none | JSON | none | maybe-linted | — |
`;

const MAP_PATH = "docs/agent_notes/backlog/lint-followups/lint-coverage-map.md";
const CLEAN_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/**/*.ts\` | 1 .ts | yes | none | ESLint | none | linted | — |
| \`${MAP_PATH}\` | 1 .md | no | none | Markdown | none | not-code | — |
`;
const STAGED_DRIFTY_MAP = CLEAN_MAP.replace("`src/**/*.ts`", "`missing/**/*.ts`");
const ESLINT_REACH_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`scripts/codemods/tsconfig.json\` | 1 .json | yes | none | ESLint JSON | none | linted | — |
`;

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("runLintCoverageMapCheck", () => {
  it("reports stale paths, unknown ratchets, invalid statuses, and unaccounted files", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: FIXTURE_MAP,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "config.json", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "stale-path",
      "unknown-ratchet",
      "invalid-status",
      "unaccounted-file",
    ]);
    expect(result.stderr).toContain("`docs/stale.md`");
    expect(result.stderr).toContain("ratchet/missing");
    expect(result.stderr).toContain("maybe-linted");
    expect(result.stderr).toContain("- extra:");
    expect(result.stderr).toContain("extra/missing.ts");
  });

  it("can check the staged coverage map instead of the clean worktree map", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "musi-coverage-map-check-"));
    try {
      const mapPath = join(cwd, MAP_PATH);
      mkdirSync(join(cwd, "src"), { recursive: true });
      mkdirSync(join(cwd, "docs/agent_notes/backlog/lint-followups"), { recursive: true });
      writeFileSync(join(cwd, "src/index.ts"), "export const value = 1;\n");
      writeFileSync(mapPath, STAGED_DRIFTY_MAP);
      git(cwd, ["init", "-q", "-b", "main"]);
      git(cwd, ["add", "."]);
      writeFileSync(mapPath, CLEAN_MAP);

      const stagedResult = await runLintCoverageMapCheck({ cwd, mapPath, staged: true });
      expect(stagedResult.exitCode).toBe(1);
      expect(stagedResult.stderr).toContain("`missing/**/*.ts`");

      const worktreeResult = await runLintCoverageMapCheck({ cwd, mapPath });
      expect(worktreeResult.exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports linted rows whose files do not resolve an ESLint config", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      eslintReachChecker: (file) => file !== "scripts/codemods/tsconfig.json",
      mapText: ESLINT_REACH_MAP,
      trackedFiles: ["scripts/codemods/tsconfig.json"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["eslint-reach-missing"]);
    expect(result.stderr).toContain("ESLint reach gaps:");
    expect(result.stderr).toContain("line 5: 1 of 1 ESLint-managed file(s) have no ESLint config");
    expect(result.stderr).toContain("scripts/codemods/tsconfig.json");
  });

  it("skips the ESLint reach gate in staged mode", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      eslintReachChecker: () => false,
      mapText: ESLINT_REACH_MAP,
      staged: true,
      trackedFiles: ["scripts/codemods/tsconfig.json"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });
});
