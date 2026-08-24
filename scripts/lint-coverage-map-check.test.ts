import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseCliArgs, runLintCoverageMapCheck } from "./lint-coverage-map-check.js";
import { loadTrackedFiles } from "./lint-coverage-map-check-io.js";
import type { CoverageEntry } from "./lint-coverage-map-manifest-schema.js";

const SAFETY_ACKNOWLEDGED_PATH = "packages/server/prisma/migrations/.safety-acknowledged";

/**
 * Coverage entries are plain typed data now, so fixtures are built directly
 * instead of round-tripping through a Markdown table. Defaults keep each test's
 * literal to the fields it actually exercises.
 */
function entry(
  overrides: Partial<CoverageEntry> & Pick<CoverageEntry, "id" | "globs">,
): CoverageEntry {
  return {
    files: "1 .ts",
    normalLint: { covered: true },
    ratchets: "none",
    parser: "ESLint",
    proposed: "none",
    status: ["linted"],
    followUp: "—",
    ...overrides,
  };
}

const FIXTURE_ENTRIES: readonly CoverageEntry[] = [
  entry({
    id: "src-ts",
    globs: ["src/**/*.ts"],
    ratchets: "`ratchet/known`",
    status: ["linted", "ratcheted"],
  }),
  entry({
    id: "docs-stale-md",
    globs: ["docs/stale.md"],
    normalLint: { covered: false },
    status: ["not-code"],
  }),
  entry({
    id: "scripts-tool-ts",
    globs: ["scripts/tool.ts"],
    normalLint: { covered: false },
    ratchets: "`ratchet/missing`",
    status: ["proposed"],
  }),
];

// Characterization tests (arch-plans-2026-07 leaf 02, S0): pin the CURRENT
// CLI parser contract before any migration onto parseCli(spec). Pinned quirks:
// bare `--` tokens are filtered out (allowed anywhere), there is no --help
// handling (help flags are unknown arguments), and any unknown token collapses
// to `undefined` after writing the usage line to stderr (the entrypoint exits
// 2). The `--staged` quirk this list used to pin (it silently disabled
// --check-eslint-reach) went away with the flag itself.
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
    expect(parseCliArgs([])).toEqual({ checkEslintReach: false, suggest: false });
  });

  it("recognizes both flags and filters bare -- tokens", () => {
    expect(parseCliArgs(["--", "--check-eslint-reach", "--suggest", "--"])).toEqual({
      checkEslintReach: true,
      suggest: true,
    });
  });

  it("rejects unknown tokens, inline values, positionals, and help flags via stderr", () => {
    for (const argv of [
      ["--nope"],
      ["--staged"],
      ["--suggest=x"],
      ["positional"],
      ["--help"],
      [""],
    ]) {
      const { result, stderr } = withStderrCapture(() => parseCliArgs(argv));
      expect(result).toBeUndefined();
      expect(stderr).toBe("usage: lint-coverage-map-check.ts [--check-eslint-reach] [--suggest]\n");
    }
  });
});

describe("runLintCoverageMapCheck", () => {
  it("reports stale globs, unknown ratchets, and unaccounted files, keyed by entry id", async () => {
    const result = await runLintCoverageMapCheck({
      entries: FIXTURE_ENTRIES,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "stale-path",
      "unknown-ratchet",
      "unaccounted-file",
    ]);
    expect(result.stderr).toContain("entry `docs-stale-md`");
    expect(result.stderr).toContain("`docs/stale.md` matched 0 tracked files");
    expect(result.stderr).toContain("entry `scripts-tool-ts`: ratchet/missing");
    expect(result.stderr).toContain("- extra:");
    expect(result.stderr).toContain("extra/missing.ts");
    // Findings never carry a Markdown line number any more.
    expect(result.stderr).not.toMatch(/^- line \d/mu);
  });

  it("reports rows claiming a ratchet that covers none of their tracked files", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [
        entry({ id: "covered", globs: ["src/covered/a.ts"], ratchets: "`ratchet/scoped`" }),
        entry({ id: "orphan", globs: ["src/orphan/b.ts"], ratchets: "`ratchet/scoped`" }),
        entry({ id: "mixed", globs: ["src/mixed/*.ts"], ratchets: "`ratchet/scoped`" }),
      ],
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
    // Only the orphan entry is flagged: `covered` matches a member, and `mixed`'s
    // partial overlap (member + non-member) keeps it silent.
    expect(membership.map((finding) => finding.entry)).toEqual(["orphan"]);
    expect(membership[0]?.value).toContain("ratchet/scoped");
    expect(membership[0]?.value).toContain("src/orphan/b.ts");
    expect(result.stderr).toContain("Ratchet membership mismatches:");
  });

  // `:check` is the commit-gate mode and must stay reach-free; only `:audit`
  // (--check-eslint-reach) may pay for ESLint config resolution.
  it("never probes ESLint reach unless --check-eslint-reach asks for it", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "orphan", globs: ["src/orphan/b.ts"], ratchets: "`ratchet/scoped`" })],
      trackedFiles: ["src/orphan/b.ts"],
      ratchetIds: new Set(["ratchet/scoped"]),
      ratchetMembership: (id) => (id === "ratchet/scoped" ? () => false : undefined),
      eslintReachChecker: () => {
        throw new Error("ESLint reach must not be probed without --check-eslint-reach");
      },
    });

    expect(result.exitCode).toBe(1);
    expect(
      result.findings.filter((finding) => finding.kind === "ratchet-membership-mismatch"),
    ).toHaveLength(1);
  });

  it("reports tracked files claimed by incompatible coverage statuses", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [
        entry({
          id: "conflict-glob",
          globs: ["tools/conflict/*.ts"],
          normalLint: { covered: false },
          status: ["excluded"],
        }),
        entry({ id: "conflict-file", globs: ["tools/conflict/example.ts"] }),
        entry({
          id: "compatible-glob",
          globs: ["tools/compatible/*.ts"],
          ratchets: "`ratchet/known`",
          status: ["linted", "ratcheted"],
        }),
        entry({ id: "compatible-file", globs: ["tools/compatible/example.ts"] }),
      ],
      trackedFiles: ["tools/conflict/example.ts", "tools/compatible/example.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "conflicting-coverage",
        value:
          "`tools/conflict/example.ts` matched incompatible statuses: entry `conflict-glob` `excluded`; entry `conflict-file` `linted`",
      },
    ]);
    expect(result.stderr).toContain("Conflicting coverage rows:");
    expect(result.stderr).not.toContain("tools/compatible/example.ts");
  });

  it("reports manifest-listed config surfaces whose coverage status drifted", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [
        entry({
          id: "example-config",
          globs: ["tools/config/example.config.ts"],
          normalLint: { covered: false },
          status: ["excluded"],
        }),
      ],
      trackedFiles: ["tools/config/example.config.ts"],
      ratchetIds: new Set(),
      configSurfaceEntries: [{ path: "tools/config/example.config.ts", coverageStatus: "linted" }],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "config-surface-coverage-mismatch",
        value:
          "`tools/config/example.config.ts` expected coverage status `linted` from config-surface manifest; matched statuses: entry `example-config` `excluded`",
      },
    ]);
    expect(result.stderr).toContain("Config surface coverage mismatches:");
  });

  it("reports linted config-surface files that are missing from the manifest", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "example-config", globs: ["tools/config/example.config.ts"] })],
      trackedFiles: ["tools/config/example.config.ts"],
      ratchetIds: new Set(),
      configSurfaceEntries: [],
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "config-surface-coverage-mismatch",
        value:
          "`tools/config/example.config.ts` is linted as a config surface in the coverage map but is missing from config-surface manifest; matched statuses: entry `example-config` `linted`",
      },
    ]);
  });

  it("points the unaccounted section at the manifest modules, not the Markdown document", async () => {
    const result = await runLintCoverageMapCheck({
      entries: FIXTURE_ENTRIES,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("scripts/lint-coverage-map-manifest-<area>.ts");
    expect(result.stderr).toContain("`bun run docs:lint-coverage-map:suggest`");
    // The base-dir convention is gone with the private glob dialect.
    expect(result.stderr.toLowerCase()).not.toContain("base dir");
  });

  it("reports migration safety metadata when its claimed entry is removed", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "src-ts", globs: ["src/**/*.ts"] })],
      trackedFiles: ["src/index.ts", SAFETY_ACKNOWLEDGED_PATH],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toContainEqual({
      kind: "unaccounted-file",
      value: SAFETY_ACKNOWLEDGED_PATH,
    });
    expect(result.stderr).toContain("- packages/server/prisma/migrations:");
  });

  it("emits ready-to-paste manifest entries for unaccounted files under --suggest", async () => {
    const result = await runLintCoverageMapCheck({
      entries: FIXTURE_ENTRIES,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
      suggest: true,
      eslintReachChecker: () => true,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Suggested coverage-manifest edits");
    expect(result.stderr).toContain('globs: ["extra/missing.ts"]');
  });

  it("hints to `git add` when a literal glob exists in the worktree but is untracked", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "src-new-file", globs: ["src/new-file.ts"] })],
      trackedFiles: [],
      worktreeExists: (relPath) => relPath === "src/new-file.ts",
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const stale = result.findings.filter((finding) => finding.kind === "stale-path");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.value).toContain("did you forget to `git add` it?");
  });

  it("does not add the git-add hint for glob patterns or genuinely-missing paths", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "missing-tree", globs: ["missing/**/*.ts"] })],
      trackedFiles: [],
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
      // A new file named by an entry but never `git add`-ed: the real
      // `existsSync` probe rooted at `cwd` must fire and produce the hint.
      writeFileSync(join(cwd, "added.ts"), "export const added = 1;\n");
      git(cwd, ["init", "-q", "-b", "main"]);

      const result = await runLintCoverageMapCheck({
        cwd,
        entries: [entry({ id: "added-ts", globs: ["added.ts"] })],
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("did you forget to `git add` it?");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports linted rows whose files do not resolve an ESLint config", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      eslintReachChecker: (file) => file !== "scripts/codemods/tsconfig.json",
      entries: [entry({ id: "codemods-tsconfig", globs: ["scripts/codemods/tsconfig.json"] })],
      trackedFiles: ["scripts/codemods/tsconfig.json"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["eslint-reach-missing"]);
    expect(result.stderr).toContain("ESLint reach gaps:");
    expect(result.stderr).toContain(
      "entry `codemods-tsconfig`: 1 of 1 ESLint-managed file(s) resolve no ESLint rules",
    );
  });

  it("only counts in-scope, ESLint-managed files matching an entry glob in the reach gate", async () => {
    // One entry carrying TWO independent globs. Exactly one tracked file
    // satisfies all three filter conjuncts (in-scope && uses-eslint && matches):
    // - packages/reach/dist/scope-b.ts matches and uses ESLint but is out of
    //   scope (generated `dist/` dir).
    // - tools/reach/notes.md matches and is in scope but is not an
    //   ESLint-managed extension.
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      // No file resolves an ESLint config, so every admitted file is "missing".
      eslintReachChecker: () => false,
      entries: [
        entry({
          id: "reach-filter",
          globs: ["tools/reach/*", "packages/reach/dist/*"],
          files: "3",
        }),
      ],
      trackedFiles: [
        "tools/reach/managed-a.ts",
        "packages/reach/dist/scope-b.ts",
        "tools/reach/notes.md",
      ],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual(["eslint-reach-missing"]);
    expect(result.stderr).toContain(
      "entry `reach-filter`: 1 of 1 ESLint-managed file(s) resolve no ESLint rules (e.g. `tools/reach/managed-a.ts`)",
    );
    // 2 of 2 / 3 of 3 would mean a conjunct flipped to constant-true or `&&`→`||`
    // admitted the out-of-scope or non-ESLint file.
    expect(result.stderr).not.toContain("of 2 ESLint-managed");
    expect(result.stderr).not.toContain("of 3 ESLint-managed");
  });

  it("gates a multi-part `linted` status but skips a non-`linted` row in the reach gate", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      eslintReachChecker: () => false,
      entries: [
        entry({
          id: "multipart",
          globs: ["tools/multipart/*.ts"],
          status: ["linted", "ratcheted"],
        }),
        entry({
          id: "ratchet-only",
          globs: ["tools/ratchetonly/*.ts"],
          normalLint: { covered: false },
          status: ["ratcheted"],
        }),
      ],
      trackedFiles: ["tools/multipart/a.ts", "tools/ratchetonly/b.ts"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const reach = result.findings.filter((finding) => finding.kind === "eslint-reach-missing");
    expect(reach).toHaveLength(1);
    expect(reach[0]?.entry).toBe("multipart");
    // The `ratcheted`-only row must not emit a reach finding; its file is never reported.
    expect(result.stderr).not.toContain("tools/ratchetonly/b.ts");
  });

  it("reports a row whose asserted Files count is not the number of files it matches", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [entry({ id: "stale-count", globs: ["src/*.ts"], files: "1 .ts" })],
      trackedFiles: ["src/a.ts", "src/b.ts"],
      ratchetIds: new Set(),
    });

    const counts = result.findings.filter((finding) => finding.kind === "files-count-stale");
    expect(counts).toHaveLength(1);
    expect(counts[0]?.entry).toBe("stale-count");
    expect(counts[0]?.value).toContain("asserts 1");
    expect(counts[0]?.value).toContain("match 2 tracked file(s)");
    expect(result.exitCode).toBe(1);
  });

  it("sums a multi-extension Files breakdown before comparing", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [
        entry({
          id: "breakdown",
          globs: ["fixtures/*"],
          files: "2 .ts + 1 .json (labeled corpus)",
        }),
      ],
      trackedFiles: ["fixtures/a.ts", "fixtures/b.ts", "fixtures/meta.json"],
      ratchetIds: new Set(),
    });

    expect(result.findings.filter((finding) => finding.kind === "files-count-stale")).toEqual([]);
    // The trailing parenthetical is prose: its digits must not join the sum.
    expect(result.exitCode).toBe(0);
  });

  it("exempts a row that declares why its Files count is not derivable", async () => {
    const result = await runLintCoverageMapCheck({
      entries: [
        entry({
          id: "subset",
          globs: ["packages/**/*.ts"],
          files: "1 .ts",
          filesCountNote:
            "production only; the sibling test row owns the rest and rows carry no ignores",
        }),
        entry({
          id: "prose",
          globs: ["packages/**/*.ts"],
          files: "root guidance docs plus per-package MODULE docs",
          filesCountNote: "narrative breakdown, not a total",
        }),
      ],
      trackedFiles: ["packages/a.ts", "packages/b.ts"],
      ratchetIds: new Set(),
    });

    expect(result.findings.filter((finding) => finding.kind === "files-count-stale")).toEqual([]);
  });

  it("reports a non-linted row whose files normal lint actually reaches", async () => {
    const result = await runLintCoverageMapCheck({
      checkEslintReach: true,
      // Every file resolves lint rules; only the row that does not claim
      // `linted` is a misclassification.
      eslintReachChecker: () => true,
      entries: [
        entry({ id: "linted-row", globs: ["tools/linted/*.ts"], status: ["linted"] }),
        entry({
          id: "excluded-row",
          globs: ["tools/excluded/*.ts"],
          normalLint: { covered: false },
          status: ["excluded"],
        }),
      ],
      trackedFiles: ["tools/linted/a.ts", "tools/excluded/b.ts"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(1);
    const unexpected = result.findings.filter(
      (finding) => finding.kind === "eslint-reach-unexpected",
    );
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]?.entry).toBe("excluded-row");
    expect(unexpected[0]?.value).toContain("tools/excluded/b.ts");
    expect(result.stderr).toContain("Rows normal lint reaches but that do not claim `linted`:");
  });

  it("skips the ESLint reach gate unless --check-eslint-reach asks for it", async () => {
    const result = await runLintCoverageMapCheck({
      eslintReachChecker: () => false,
      entries: [entry({ id: "codemods-tsconfig", globs: ["scripts/codemods/tsconfig.json"] })],
      trackedFiles: ["scripts/codemods/tsconfig.json"],
      ratchetIds: new Set(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

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
