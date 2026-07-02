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

const MAP_PATH = "docs/agent_notes/lint-coverage-map.md";
const SAFETY_ACKNOWLEDGED_PATH = "packages/server/prisma/migrations/.safety-acknowledged";
const CLEAN_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/**/*.ts\` | 1 .ts | yes | none | ESLint | none | linted | — |
| \`${MAP_PATH}\` | 1 .md | no | none | Markdown | none | not-code | — |
`;
const METADATA_ONLY_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`${MAP_PATH}\` | 1 .md | no | none | Markdown | none | not-code | — |
`;
const STAGED_DRIFTY_MAP = CLEAN_MAP.replace("`src/**/*.ts`", "`missing/**/*.ts`");
const ESLINT_REACH_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`scripts/codemods/tsconfig.json\` | 1 .json | yes | none | ESLint JSON | none | linted | — |
`;

// A single linted row carrying TWO independent path patterns. Exactly one tracked
// file (tools/reach/managed-a.ts) satisfies all three filter conjuncts in
// collectEslintReachFindings (in-scope && uses-eslint && matches a row pattern):
// - dist/reach/scope-b.ts matches a pattern and uses ESLint but is out-of-scope
//   (generated `dist/` dir), so trackedFileIsInScope is false for it.
// - tools/reach/notes.md matches a pattern and is in-scope but is not an
//   ESLint-managed extension, so trackedFileUsesEslint is false for it.
// Each tracked file matches only ONE of the two patterns, so `.some` and `.every`
// over rowPatterns are distinguishable.
const ESLINT_REACH_FILTER_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/reach/*\` \`dist/reach/*\` | 3 | yes | none | ESLint | none | linted | — |
`;

// Two rows that pin status parsing: line 5 has a multi-part status with
// whitespace around the `+` separator (must still be gated as `linted`), and
// line 6 is `ratcheted`-only (must be skipped by the line-70 `continue`).
const ESLINT_REACH_STATUS_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/multipart/*.ts\` | 1 | yes | none | ESLint | none | linted + ratcheted | — |
| \`tools/ratchetonly/*.ts\` | 1 | no | none | ESLint | none | ratcheted | — |
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

  it("names the map path and the base-dir convention in the unaccounted section", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: FIXTURE_MAP,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "config.json", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("docs/agent_notes/lint-coverage-map.md");
    expect(result.stderr.toLowerCase()).toContain("base dir");
  });

  it("reports migration safety metadata when its claimed map row is removed", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: METADATA_ONLY_MAP,
      trackedFiles: [MAP_PATH, SAFETY_ACKNOWLEDGED_PATH],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toContainEqual({
      kind: "unaccounted-file",
      value: SAFETY_ACKNOWLEDGED_PATH,
    });
    expect(result.stderr).toContain("- packages/server/prisma/migrations:");
    expect(result.stderr).toContain(SAFETY_ACKNOWLEDGED_PATH);
  });

  it("emits ready-to-paste suggestions for unaccounted files under --suggest", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: FIXTURE_MAP,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "config.json", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
      suggest: true,
      eslintReachChecker: () => true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Suggested coverage-map edits");
    expect(result.stderr).toContain("`extra/missing.ts`");
  });

  it("hints to `git add` when a mapped non-glob path exists in the worktree but is untracked", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: CLEAN_MAP.replace("`src/**/*.ts`", "`src/new-file.ts`"),
      trackedFiles: [MAP_PATH],
      worktreeExists: (relPath) => relPath === "src/new-file.ts",
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const stale = result.findings.filter((finding) => finding.kind === "stale-path");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.value).toContain("did you forget to `git add` it?");
    expect(result.stderr).toContain("did you forget to `git add` it?");
  });

  it("does not add the git-add hint for glob patterns or genuinely-missing paths", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: STAGED_DRIFTY_MAP,
      trackedFiles: [MAP_PATH],
      worktreeExists: () => false,
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const stale = result.findings.filter((finding) => finding.kind === "stale-path");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.value).not.toContain("git add");
  });

  it("emits the git-add hint in the integration path when a mapped file is untracked", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "musi-coverage-map-check-"));
    try {
      const mapPath = join(cwd, MAP_PATH);
      mkdirSync(join(cwd, "src"), { recursive: true });
      mkdirSync(join(cwd, "docs/agent_notes"), { recursive: true });
      // A new file added to the map row by exact name, but never `git add`-ed.
      const mapWithNewFile = CLEAN_MAP.replace("`src/**/*.ts`", "`src/added.ts`");
      writeFileSync(join(cwd, "src/added.ts"), "export const added = 1;\n");
      writeFileSync(mapPath, mapWithNewFile);
      git(cwd, ["init", "-q", "-b", "main"]);
      git(cwd, ["add", MAP_PATH]); // stage only the map, not src/added.ts

      const stagedResult = await runLintCoverageMapCheck({ cwd, mapPath, staged: true });
      expect(stagedResult.exitCode).toBe(1);
      // The real worktree-exists probe must fire and produce the actionable hint.
      expect(stagedResult.stderr).toContain("did you forget to `git add` it?");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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

  it("only counts in-scope, ESLint-managed files matching a row pattern in the reach gate", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      // No file resolves an ESLint config, so every file the filter admits is "missing".
      eslintReachChecker: () => false,
      mapText: ESLINT_REACH_FILTER_MAP,
      trackedFiles: ["tools/reach/managed-a.ts", "dist/reach/scope-b.ts", "tools/reach/notes.md"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["eslint-reach-missing"]);
    // Exactly ONE of the three tracked files satisfies all three filter conjuncts,
    // so the row's total (the `M` in `N of M`) is 1, and it names that file.
    // - dist/reach/scope-b.ts excluded by trackedFileIsInScope (out-of-scope dir)
    // - tools/reach/notes.md excluded by trackedFileUsesEslint (.md is not ESLint-managed)
    expect(result.stderr).toContain(
      "line 5: 1 of 1 ESLint-managed file(s) have no ESLint config (e.g. `tools/reach/managed-a.ts`)",
    );
    expect(result.stderr).not.toContain("dist/reach/scope-b.ts");
    expect(result.stderr).not.toContain("tools/reach/notes.md");
    // 2 of 2 / 3 of 3 would mean a conjunct flipped to constant-true or `&&`→`||`
    // admitted the out-of-scope or non-ESLint file.
    expect(result.stderr).not.toContain("of 2 ESLint-managed");
    expect(result.stderr).not.toContain("of 3 ESLint-managed");
  });

  it("gates a multi-part `linted` status but skips a non-`linted` row in the reach gate", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      eslintReachChecker: () => false,
      mapText: ESLINT_REACH_STATUS_MAP,
      trackedFiles: ["tools/multipart/a.ts", "tools/ratchetonly/b.ts"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    // Only the `linted + ratcheted` row (line 5) is gated; the `ratcheted`-only
    // row (line 6) is skipped, so there is exactly one reach finding for line 5.
    const reach = result.findings.filter((finding) => finding.kind === "eslint-reach-missing");
    expect(reach).toHaveLength(1);
    expect(reach[0]?.line).toBe(5);
    // The whitespace-padded `linted + ratcheted` part is trimmed before the
    // `linted` membership check, so the row is still processed and names its file.
    expect(result.stderr).toContain(
      "line 5: 1 of 1 ESLint-managed file(s) have no ESLint config (e.g. `tools/multipart/a.ts`)",
    );
    // The `ratcheted`-only row must not emit a reach finding; its file is never reported.
    expect(result.stderr).not.toContain("line 6:");
    expect(result.stderr).not.toContain("tools/ratchetonly/b.ts");
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
