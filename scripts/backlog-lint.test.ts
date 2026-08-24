import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCliArgs, runBacklogLint } from "./backlog-lint.js";
import { BACKLOG_LINT_SECTION_TITLES, formatBacklogLintResult } from "./backlog-lint-format.js";
import type { BacklogLintFinding, BacklogLintFindingKind } from "./backlog-lint-types.js";

function writePackFixture(root: string): string {
  const packDir = join(root, "backlog", "pack");
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, "00-index.md"),
    [
      "# Pack",
      "",
      "Status: Parked task index",
      "Created: 2026-07-03",
      "",
      "| # | Task | Status |",
      "|---|---|---|",
      "| 10 | [a](./10-a.md) | Done |",
      "| 11 | [b](./11-b.md) | Done |",
      "",
    ].join("\n"),
  );
  writeFileSync(join(packDir, "10-a.md"), "# 10\n\nStatus: Ready\nDate: 2026-07-03\n");
  writeFileSync(join(packDir, "11-b.md"), "# 11\n\nStatus: Ready\nDate: 2026-07-03\n");
  return packDir;
}

describe("runBacklogLint", () => {
  it("accepts generated catalog metadata without adding an advisory", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/pack/00-index.md",
          text: "# Pack\n\nStatus: Parked task index\nCreated: 2026-08-04\n",
        },
        {
          path: "docs/agent_notes/backlog/pack/LEAVES-A.md",
          text: [
            "# Catalog",
            "",
            "Status: Done — generated reference catalog; canonical leaf status lives in 00-index.md",
            "Updated: 2026-08-04",
          ].join("\n"),
        },
      ],
      now: new Date("2026-08-04T00:00:00Z"),
      requireFrontMatter: true,
    });

    expect(result.findings).toEqual([]);
  });

  it("accepts existing backlog header shapes and reports a clean advisory check", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/example.md",
          text: [
            "# Example",
            "",
            "Status: Parked",
            "Date: 2026-07-03",
            "Source: test",
            "",
            "## Context",
          ].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/arch-review-2026-07/19-shipped.md",
          text: [
            "# 19. Shipped",
            "",
            "Status: Done - implemented 2026-07-07 on branch `fix/example`",
            "Size: S",
            "",
            "## Problem",
          ].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/pack/00-index.md",
          text: [
            "# Pack",
            "",
            "Status: Parked task index",
            "Created: 2026-07-03",
            "",
            "## Scope",
          ].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.stdout).toContain("backlog:lint OK - 3 note(s) checked");
    expect(result.stdout).toContain("0 advisory finding(s)");
  });

  it("reports front-matter and staleness findings without making the command fail", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/missing-status.md",
          text: ["# Missing Status", "", "Date: 2026-07-01", "", "Body"].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/bad-date.md",
          text: ["# Bad Date", "", "Status: Parked", "Date: 2026-99-99", "", "Body"].join("\n"),
        },
        {
          path: "docs/agent_notes/backlog/stale.md",
          text: ["# Stale", "", "Status: Parked", "Date: 2025-12-01", "", "Body"].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
      requireFrontMatter: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "invalid-date",
      "missing-status",
      "stale-note",
    ]);
    expect(result.stdout).toContain("backlog:lint advisory findings");
    expect(result.stdout).toContain("missing-status.md");
    expect(result.stdout).toContain("bad-date.md");
    expect(result.stdout).toContain("stale.md");
  });

  it("uses dated pack paths as a fallback for legacy leaves without a date line", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/harness-review-2026-07/10-leaf.md",
          text: ["# 10. Leaf", "", "Status: Proposed", "", "## Problem"].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
    });

    expect(result.findings).toEqual([]);
  });

  it("requires front-matter by default when linting named files", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/touched.md",
          text: ["# Touched", "", "Body"].join("\n"),
        },
      ],
      fileMode: true,
      now: new Date("2026-07-07T00:00:00Z"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "missing-status",
      "missing-date",
    ]);
  });

  it("loads only named markdown files in file mode", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-backlog-lint-"));
    try {
      writeFileSync(join(root, "relative.md"), ["# Relative", "", "Body"].join("\n"));
      writeFileSync(join(root, "absolute.md"), ["# Absolute", "", "Body"].join("\n"));

      const result = runBacklogLint({
        cwd: root,
        filePaths: ["relative.md", join(root, "absolute.md")],
        now: new Date("2026-07-07T00:00:00Z"),
      });

      expect(result.checkedCount).toBe(2);
      expect([...new Set(result.findings.map((finding) => finding.path))]).toEqual([
        "absolute.md",
        "relative.md",
      ]);
      expect(result.findings.map((finding) => finding.kind)).toEqual([
        "missing-status",
        "missing-date",
        "missing-status",
        "missing-date",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects every invalid explicitly named file", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-backlog-lint-"));
    try {
      mkdirSync(join(root, "directory.md"));
      writeFileSync(join(root, "not-markdown.txt"), "not markdown");

      const result = runBacklogLint({
        cwd: root,
        filePaths: ["missing.md", "directory.md", "not-markdown.txt"],
      });

      expect(result.exitCode).toBe(2);
      expect(result.checkedCount).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("missing.md");
      expect(result.stderr).toContain("directory.md");
      expect(result.stderr).toContain("not-markdown.txt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats dated notes without status as stale-eligible", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/statusless-stale.md",
          text: ["# Statusless Stale", "", "Date: 2025-12-01", "", "Body"].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
      requireFrontMatter: true,
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "missing-status",
      "stale-note",
    ]);
  });

  it("treats NOT implemented status text as stale-eligible active work", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/negated-terminal-stale.md",
          text: [
            "# Negated Terminal Stale",
            "",
            "Status: Proposed - NOT implemented",
            "Date: 2025-12-01",
            "",
            "Body",
          ].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
      requireFrontMatter: true,
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual(["stale-note"]);
  });

  it("loads pack siblings in file mode and scopes drift to the edited leaf", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-backlog-pack-"));
    try {
      const packDir = writePackFixture(root);
      const result = runBacklogLint({
        cwd: root,
        backlogDir: "backlog",
        filePaths: [join(packDir, "10-a.md")],
        now: new Date("2026-07-07T00:00:00Z"),
      });
      const drift = result.findings
        .filter((finding) => finding.kind === "index-leaf-drift")
        .map((finding) => `${finding.path}:${String(finding.line ?? 0)}`);
      expect(drift).toEqual(["backlog/pack/00-index.md:8"]);
      expect(
        result.findings.find((finding) => finding.kind === "index-leaf-drift")?.message,
      ).toContain("backlog/pack/10-a.md");
      expect(result.checkedCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports whole-pack drift when the pack index itself is edited", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-backlog-pack-"));
    try {
      const packDir = writePackFixture(root);
      const result = runBacklogLint({
        cwd: root,
        backlogDir: "backlog",
        filePaths: [join(packDir, "00-index.md")],
        now: new Date("2026-07-07T00:00:00Z"),
      });
      const drift = result.findings
        .filter((finding) => finding.kind === "index-leaf-drift")
        .map((finding) => `${finding.path}:${String(finding.line ?? 0)}`)
        .sort();
      expect(drift).toEqual(["backlog/pack/00-index.md:8", "backlog/pack/00-index.md:9"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a declared catalog closure when the catalog is edited in file mode", () => {
    const root = mkdtempSync(join(tmpdir(), "musi-backlog-catalog-"));
    try {
      const packDir = join(root, "backlog", "pack");
      mkdirSync(packDir, { recursive: true });
      writeFileSync(
        join(packDir, "00-index.md"),
        [
          "# Pack",
          "",
          "Status: Parked task index",
          "Created: 2026-08-04",
          "",
          "<!-- BEGIN GENERATED LEAF CATALOG ROUTING -->",
          "<!-- backlog-lint-catalog: LEAVES-A.md -->",
          "[LEAVES-A.md](./LEAVES-A.md)",
          "<!-- END GENERATED LEAF CATALOG ROUTING -->",
        ].join("\n"),
      );
      writeFileSync(
        join(packDir, "LEAVES-A.md"),
        [
          "# Catalog",
          "",
          "Status: Done — generated reference catalog",
          "Updated: 2026-08-04",
          "",
          "[gone](./99-gone.md)",
        ].join("\n"),
      );
      writeFileSync(join(packDir, "10-unlisted.md"), "# 10\n\nStatus: Ready\n");

      const result = runBacklogLint({
        cwd: root,
        backlogDir: "backlog",
        filePaths: [join(packDir, "LEAVES-A.md")],
        now: new Date("2026-08-04T00:00:00Z"),
      });

      expect(result.findings.map((finding) => finding.kind).sort()).toEqual([
        "dangling-index-link",
        "unlisted-leaf",
      ]);
      expect(result.findings.find((finding) => finding.kind === "dangling-index-link")?.path).toBe(
        "backlog/pack/LEAVES-A.md",
      );
      expect(result.checkedCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores arbitrary metadata dates when selecting the note date", () => {
    const result = runBacklogLint({
      files: [
        {
          path: "docs/agent_notes/backlog/undated-prose.md",
          text: [
            "# Undated Prose",
            "",
            "Status: Parked",
            "Note: superseded 2026-01-01",
            "",
            "Body",
          ].join("\n"),
        },
      ],
      now: new Date("2026-07-07T00:00:00Z"),
      staleMonths: 6,
      requireFrontMatter: true,
    });

    expect(result.findings.map((finding) => finding.kind)).toEqual(["missing-date"]);
  });
});

// Characterization tests (arch-plans-2026-07 leaf 02, S0): pin the CURRENT
// backlog-lint CLI parser contract before any migration onto parseCli(spec).
// Pinned quirks: no --help handling (help flags are unknown arguments), bare
// `--` tokens are skipped, no inline `--name=value` form, any parse problem
// collapses to `undefined` (the entrypoint prints usage to stderr and exits 2),
// and path values may not start with `-`.
describe("parseCliArgs (backlog-lint CLI)", () => {
  it("returns an empty options object for an empty argv", () => {
    expect(parseCliArgs([])).toEqual({});
  });

  it("applies toggles and skips bare -- tokens", () => {
    expect(parseCliArgs(["--", "--no-stale", "--require-front-matter", "--"])).toEqual({
      checkStaleness: false,
      requireFrontMatter: true,
    });
  });

  it("reads valued options in the separate form only", () => {
    expect(parseCliArgs(["--backlog-dir", "docs/x", "--stale-months", "3"])).toEqual({
      backlogDir: "docs/x",
      staleMonths: 3,
    });
    expect(parseCliArgs(["--backlog-dir=docs/x"])).toBeUndefined();
  });

  it("accumulates repeated --file values and last-wins repeated scalars", () => {
    expect(parseCliArgs(["--file", "a.md", "--file", "b.md"])).toEqual({
      filePaths: ["a.md", "b.md"],
    });
    expect(parseCliArgs(["--stale-months", "3", "--stale-months", "9"])).toEqual({
      staleMonths: 9,
    });
  });

  it("rejects non-positive or non-integer --stale-months values", () => {
    expect(parseCliArgs(["--stale-months", "0"])).toBeUndefined();
    expect(parseCliArgs(["--stale-months", "1.5"])).toBeUndefined();
    expect(parseCliArgs(["--stale-months"])).toBeUndefined();
  });

  it("rejects path values that are missing or start with a dash", () => {
    expect(parseCliArgs(["--backlog-dir"])).toBeUndefined();
    expect(parseCliArgs(["--file", "--no-stale"])).toBeUndefined();
  });

  it("rejects unknown arguments, positionals, empty args, and help flags", () => {
    expect(parseCliArgs(["--nope"])).toBeUndefined();
    expect(parseCliArgs(["positional"])).toBeUndefined();
    expect(parseCliArgs([""])).toBeUndefined();
    expect(parseCliArgs(["--help"])).toBeUndefined();
  });
});

describe("formatBacklogLintResult", () => {
  it("renders a titled section for every finding kind", () => {
    const kinds = Object.keys(BACKLOG_LINT_SECTION_TITLES) as BacklogLintFindingKind[];
    const findings: BacklogLintFinding[] = kinds.map((kind) => ({
      kind,
      path: `docs/agent_notes/backlog/pack/${kind}.md`,
      message: `example ${kind} finding`,
    }));

    const output = formatBacklogLintResult(findings.length, findings);

    expect(output).toContain(`${String(kinds.length)} finding(s)`);
    for (const kind of kinds) {
      expect(output).toContain(`\n${BACKLOG_LINT_SECTION_TITLES[kind]}\n`);
      expect(output).toContain(`example ${kind} finding`);
    }
  });
});
