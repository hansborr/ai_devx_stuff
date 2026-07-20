import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildContextBudgetReport,
  collectAlwaysLoadedFiles,
  estimateTokens,
  extractImportPaths,
  formatText,
  runContextBudget,
} from "./sensor-context-budget.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "musi-context-budget-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, contents: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

describe("extractImportPaths", () => {
  it("finds @-import tokens at line starts and after whitespace", () => {
    expect(extractImportPaths("@AGENTS.md\nsee @docs/guides/x.md too")).toEqual([
      "AGENTS.md",
      "docs/guides/x.md",
    ]);
  });

  it("ignores email addresses and bare @ characters", () => {
    expect(extractImportPaths("mail hans.k.borresen@gmail.com about @ nothing")).toEqual([]);
  });

  it("ignores imports inside fenced code blocks and inline code spans", () => {
    const markdown = [
      "```bash",
      "@fenced/ignored.md",
      "```",
      "wrap `@span/ignored.md` in backticks to keep it literal",
      "~~~",
      "@tilde-fenced/ignored.md",
      "~~~",
      "@docs/real.md",
    ].join("\n");
    expect(extractImportPaths(markdown)).toEqual(["docs/real.md"]);
  });

  it("extracts home-relative @~/ import tokens", () => {
    expect(extractImportPaths("- @~/.claude/my-project-instructions.md")).toEqual([
      "~/.claude/my-project-instructions.md",
    ]);
  });

  it("ignores imports inside multi-backtick inline code spans", () => {
    expect(extractImportPaths("keep ``@double/ignored.md`` literal, load @docs/real.md")).toEqual([
      "docs/real.md",
    ]);
    expect(extractImportPaths("``a `nested` span with @span/ignored.md``")).toEqual([]);
  });

  it("does not close a longer fence with a shorter delimiter run", () => {
    const markdown = [
      "````",
      "@fenced/ignored.md",
      "```",
      "still fenced: @still/ignored.md",
      "````",
      "@docs/real.md",
    ].join("\n");
    expect(extractImportPaths(markdown)).toEqual(["docs/real.md"]);
  });

  it("ignores imports inside HTML comments, including multi-line ones", () => {
    const markdown = [
      "<!-- @commented/ignored.md -->",
      "<!--",
      "@multiline/ignored.md",
      "-->",
      "@docs/real.md",
    ].join("\n");
    expect(extractImportPaths(markdown)).toEqual(["docs/real.md"]);
  });
});

describe("estimateTokens", () => {
  it("estimates tokens as ceil(bytes / 4)", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(9)).toBe(3);
  });
});

describe("collectAlwaysLoadedFiles", () => {
  it("collects root CLAUDE.md and AGENTS.md plus resolved @-imports, deduped", () => {
    write("CLAUDE.md", "@AGENTS.md\n");
    write("AGENTS.md", "See @docs/extra.md and again @docs/extra.md\n");
    write("docs/extra.md", "extra always-on context\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md", "AGENTS.md", "docs/extra.md"]);
  });

  it("survives import cycles and skips imports that do not exist on disk", () => {
    write("CLAUDE.md", "@AGENTS.md\n");
    write("AGENTS.md", "@CLAUDE.md plus @docs/missing.md\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md", "AGENTS.md"]);
  });

  it("returns an empty list when no always-loaded files exist", () => {
    expect(collectAlwaysLoadedFiles(root)).toEqual([]);
  });

  it("resolves nested imports relative to the importing file, never the scan root", () => {
    write("CLAUDE.md", "@docs/nested.md\n");
    write("docs/nested.md", "see @shared.md\n");
    // Exists at the scan root only: Claude resolves relative to the importing
    // file (docs/shared.md), finds nothing, and skips — no root fallback.
    write("shared.md", "root-level file Claude would never load\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md", "docs/nested.md"]);
  });

  it("stops following imports after four hops (Claude Code max depth)", () => {
    write("CLAUDE.md", "@hop1.md\n");
    write("hop1.md", "@hop2.md\n");
    write("hop2.md", "@hop3.md\n");
    write("hop3.md", "@hop4.md\n");
    write("hop4.md", "@hop5.md\n");
    write("hop5.md", "five hops deep; Claude never loads this\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual([
      "CLAUDE.md",
      "hop1.md",
      "hop2.md",
      "hop3.md",
      "hop4.md",
    ]);
  });

  it("expands a shared file from its shallowest depth, not its first-visited depth", () => {
    // CLAUDE.md reaches AGENTS.md at hop 1, but AGENTS.md is also a hop-0
    // root: its import chain must get the full four-hop budget, so hop4.md
    // (4 hops from AGENTS.md, 5 from CLAUDE.md) is still always-loaded.
    write("CLAUDE.md", "@AGENTS.md\n");
    write("AGENTS.md", "@hop1.md\n");
    write("hop1.md", "@hop2.md\n");
    write("hop2.md", "@hop3.md\n");
    write("hop3.md", "@hop4.md\n");
    write("hop4.md", "reachable in four hops from the AGENTS.md root\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "hop1.md",
      "hop2.md",
      "hop3.md",
      "hop4.md",
    ]);
  });

  it("skips imports that resolve to directories instead of files", () => {
    write("CLAUDE.md", "@docs\nsee @docs/extra.md\n");
    write("docs/extra.md", "real file next to the directory token\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md", "docs/extra.md"]);
  });

  it("excludes HTML comments from counts and never follows commented imports", () => {
    write("CLAUDE.md", "<!-- @secret.md -->\nhello\n");
    write("secret.md", "must stay unloaded\n");

    const files = collectAlwaysLoadedFiles(root);
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md"]);
    // Each stripped comment leaves a single space so removal cannot splice
    // surrounding text together: " \nhello\n".
    expect(files[0]?.bytes).toBe(Buffer.byteLength(" \nhello\n", "utf8"));
    expect(files[0]?.lines).toBe(2);
  });

  it("resolves @~/ imports against the home directory", () => {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(path.join(tmpdir(), "musi-context-budget-home-"));
    try {
      process.env.HOME = home;
      writeFileSync(path.join(home, "personal.md"), "home instructions\n");
      write("CLAUDE.md", "@~/personal.md\n");

      const files = collectAlwaysLoadedFiles(root);
      expect(files).toHaveLength(2);
      expect(files[1]?.lines).toBe(1);
      expect(files[1]?.bytes).toBe(18);
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("buildContextBudgetReport", () => {
  it("sums lines, bytes, and estimated tokens across files", () => {
    const report = buildContextBudgetReport([
      { path: "CLAUDE.md", bytes: 10, lines: 1 },
      { path: "AGENTS.md", bytes: 30, lines: 5 },
    ]);
    expect(report.totals).toEqual({ files: 2, lines: 6, bytes: 40, estimatedTokens: 11 });
    expect(report.files[0]).toEqual({
      path: "CLAUDE.md",
      bytes: 10,
      lines: 1,
      estimatedTokens: 3,
    });
  });
});

describe("formatText", () => {
  it("renders one line per file and a machine-greppable total line", () => {
    const text = formatText(buildContextBudgetReport([{ path: "AGENTS.md", bytes: 8, lines: 2 }]));
    expect(text).toContain("AGENTS.md: 2 lines, 8 bytes, ~2 tokens");
    expect(text).toContain("context-budget total: 1 file(s), 2 lines, 8 bytes, ~2 tokens");
  });
});

describe("runContextBudget", () => {
  it("reports the always-loaded set for --root and always exits 0", () => {
    write("CLAUDE.md", "@AGENTS.md\n");
    write("AGENTS.md", "# project instructions live here\n");

    const result = runContextBudget({ argv: ["--root", root] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CLAUDE.md");
    expect(result.stdout).toContain("context-budget total: 2 file(s)");
  });

  it("exits 0 with an explanatory line when nothing is always-loaded", () => {
    const result = runContextBudget({ argv: ["--root", root] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no always-loaded context files found");
  });

  it("emits a machine-readable report with --json", () => {
    write("AGENTS.md", "1234");
    const result = runContextBudget({ argv: ["--root", root, "--json"] });
    expect(result.exitCode).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual({
      files: [{ path: "AGENTS.md", bytes: 4, lines: 1, estimatedTokens: 1 }],
      totals: { files: 1, lines: 1, bytes: 4, estimatedTokens: 1 },
    });
  });

  it("prints usage on --help and rejects unknown flags with exit 2", () => {
    expect(runContextBudget({ argv: ["--help"] }).exitCode).toBe(0);
    expect(runContextBudget({ argv: ["--help"] }).stdout).toContain("sensor:context-budget");
    expect(runContextBudget({ argv: ["--nope"] }).exitCode).toBe(2);
  });
});
