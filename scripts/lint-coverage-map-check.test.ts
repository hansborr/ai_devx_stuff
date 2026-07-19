import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseCliArgs, runLintCoverageMapCheck } from "./lint-coverage-map-check.js";
import { loadTrackedFiles } from "./lint-coverage-map-check-io.js";

const FIXTURE_MAP = `# Fixture

## Scripts

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/**/*.ts\` | 1 .ts | yes | \`ratchet/known\` | ESLint | none | linted + ratcheted | — |
| \`docs/stale.md\` | 1 .md | no | none | — | none | not-code | — |
| \`scripts/tool.ts\` | 1 .ts | no | \`ratchet/missing\` | ESLint | none | proposed | — |
| \`config.json\` | 1 .json | yes | none | JSON | none | maybe-linted | — |
`;

const MAP_PATH = "docs/generated/lint-coverage-map.md";
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

// A single linted row carrying TWO independent path patterns. Both spans are
// rooted full paths (tools/ and packages/ are repository roots), so neither
// establishes a base dir that would prefix the other. Exactly one tracked file
// (tools/reach/managed-a.ts) satisfies all three filter conjuncts in
// collectEslintReachFindings (in-scope && uses-eslint && matches a row pattern):
// - packages/reach/dist/scope-b.ts matches a pattern and uses ESLint but is
//   out-of-scope (generated `dist/` dir), so trackedFileIsInScope is false for it.
// - tools/reach/notes.md matches a pattern and is in-scope but is not an
//   ESLint-managed extension, so trackedFileUsesEslint is false for it.
// Each tracked file matches only ONE of the two patterns, so `.some` and `.every`
// over rowPatterns are distinguishable.
const ESLINT_REACH_FILTER_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/reach/*\` \`packages/reach/dist/*\` | 3 | yes | none | ESLint | none | linted | — |
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
// A4: the `Normal lint` column must agree with the status token. Line 5 claims
// `yes` but its status omits `linted`; line 6 claims `no` but its status asserts
// `linted`. Line 7 is internally consistent (`yes` ⇔ `linted`) and must stay silent.
const STATUS_CONSISTENCY_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/lintyes/*.ts\` | 1 | yes | none | ESLint | none | ratcheted | — |
| \`tools/lintno/*.md\` | 1 | no | none | Markdown | none | linted | — |
| \`tools/lintok/*.ts\` | 1 | yes (project service) | none | ESLint | none | linted + ratcheted | — |
`;
// A5: a row may claim `ratchet/<id>` only when at least one tracked file it
// matches is a member of that ratchet's glob. Line 5 matches a member; line 6
// matches only a non-member (prose rot); line 7 matches both a member and a
// non-member, so the partial overlap keeps it silent.
const RATCHET_MEMBERSHIP_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/covered/a.ts\` | 1 .ts | yes | \`ratchet/scoped\` | ESLint | none | linted + ratcheted | — |
| \`src/orphan/b.ts\` | 1 .ts | yes | \`ratchet/scoped\` | ESLint | none | linted + ratcheted | — |
| \`src/mixed/*.ts\` | 2 .ts | yes | \`ratchet/scoped\` | ESLint | none | linted + ratcheted | — |
`;
const CONFLICTING_COVERAGE_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/conflict/*.ts\` | 1 | no | none | — | none | excluded | — |
| \`tools/conflict/example.ts\` | 1 | yes | none | ESLint | none | linted | — |
| \`tools/compatible/*.ts\` | 1 | yes | \`ratchet/known\` | ESLint | none | linted + ratcheted | — |
| \`tools/compatible/example.ts\` | 1 | yes | none | ESLint | none | linted | — |
`;
const CONFIG_SURFACE_MISMATCH_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/config/example.config.ts\` | 1 | no | none | — | none | excluded | — |
`;
const CONFIG_SURFACE_OMITTED_FROM_MANIFEST_MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`tools/config/example.config.ts\` | 1 | yes | none | ESLint | none | linted | — |
`;

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// Characterization tests (arch-plans-2026-07 leaf 02, S0): pin the CURRENT
// CLI parser contract before any migration onto parseCli(spec). Pinned quirks:
// bare `--` tokens are filtered out (allowed anywhere), there is no --help
// handling (help flags are unknown arguments), any unknown token collapses to
// `undefined` after writing the usage line to stderr (the entrypoint exits 2),
// and --check-eslint-reach is silently disabled when --staged is present.
describe("parseCliArgs (lint-coverage-map-check CLI)", () => {
  function withStderrCapture<T>(run: () => T): { result: T; stderr: string } {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      return { result: run(), stderr: writes.join("") };
    } finally {
      spy.mockRestore();
    }
  }

  it("parses an empty argv to all-off options", () => {
    expect(parseCliArgs([])).toEqual({ staged: false, checkEslintReach: false, suggest: false });
  });

  it("recognizes the three flags and filters bare -- tokens", () => {
    expect(parseCliArgs(["--", "--check-eslint-reach", "--suggest", "--"])).toEqual({
      staged: false,
      checkEslintReach: true,
      suggest: true,
    });
  });

  it("silently disables --check-eslint-reach when --staged is present", () => {
    expect(parseCliArgs(["--staged", "--check-eslint-reach"])).toEqual({
      staged: true,
      checkEslintReach: false,
      suggest: false,
    });
  });

  it("rejects unknown tokens, inline values, positionals, and help flags via stderr", () => {
    for (const argv of [["--nope"], ["--staged=x"], ["positional"], ["--help"], [""]]) {
      const { result, stderr } = withStderrCapture(() => parseCliArgs(argv));
      expect(result).toBeUndefined();
      expect(stderr).toBe(
        "usage: lint-coverage-map-check.ts [--check-eslint-reach] [--staged] [--suggest]\n",
      );
    }
  });
});

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

  it("reports rows whose `Normal lint` column disagrees with the status token", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: STATUS_CONSISTENCY_MAP,
      trackedFiles: ["tools/lintyes/a.ts", "tools/lintno/a.md", "tools/lintok/a.ts"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const consistency = result.findings.filter(
      (finding) => finding.kind === "status-consistency-mismatch",
    );
    expect(consistency.map((finding) => finding.line)).toEqual([5, 6]);
    expect(result.stderr).toContain("Normal-lint / status inconsistencies:");
    expect(result.stderr).toContain("line 5:");
    expect(result.stderr).toContain("line 6:");
    // The consistent `yes` ⇔ `linted` row must not be reported.
    expect(result.stderr).not.toContain("line 7:");
  });

  it("runs the Normal-lint consistency check in staged mode", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: STATUS_CONSISTENCY_MAP,
      staged: true,
      trackedFiles: ["tools/lintyes/a.ts", "tools/lintno/a.md", "tools/lintok/a.ts"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(
      result.findings.filter((finding) => finding.kind === "status-consistency-mismatch"),
    ).toHaveLength(2);
  });

  it("reports rows claiming a ratchet that covers none of their tracked files", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: RATCHET_MEMBERSHIP_MAP,
      trackedFiles: [
        "src/covered/a.ts",
        "src/orphan/b.ts",
        "src/mixed/member.ts",
        "src/mixed/x.ts",
      ],
      ratchetIds: new Set(["ratchet/scoped"]),
      ratchetMembership: (id) =>
        id === "ratchet/scoped"
          ? (file) => file === "src/covered/a.ts" || file === "src/mixed/member.ts"
          : undefined,
    });

    expect(result.exitCode).toBe(1);
    const membership = result.findings.filter(
      (finding) => finding.kind === "ratchet-membership-mismatch",
    );
    // Only the orphan row (line 6) is flagged: line 5 matches a member, and
    // line 7's partial overlap (member + non-member) keeps it silent.
    expect(membership.map((finding) => finding.line)).toEqual([6]);
    expect(membership[0]?.value).toContain("ratchet/scoped");
    expect(membership[0]?.value).toContain("src/orphan/b.ts");
    expect(result.stderr).toContain("Ratchet membership mismatches:");
  });

  it("runs the ratchet membership check in staged mode", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: RATCHET_MEMBERSHIP_MAP,
      staged: true,
      trackedFiles: [
        "src/covered/a.ts",
        "src/orphan/b.ts",
        "src/mixed/member.ts",
        "src/mixed/x.ts",
      ],
      ratchetIds: new Set(["ratchet/scoped"]),
      ratchetMembership: (id) =>
        id === "ratchet/scoped"
          ? (file) => file === "src/covered/a.ts" || file === "src/mixed/member.ts"
          : undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(
      result.findings.filter((finding) => finding.kind === "ratchet-membership-mismatch"),
    ).toHaveLength(1);
  });

  it("reports tracked files claimed by incompatible coverage statuses", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: CONFLICTING_COVERAGE_MAP,
      trackedFiles: ["tools/conflict/example.ts", "tools/compatible/example.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "conflicting-coverage",
        value:
          "`tools/conflict/example.ts` matched incompatible statuses: line 5 `excluded`; line 6 `linted`",
      },
    ]);
    expect(result.stderr).toContain("Conflicting coverage rows:");
    expect(result.stderr).toContain("tools/conflict/example.ts");
    expect(result.stderr).toContain("line 5 `excluded`; line 6 `linted`");
    expect(result.stderr).not.toContain("tools/compatible/example.ts");
  });

  it("reports manifest-listed config surfaces whose coverage-map status drifted", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: CONFIG_SURFACE_MISMATCH_MAP,
      trackedFiles: ["tools/config/example.config.ts"],
      ratchetIds: new Set(),
      configSurfaceEntries: [
        {
          path: "tools/config/example.config.ts",
          coverageStatus: "linted",
        },
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "config-surface-coverage-mismatch",
        value:
          "`tools/config/example.config.ts` expected coverage status `linted` from config-surface manifest; matched statuses: line 5 `excluded`",
      },
    ]);
    expect(result.stderr).toContain("Config surface coverage mismatches:");
    expect(result.stderr).toContain("tools/config/example.config.ts");
  });

  it("reports linted config-surface files that are missing from the manifest", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: CONFIG_SURFACE_OMITTED_FROM_MANIFEST_MAP,
      trackedFiles: ["tools/config/example.config.ts"],
      ratchetIds: new Set(),
      configSurfaceEntries: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "config-surface-coverage-mismatch",
        value:
          "`tools/config/example.config.ts` is linted as a config surface in the coverage map but is missing from config-surface manifest; matched statuses: line 5 `linted`",
      },
    ]);
    expect(result.stderr).toContain("Config surface coverage mismatches:");
  });

  it("names the map path and the base-dir convention in the unaccounted section", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: FIXTURE_MAP,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "config.json", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("docs/generated/lint-coverage-map.md");
    expect(result.stderr.toLowerCase()).toContain("base dir");
    expect(result.stderr).toContain("`bun run docs:lint-coverage-map:suggest`");
    expect(result.stderr).not.toContain("scripts/lint-coverage-map-check.ts --suggest");
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
      mkdirSync(join(cwd, "docs/generated"), { recursive: true });
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
      mkdirSync(join(cwd, "docs/generated"), { recursive: true });
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
      trackedFiles: [
        "tools/reach/managed-a.ts",
        "packages/reach/dist/scope-b.ts",
        "tools/reach/notes.md",
      ],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["eslint-reach-missing"]);
    // Exactly ONE of the three tracked files satisfies all three filter conjuncts,
    // so the row's total (the `M` in `N of M`) is 1, and it names that file.
    // - packages/reach/dist/scope-b.ts excluded by trackedFileIsInScope (out-of-scope dir)
    // - tools/reach/notes.md excluded by trackedFileUsesEslint (.md is not ESLint-managed)
    expect(result.stderr).toContain(
      "line 5: 1 of 1 ESLint-managed file(s) have no ESLint config (e.g. `tools/reach/managed-a.ts`)",
    );
    expect(result.stderr).not.toContain("packages/reach/dist/scope-b.ts");
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

describe("loadTrackedFiles", () => {
  it("returns tracked files sorted, dropping untracked ones", () => {
    // Pins the scripts/lib/git.ts migration: loadTrackedFiles must still list
    // only git-tracked paths in default lexical order.
    const cwd = mkdtempSync(join(tmpdir(), "lcm-tracked-"));
    try {
      git(cwd, ["init", "-q", "-b", "main"]);
      writeFileSync(join(cwd, "b.ts"), "");
      writeFileSync(join(cwd, "a.ts"), "");
      writeFileSync(join(cwd, "untracked.ts"), "");
      git(cwd, ["add", "b.ts", "a.ts"]);
      expect(loadTrackedFiles(cwd)).toEqual(["a.ts", "b.ts"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
