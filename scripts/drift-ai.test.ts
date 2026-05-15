import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALL_CHECKS,
  buildChunkManifest,
  buildReport,
  type ChangedFile,
  DEFAULT_BASE,
  DEFAULT_CHUNK_SIZE,
  discoverChangedFiles,
  type DriftCheckId,
  type DriftFinding,
  filterScope,
  formatJson,
  formatText,
  groupFindingsForChunks,
  type GitRunner,
  isIgnoredPath,
  parseArgs,
  parseNameStatus,
  resolveBaseRef,
  resolveMergeBase,
  resolveRepoRoot,
  runDriftAi,
  type DetectorScope,
  toChangedScopeFile,
  toCurrentScopeFile,
} from "./drift-ai.js";
import type { FileReader } from "./drift-ai/comments.js";
import { parseDriftAiConfig } from "./drift-ai/config.js";
import type { StatRunner } from "./drift-ai/current-inventory.js";
import type { JscpdRunner } from "./drift-ai/duplicates.js";
import type { DirectoryListing } from "./drift-ai/ghost-files.js";
import type { SuppressionsGitRunner } from "./drift-ai/suppressions.js";

function emptyJscpdRunner(): JscpdRunner {
  return () => ({ ok: true, reportJson: '{"duplicates":[]}' });
}

function emptyDirectoryListing(): DirectoryListing {
  return () => [];
}

function emptyFileReader(): FileReader {
  return () => undefined;
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-ai-test-"));
  tempRoots.push(root);
  return root;
}

function makeStubGit(responses: Record<string, string>): GitRunner {
  return (args) => {
    const key = args.join(" ");
    if (key in responses) return responses[key] ?? "";
    throw new Error(`unexpected git invocation: git ${key}`);
  };
}

function makeRunDriftGit(
  changedOutput: string,
  untrackedOutput = "",
  repoRoot = "/repo/musi",
): GitRunner {
  const mergeBase = "merge-base-sha";
  return makeStubGit({
    "rev-parse --verify main": "main-sha",
    "merge-base main HEAD": `${mergeBase}\n`,
    "rev-parse --show-toplevel": repoRoot,
    [`diff --name-status ${mergeBase}`]: changedOutput,
    [`diff ${mergeBase}`]: "",
    "ls-files --others --exclude-standard": untrackedOutput,
  });
}

function changedDetectorScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function nulDelimited(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function makeCurrentGit(repoRoot: string): GitRunner {
  return makeStubGit({ "rev-parse --show-toplevel": `${repoRoot}\n` });
}

function statForCurrentFiles(repoRoot: string, filePaths: readonly string[]): StatRunner {
  const files = new Set(filePaths);
  return (absolutePath) => {
    const relative = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
    if (!files.has(relative)) return undefined;
    return { isFile: () => true };
  };
}

type CapturedWrite = {
  readonly path: string;
  readonly contents: string;
};

function commentHeavySource(): string {
  const lines: string[] = [];
  for (let index = 0; index < 90; index += 1) lines.push(`// invariant note ${index}`);
  for (let index = 0; index < 130; index += 1) lines.push(`const x${index} = ${index};`);
  return lines.join("\n");
}

function ghostPairFiles(count: number): string[] {
  const files: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    files.push(`src/pair-${index}/feature.ts`, `src/pair-${index}/feature-helper.ts`);
  }
  return files;
}

function duplicateFinding(file: string): DriftFinding {
  return {
    check: "duplicates",
    file,
    message: "duplicates src/shared.ts:1-30 (30 lines)",
    hint: "extract or reuse",
  };
}

function ghostFinding(file: string): DriftFinding {
  return {
    check: "ghost-files",
    file,
    message: `${file} ↔ ${file.replace("-helper", "")} -- suspicious sibling pair`,
    hint: "review the pair",
  };
}

function writtenJson(writes: readonly CapturedWrite[], target: string): Record<string, unknown> {
  const write = writes.find((entry) => entry.path === target);
  if (write === undefined) throw new Error(`missing write: ${target}`);
  return JSON.parse(write.contents) as Record<string, unknown>;
}

function writtenText(writes: readonly CapturedWrite[], target: string): string {
  const write = writes.find((entry) => entry.path === target);
  if (write === undefined) throw new Error(`missing write: ${target}`);
  return write.contents;
}

describe("parseArgs", () => {
  it("defaults to base main, all checks, text format", () => {
    const options = parseArgs([]);
    expect(options.scopeMode).toBe("changed");
    expect(options.base).toBe(DEFAULT_BASE);
    expect(options.baseExplicit).toBe(false);
    expect(options.checks).toEqual([...ALL_CHECKS]);
    expect(options.format).toBe("text");
    expect(options.roots).toEqual([]);
    expect(options.configPath).toBeUndefined();
    expect(options.outputPath).toBeUndefined();
    expect(options.chunkDir).toBeUndefined();
    expect(options.chunkSize).toBeUndefined();
  });

  it("includes suppressions in ALL_CHECKS and accepts --check suppressions", () => {
    expect(ALL_CHECKS).toContain("suppressions");
    expect(parseArgs(["--check", "suppressions"]).checks).toEqual(["suppressions"]);
  });

  it("accepts --base ref and --base=ref", () => {
    expect(parseArgs(["--base", "develop"]).base).toBe("develop");
    expect(parseArgs(["--base", "develop"]).baseExplicit).toBe(true);
    expect(parseArgs(["--base=develop"]).base).toBe("develop");
  });

  it("accepts --scope changed/current and rejects unknown scopes", () => {
    expect(parseArgs(["--scope", "changed"]).scopeMode).toBe("changed");
    expect(parseArgs(["--scope=current"]).scopeMode).toBe("current");
    expect(() => parseArgs(["--scope", "workspace"])).toThrow(
      /--scope requires changed or current/u,
    );
  });

  it("collects multiple --check flags and dedupes", () => {
    const options = parseArgs([
      "--check",
      "duplicates",
      "--check=ghost-files",
      "--check",
      "duplicates",
    ]);
    expect(options.checks).toEqual(["duplicates", "ghost-files"]);
  });

  it("--check all expands to every check", () => {
    expect(parseArgs(["--check", "all"]).checks).toEqual([...ALL_CHECKS]);
    expect(parseArgs(["--scope", "current", "--check", "all"]).checks).toEqual([...ALL_CHECKS]);
  });

  it("rejects unknown checks", () => {
    expect(() => parseArgs(["--check", "made-up"])).toThrow(/Unknown check: made-up/u);
  });

  it("parses --format json and rejects garbage", () => {
    expect(parseArgs(["--format", "json"]).format).toBe("json");
    expect(() => parseArgs(["--format", "yaml"])).toThrow(/--format requires text or json/u);
  });

  it("captures --output path and rejects missing values", () => {
    expect(parseArgs(["--output", "report.json"]).outputPath).toBe("report.json");
    expect(() => parseArgs(["--output"])).toThrow(/--output requires a value/u);
  });

  it("captures current-scope roots and config path", () => {
    const options = parseArgs([
      "--scope",
      "current",
      "--root",
      "src",
      "--root=packages",
      "--config",
      "drift-ai.config.json",
    ]);
    expect(options.roots).toEqual(["src", "packages"]);
    expect(options.configPath).toBe("drift-ai.config.json");
  });

  it("captures chunk output options and validates chunk size", () => {
    expect(parseArgs(["--chunk-dir", "reports/chunks"]).chunkSize).toBe(75);
    expect(parseArgs(["--chunk-dir", "reports/chunks", "--chunk-size", "10"]).chunkSize).toBe(10);
    expect(() => parseArgs(["--chunk-size", "10"])).toThrow(/only valid with --chunk-dir/u);
    expect(() => parseArgs(["--chunk-dir", "reports/chunks", "--chunk-size", "0"])).toThrow(
      /positive integer/u,
    );
  });

  it("rejects invalid flag combinations for the first slice", () => {
    expect(() => parseArgs(["--scope", "current", "--base", "main"])).toThrow(
      /current scope has no merge base/u,
    );
    expect(() => parseArgs(["--root", "src"])).toThrow(
      /--root is only valid with --scope current/u,
    );
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument: --nope/u);
  });
});

describe("parseNameStatus", () => {
  it("parses A/M/D/R/C statuses including renames", () => {
    const output = [
      "A\tpackages/server/src/new.ts",
      "M\tpackages/shared/src/index.ts",
      "D\tpackages/client/src/old.tsx",
      "R100\tpackages/server/src/from.ts\tpackages/server/src/to.ts",
      "C75\tpackages/server/src/source.ts\tpackages/server/src/copy.ts",
      "",
      "garbage",
    ].join("\n");
    const parsed = parseNameStatus(output);
    expect(parsed).toEqual([
      { path: "packages/server/src/new.ts", status: "added" },
      { path: "packages/shared/src/index.ts", status: "modified" },
      { path: "packages/client/src/old.tsx", status: "deleted" },
      {
        path: "packages/server/src/to.ts",
        status: "renamed",
        previousPath: "packages/server/src/from.ts",
      },
      {
        path: "packages/server/src/copy.ts",
        status: "copied",
        previousPath: "packages/server/src/source.ts",
      },
    ]);
  });
});

describe("parseDriftAiConfig", () => {
  it("merges a small config with built-in safe defaults", () => {
    const config = parseDriftAiConfig({
      roots: ["packages/server/src"],
      additionalSourceExtensions: [".VUE", ".svelte"],
      ignore: {
        segments: ["custom-generated"],
        prefixes: ["docs/"],
        globs: ["**/*.snap"],
      },
      checks: {
        duplicates: { minLines: 12, excludeGlobs: ["**/*.fixture.ts"] },
        comments: { excludePrefixes: ["scripts/"] },
        "ghost-files": {
          excludeGlobs: ["**/*.stories.tsx"],
          currentAllowedPairs: [
            ["./src/foo-helper.ts", "src/foo.ts"],
            ["src/b.ts", "src/a.ts"],
          ],
        },
      },
    });
    expect(config.roots).toEqual(["packages/server/src"]);
    expect(config.additionalSourceExtensions).toEqual([".svelte", ".vue"]);
    expect(config.ignore.segments).toContain("node_modules");
    expect(config.ignore.segments).toContain("custom-generated");
    expect(config.ignore.prefixes).toContain("docs/");
    expect(config.ignore.globs).toContain("**/*.snap");
    expect(config.checks.duplicates.minLines).toBe(12);
    expect(config.checks.comments.excludePrefixes).toEqual(["scripts/"]);
    expect(config.checks["ghost-files"].excludeGlobs).toEqual(["**/*.stories.tsx"]);
    expect(config.checks["ghost-files"].currentAllowedPairs).toEqual([
      { files: ["src/a.ts", "src/b.ts"] },
      { files: ["src/foo-helper.ts", "src/foo.ts"] },
    ]);
  });

  it("collapses internal dot segments in config roots", () => {
    const config = parseDriftAiConfig({ roots: ["packages/../shared"] });
    expect(config.roots).toEqual(["shared"]);
  });

  it("rejects unknown keys and invalid extension entries", () => {
    expect(() => parseDriftAiConfig({ nope: true })).toThrow(/unknown key 'nope'/u);
    expect(() => parseDriftAiConfig({ additionalSourceExtensions: ["vue"] })).toThrow(
      /leading dot/u,
    );
    expect(() => parseDriftAiConfig({ roots: ["packages/../../escape"] })).toThrow(
      /must stay inside the repo/u,
    );
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { currentAllowedPairs: [["src/foo.ts"]] },
        },
      }),
    ).toThrow(/two-path array/u);
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { currentAllowedPairs: [["src/foo.ts", "../outside.ts"]] },
        },
      }),
    ).toThrow(/must stay inside the repo/u);
  });
});

describe("isIgnoredPath / filterScope", () => {
  it("ignores generated, vendored, build output, lockfiles, and binaries by default", () => {
    const ignored = [
      "node_modules/foo/index.js",
      "vendor/foo/index.js",
      "dist/server.js",
      "build/client.js",
      "coverage/index.html",
      ".next/server.js",
      "out/client.js",
      "target/debug/app.js",
      "generated/api.ts",
      "reports/jscpd.json",
      "tmp/scratch.ts",
      ".husky/pre-commit",
      ".claude/worktrees/x/file.ts",
      "bun.lock",
      "package-lock.json",
      "icons/logo.png",
      "logo.SVG",
      "specs.PDF",
    ];
    for (const file of ignored) {
      expect(isIgnoredPath(file), `expected to ignore ${file}`).toBe(true);
    }
  });

  it("uses config prefixes for project-specific ignores", () => {
    const config = parseDriftAiConfig({
      ignore: {
        prefixes: ["docs/", "packages/server/prisma/migrations/"],
      },
    });
    expect(isIgnoredPath("docs/architecture-plan.md", config.ignore)).toBe(true);
    expect(
      isIgnoredPath("packages/server/prisma/migrations/20240101_init/migration.sql", config.ignore),
    ).toBe(true);
  });

  it("keeps real source files in scope", () => {
    const kept: ChangedFile[] = [
      { path: "packages/server/src/services/foo.ts", status: "modified" },
      { path: "packages/client/src/pages/bar.tsx", status: "added" },
      { path: "packages/shared/src/schemas/baz.ts", status: "modified" },
      { path: "scripts/drift-ai.ts", status: "added" },
    ];
    const filtered = filterScope([...kept, { path: "node_modules/foo.ts", status: "added" }]);
    expect(filtered.map((file) => file.path)).toEqual(kept.map((file) => file.path));
  });
});

describe("discoverChangedFiles", () => {
  it("uses the net working-tree diff from the base and adds untracked files", () => {
    const git = makeStubGit({
      "diff --name-status main": [
        "A\tpackages/server/src/new.ts",
        "R100\tpackages/server/src/from.ts\tpackages/server/src/to.ts",
        "M\tpackages/shared/src/old.ts",
      ].join("\n"),
      "ls-files --others --exclude-standard": "packages/client/src/untracked.tsx",
    });
    const files = discoverChangedFiles("main", git);
    expect(files).toEqual([
      { path: "packages/client/src/untracked.tsx", status: "added" },
      { path: "packages/server/src/new.ts", status: "added" },
      {
        path: "packages/server/src/to.ts",
        status: "renamed",
        previousPath: "packages/server/src/from.ts",
      },
      { path: "packages/shared/src/old.ts", status: "modified" },
    ]);
  });

  it("includes uncommitted edits to tracked files (two-dot diff against base)", () => {
    const git = makeStubGit({
      "diff --name-status main": "M\tpackages/shared/src/already-tracked.ts",
      "ls-files --others --exclude-standard": "",
    });
    const files = discoverChangedFiles("main", git);
    expect(files).toEqual([{ path: "packages/shared/src/already-tracked.ts", status: "modified" }]);
  });
});

describe("resolveRepoRoot", () => {
  it("returns the trimmed top-level path when git answers", () => {
    const git = makeStubGit({ "rev-parse --show-toplevel": "/repo/musi\n" });
    expect(resolveRepoRoot(git)).toBe("/repo/musi");
  });

  it("falls back to process.cwd() when git throws", () => {
    const git: GitRunner = () => {
      throw new Error("not a git repo");
    };
    expect(resolveRepoRoot(git)).toBe(process.cwd());
  });

  it("falls back to process.cwd() on empty output", () => {
    const git = makeStubGit({ "rev-parse --show-toplevel": "" });
    expect(resolveRepoRoot(git)).toBe(process.cwd());
  });
});

describe("resolveBaseRef", () => {
  it("returns the base when it exists", () => {
    const git = makeStubGit({ "rev-parse --verify main": "abc" });
    expect(resolveBaseRef("main", git)).toBe("main");
  });

  it("falls back to origin/<base>", () => {
    const git: GitRunner = (args) => {
      if (args[0] === "rev-parse" && args[2] === "main") throw new Error("not found");
      if (args[0] === "rev-parse" && args[2] === "origin/main") return "abc";
      throw new Error(`unexpected: ${args.join(" ")}`);
    };
    expect(resolveBaseRef("main", git)).toBe("origin/main");
  });

  it("throws DriftAiError when neither exists", () => {
    const git: GitRunner = () => {
      throw new Error("not found");
    };
    expect(() => resolveBaseRef("main", git)).toThrow(/neither 'main' nor 'origin\/main' exists/u);
  });
});

describe("resolveMergeBase", () => {
  it("returns the trimmed merge-base commit", () => {
    const git = makeStubGit({ "merge-base main HEAD": "abc123\n" });
    expect(resolveMergeBase("main", git)).toBe("abc123");
  });

  it("throws DriftAiError when git cannot find a merge base", () => {
    const git: GitRunner = () => {
      throw new Error("not found");
    };
    expect(() => resolveMergeBase("main", git)).toThrow(
      /could not find a merge base between 'main' and HEAD/u,
    );
  });
});

describe("buildReport / formatText / formatJson", () => {
  it("enables every implemented check by default with no skipped list", () => {
    const options = parseArgs([]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const report = buildReport(options, "main", detectorScope, {
      detectorScope,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(report.enabledChecks).toEqual([...ALL_CHECKS]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.findings).toEqual([]);

    const text = formatText(report);
    expect(text).toContain("drift:ai (report-only) -- scope changed -- base main");
    expect(text).toContain("scope: 1 file(s) considered");
    expect(text).not.toContain("skipped:");
    expect(text).toContain(`OK: no findings from checks: ${ALL_CHECKS.join(", ")}`);

    const json = JSON.parse(formatJson(report)) as Record<string, unknown>;
    expect(json["schemaVersion"]).toBe(1);
    expect(json["scopeMode"]).toBe("changed");
    expect(json["base"]).toBe("main");
    expect(json["roots"]).toEqual([]);
    expect(json["configPath"]).toBeNull();
    expect(json["enabledChecks"]).toEqual([...ALL_CHECKS]);
    expect(json["skippedChecks"]).toEqual([]);
    expect(json["scope"]).toEqual(scope.map(toChangedScopeFile));
    expect(json["findings"]).toEqual([]);
  });

  it("wires suppressions through buildReport", () => {
    const options = parseArgs(["--check", "suppressions"]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const suppressionsGit: SuppressionsGitRunner = () =>
      [
        "diff --git a/packages/server/src/foo.ts b/packages/server/src/foo.ts",
        "index 1111111..2222222 100644",
        "--- a/packages/server/src/foo.ts",
        "+++ b/packages/server/src/foo.ts",
        "@@ -4,1 +4,1 @@",
        "+// @ts-ignore -- legacy fixture",
      ].join("\n");

    const report = buildReport(options, "main", detectorScope, {
      detectorScope,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
      suppressionsGit,
      repoRoot: "/repo/musi",
      suppressionDiffRef: "merge-base",
    });

    expect(report.enabledChecks).toEqual(["suppressions"]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.findings).toEqual([
      {
        check: "suppressions",
        file: "packages/server/src/foo.ts",
        message: "new @ts-ignore suppression at line 4 targets next-line (reason: present)",
        hint: expect.stringContaining("prefer `@ts-expect-error`"),
        details: {
          kind: "@ts-ignore",
          target: "next-line",
          line: 4,
          reasonPresent: true,
          text: "// @ts-ignore -- legacy fixture",
        },
      },
    ]);
  });

  it("falls back to no-op runners when no context is supplied", () => {
    // Direct buildReport callers should not need to construct real runners;
    // the defaults keep unit tests free of subprocess and filesystem wiring.
    const options = parseArgs([]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const report = buildReport(options, "main", changedDetectorScope(scope));
    expect(report.findings).toEqual([]);
  });

  it("builds current inventory for direct no-context callers", () => {
    const options = parseArgs(["--scope", "current", "--check", "ghost-files"]);
    const detectorScope: DetectorScope = {
      scopeMode: "current",
      files: ["src/foo.ts", "src/foo-helper.ts"].map(toCurrentScopeFile),
    };
    const report = buildReport(options, null, detectorScope);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.relatedFiles).toEqual(["src/foo-helper.ts", "src/foo.ts"]);
  });

  it("renders a clear placeholder when no checks are enabled (in-flight leaf state)", () => {
    // Reachable when an in-flight leaf adds a new id to ALL_CHECKS before
    // wiring it into IMPLEMENTED_CHECKS. The branch keeps the CLI
    // self-describing during that handoff window. Using "comments" here is
    // arbitrary — formatText only branches on enabledChecks being empty.
    const skipped: ReadonlyArray<DriftCheckId> = ["comments"];
    const text = formatText({
      schemaVersion: 1,
      scopeMode: "changed",
      base: "main",
      resolvedRef: "main",
      roots: [],
      configPath: null,
      enabledChecks: [],
      skippedChecks: skipped,
      scope: [],
      findings: [],
    });
    expect(text).toContain("drift:ai: no implemented checks selected.");
    expect(text).not.toContain("OK: no findings from checks: ");
  });

  it("includes the resolved ref when it differs from --base", () => {
    const options = parseArgs(["--base", "main"]);
    const detectorScope = changedDetectorScope([]);
    const report = buildReport(options, "origin/main", detectorScope, {
      detectorScope,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(formatText(report)).toContain("base main (resolved origin/main)");
  });
});

describe("runDriftAi", () => {
  for (const flag of ["--help", "-h"]) {
    it(`returns exit code 0 for ${flag} without touching git`, () => {
      const result = runDriftAi({
        argv: [flag],
        git: () => {
          throw new Error("git should not be called for help");
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("bun run drift:ai --base <ref>");
      expect(result.stdout).toContain("bun run drift:ai --scope <changed|current>");
      expect(result.stdout).toContain(
        "bun run drift:ai --check <duplicates|ghost-files|comments|suppressions|all>",
      );
      expect(result.stdout).toContain("bun run drift:ai --root <path>");
    });
  }

  it("emits a stable text report on a repo with one changed file", () => {
    const git = makeRunDriftGit("A\tpackages/server/src/foo.ts");
    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai (report-only) -- scope changed -- base main");
    expect(result.stdout).toContain("scope: 1 file(s) considered");
    expect(result.stdout).toContain(`OK: no findings from checks: ${ALL_CHECKS.join(", ")}`);
    expect(result.report?.scope).toEqual([
      { scope: "changed", path: "packages/server/src/foo.ts", status: "added" },
    ]);
    expect(result.report?.scopeMode).toBe("changed");
  });

  it("returns exit code 2 for --scope current outside Git", () => {
    const result = runDriftAi({
      argv: ["--scope", "current"],
      git: () => {
        throw new Error("not a git repo");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("could not resolve Git repo root");
    expect(result.stdout).toContain("not a git repo");
  });

  it("runs --scope current through inventory and renders a tagged report", () => {
    const repoRoot = makeTempDir();
    const files = ["src/app.ts", "src/view.tsx", "README.md"];
    const result = runDriftAi({
      argv: ["--scope", "current"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai (report-only) -- scope current");
    expect(result.stdout).toContain("roots: ./");
    expect(result.stdout).toContain("scope: 2 file(s) considered after ignore filters");
    expect(result.report?.base).toBeNull();
    expect(result.report?.resolvedRef).toBeNull();
    expect(result.report?.scope).toEqual([
      { scope: "current", path: "src/app.ts" },
      { scope: "current", path: "src/view.tsx" },
    ]);
    if (result.report === undefined) throw new Error("expected current report");
    const json = JSON.parse(formatJson(result.report)) as Record<string, unknown>;
    expect(json["schemaVersion"]).toBe(1);
    expect(json["scopeMode"]).toBe("current");
    expect(json["base"]).toBeNull();
    expect(json["resolvedRef"]).toBeNull();
    expect(json["scope"]).toEqual([
      { scope: "current", path: "src/app.ts" },
      { scope: "current", path: "src/view.tsx" },
    ]);
  });

  it("drives --scope current --check duplicates end-to-end with a jscpd clone", () => {
    const repoRoot = makeTempDir();
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const calls: string[] = [];
    const jscpd: JscpdRunner = (input) => {
      calls.push(input.scopePath);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 12,
              firstFile: { name: "src/b.ts", start: 3, end: 14 },
              secondFile: { name: "src/a.ts", start: 7, end: 18 },
            },
          ],
        }),
      };
    };
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "duplicates"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      jscpd,
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(["."]);
    expect(result.stdout).toContain("drift:ai (report-only) -- scope current");
    expect(result.stdout).toContain("WARN duplicates: src/a.ts:7-18");
    expect(result.report?.findings).toEqual([
      {
        check: "duplicates",
        file: "src/a.ts:7-18",
        message: "duplicates src/b.ts:3-14 (12 lines)",
        hint: expect.stringContaining("extract or reuse"),
      },
    ]);
  });

  it("does not reapply shared ignore globs for current duplicates", () => {
    const repoRoot = makeTempDir();
    mkdirSync(path.join(repoRoot, "ignored"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({ ignore: { globs: ["ignored/**"] } }),
    );
    const files = ["ignored/a.ts", "ignored/b.ts"];
    const ignoreArgs: string[][] = [];
    const jscpd: JscpdRunner = (input) => {
      ignoreArgs.push([...input.ignoreGlobs]);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 12,
              firstFile: { name: "ignored/b.ts", start: 3, end: 14 },
              secondFile: { name: "ignored/a.ts", start: 7, end: 18 },
            },
          ],
        }),
      };
    };
    const result = runDriftAi({
      argv: ["--scope", "current", "--root", "ignored", "--check", "duplicates"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      jscpd,
    });
    const warnLines = result.stdout.split("\n").filter((line) => line.includes("WARN duplicates"));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("roots: ignored");
    expect(result.stdout).toContain("scope: 2 file(s) considered after ignore filters");
    expect(ignoreArgs).toHaveLength(1);
    expect(ignoreArgs[0]).not.toContain("ignored/**");
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain("WARN duplicates: ignored/a.ts:7-18");
  });

  it("--scope current --check ghost-files enables only ghost-files with no findings", () => {
    const repoRoot = makeTempDir();
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "ghost-files"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(["src/app.ts"]),
      stat: statForCurrentFiles(repoRoot, ["src/app.ts"]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.enabledChecks).toEqual(["ghost-files"]);
    expect(result.report?.findings).toEqual([]);
    expect(result.stdout).toContain("scope current");
  });

  it("drives --scope current --check ghost-files end-to-end with an inventory pair", () => {
    const repoRoot = makeTempDir();
    const files = ["src/foo/bar.ts", "src/foo/bar-helper.ts"];
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "ghost-files"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      listDirectory: () => {
        throw new Error("current ghost-files must not use listDirectory");
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai (report-only) -- scope current");
    expect(result.stdout).toContain("WARN ghost-files: src/foo/bar-helper.ts");
    expect(result.stdout).toContain("suspicious sibling pair");
    expect(result.report?.findings).toEqual([
      {
        check: "ghost-files",
        file: "src/foo/bar-helper.ts",
        message: expect.stringContaining("src/foo/bar-helper.ts ↔ src/foo/bar.ts"),
        hint: expect.stringContaining(
          "bun run code:intel -- dependents src/foo/bar-helper.ts; bun run code:intel -- dependents src/foo/bar.ts",
        ),
        relatedFiles: ["src/foo/bar-helper.ts", "src/foo/bar.ts"],
      },
    ]);
  });

  it("honors currentAllowedPairs from config for current ghost-files only", () => {
    const repoRoot = makeTempDir();
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({
        checks: {
          "ghost-files": {
            currentAllowedPairs: [["src/foo/bar-helper.ts", "src/foo/bar.ts"]],
          },
        },
      }),
    );
    const files = [
      "src/foo/bar.ts",
      "src/foo/bar-helper.ts",
      "src/foo/baz.ts",
      "src/foo/baz-helper.ts",
    ];
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "ghost-files"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      listDirectory: () => {
        throw new Error("current ghost-files must not use listDirectory");
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toHaveLength(1);
    expect(result.report?.findings[0]?.relatedFiles).toEqual([
      "src/foo/baz-helper.ts",
      "src/foo/baz.ts",
    ]);
    expect(result.stdout).not.toContain("src/foo/bar-helper.ts");
    expect(result.stdout).toContain("WARN ghost-files: src/foo/baz-helper.ts");
  });

  it("does not reapply shared ignore globs for current ghost-files", () => {
    const repoRoot = makeTempDir();
    mkdirSync(path.join(repoRoot, "ignored"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({ ignore: { globs: ["ignored/**"] } }),
    );
    const files = ["ignored/foo.ts", "ignored/foo-helper.ts"];
    const result = runDriftAi({
      argv: ["--scope", "current", "--root", "ignored", "--check", "ghost-files"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      listDirectory: () => {
        throw new Error("current ghost-files must not use listDirectory");
      },
    });
    const warnLines = result.stdout.split("\n").filter((line) => line.includes("WARN ghost-files"));
    const warnLine = warnLines[0];
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("scope: 2 file(s) considered after ignore filters");
    expect(warnLines).toHaveLength(1);
    if (warnLine === undefined) throw new Error("expected one ghost-files warning");
    expect(warnLine).toContain("ignored/foo-helper.ts ↔ ignored/foo.ts");
  });

  it("collapses internal dot segments in explicit current roots before inventory matching", () => {
    const repoRoot = makeTempDir();
    mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    const files = ["scripts/drift-ai.ts", "packages/server/src/app.ts"];
    const result = runDriftAi({
      argv: ["--scope", "current", "--root", "packages/../scripts", "--check", "ghost-files"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("roots: scripts");
    expect(result.stdout).toContain("scope: 1 file(s) considered after ignore filters");
    expect(result.report?.roots).toEqual(["scripts"]);
    expect(result.report?.scope).toEqual([{ scope: "current", path: "scripts/drift-ai.ts" }]);
  });

  it("rejects explicit current roots that escape the repo after dot-segment collapse", () => {
    const repoRoot = makeTempDir();
    const result = runDriftAi({
      argv: ["--scope", "current", "--root", "packages/../../escape"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => {
        throw new Error("inventory should not run after root validation fails");
      },
      stat: statForCurrentFiles(repoRoot, []),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--root packages/../../escape: must stay inside the repo");
  });

  it("--scope current rejects explicit roots that do not exist", () => {
    const repoRoot = makeTempDir();
    const result = runDriftAi({
      argv: ["--scope", "current", "--root", "packages/server/src"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => {
        throw new Error("inventory should not run after root validation fails");
      },
      stat: statForCurrentFiles(repoRoot, []),
      rootExists: () => false,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--root 'packages/server/src' does not exist");
  });

  it("auto-loads drift-ai.config.json for --scope current reports", () => {
    const repoRoot = makeTempDir();
    writeFileSync(path.join(repoRoot, "drift-ai.config.json"), JSON.stringify({}));
    const result = runDriftAi({
      argv: ["--scope", "current", "--format", "json"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(["src/app.ts"]),
      stat: statForCurrentFiles(repoRoot, ["src/app.ts"]),
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(payload["schemaVersion"]).toBe(1);
    expect(payload["configPath"]).toBe("drift-ai.config.json");
  });

  it("loads explicit config errors before touching git", () => {
    let gitCalls = 0;
    const result = runDriftAi({
      argv: ["--config", path.join(makeTempDir(), "missing.json")],
      git: () => {
        gitCalls += 1;
        throw new Error("git should not be called");
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("does not exist");
    expect(gitCalls).toBe(0);
  });

  it("returns config parse and schema errors as argument errors", () => {
    const dir = makeTempDir();
    const invalidJson = path.join(dir, "invalid.json");
    const unknownKey = path.join(dir, "unknown.json");
    writeFileSync(invalidJson, "{not json");
    writeFileSync(unknownKey, JSON.stringify({ unknown: true }));

    const invalid = runDriftAi({ argv: ["--config", invalidJson], git: makeStubGit({}) });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stdout).toContain("is not valid JSON");

    const unknown = runDriftAi({ argv: ["--config", unknownKey], git: makeStubGit({}) });
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout).toContain("unknown key 'unknown'");
  });

  it("auto-loads drift-ai.config.json from the repo root", () => {
    const repoRoot = makeTempDir();
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({ ignore: { prefixes: ["docs/"] } }),
    );
    const git = makeRunDriftGit(
      ["A\tdocs/agent_notes/STATUS.md", "A\tpackages/server/src/foo.ts"].join("\n"),
      "",
      repoRoot,
    );
    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.configPath).toBe("drift-ai.config.json");
    expect(result.report?.scope.map((file) => file.path)).toEqual(["packages/server/src/foo.ts"]);
  });

  it("does not auto-load .drift-ai.json", () => {
    const repoRoot = makeTempDir();
    writeFileSync(
      path.join(repoRoot, ".drift-ai.json"),
      JSON.stringify({ ignore: { prefixes: ["packages/"] } }),
    );
    const git = makeRunDriftGit("A\tpackages/server/src/foo.ts", "", repoRoot);
    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.configPath).toBeNull();
    expect(result.report?.scope.map((file) => file.path)).toEqual(["packages/server/src/foo.ts"]);
  });

  it("lets explicit --config win over the auto-loaded repo config", () => {
    const repoRoot = makeTempDir();
    const explicitConfig = path.join(repoRoot, "custom-drift.json");
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({ ignore: { prefixes: ["packages/"] } }),
    );
    writeFileSync(explicitConfig, JSON.stringify({ ignore: { prefixes: ["docs/"] } }));
    const git = makeRunDriftGit("A\tpackages/server/src/foo.ts", "", repoRoot);
    const result = runDriftAi({
      argv: ["--config", explicitConfig],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.configPath).toBe(explicitConfig);
    expect(result.report?.scope.map((file) => file.path)).toEqual(["packages/server/src/foo.ts"]);
  });

  it("discovers changed files from the merge base, not the advanced base ref", () => {
    const calls: string[] = [];
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      calls.push(key);
      switch (key) {
        case "rev-parse --verify main":
          return "advanced-main-sha";
        case "merge-base main HEAD":
          return "branch-point-sha\n";
        case "diff --name-status branch-point-sha":
          return [
            "M\tpackages/server/src/feature.ts",
            "M\tpackages/shared/src/worktree-edit.ts",
          ].join("\n");
        case "diff branch-point-sha":
          return "";
        case "ls-files --others --exclude-standard":
          return "packages/client/src/untracked.tsx\n";
        case "rev-parse --show-toplevel":
          return "/repo/musi";
        default:
          throw new Error(`unexpected git invocation: git ${key}`);
      }
    };

    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toContain("merge-base main HEAD");
    expect(calls).not.toContain("diff --name-status main");
    expect(result.report?.scope).toEqual([
      { scope: "changed", path: "packages/client/src/untracked.tsx", status: "added" },
      { scope: "changed", path: "packages/server/src/feature.ts", status: "modified" },
      { scope: "changed", path: "packages/shared/src/worktree-edit.ts", status: "modified" },
    ]);
  });

  it("filters ignored paths out of the reported scope", () => {
    const dir = makeTempDir();
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        ignore: {
          prefixes: ["docs/"],
        },
      }),
    );
    const git = makeRunDriftGit(
      [
        "A\tpackages/server/src/foo.ts",
        "M\tnode_modules/dep/index.js",
        "M\tdocs/agent_notes/STATUS.md",
        "A\tassets/banner.png",
      ].join("\n"),
    );
    const result = runDriftAi({
      argv: ["--config", configPath],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.report?.scope.map((file) => file.path)).toEqual(["packages/server/src/foo.ts"]);
  });

  it("writes JSON output to --output path and reports the destination", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "drift.json");
    const git = makeRunDriftGit("A\tpackages/server/src/foo.ts");
    const writes: Array<{ path: string; contents: string }> = [];
    const result = runDriftAi({
      argv: ["--format", "json", "--output", target],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
      writer: (writePath, contents) => {
        writes.push({ path: writePath, contents });
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`drift:ai: wrote json report to ${target}`);
    expect(writes).toHaveLength(1);
    const written = writes[0];
    if (!written) throw new Error("expected one write");
    expect(written.path).toBe(target);
    const payload = JSON.parse(written.contents) as Record<string, unknown>;
    expect(payload["schemaVersion"]).toBe(1);
    expect(payload["scopeMode"]).toBe("changed");
    expect(payload["base"]).toBe("main");
    expect(payload["scope"]).toEqual([
      { scope: "changed", path: "packages/server/src/foo.ts", status: "added" },
    ]);
  });

  it("falls back to writeFileSync when no writer override is supplied", () => {
    const dir = makeTempDir();
    const target = path.join(dir, "drift.json");
    const git = makeRunDriftGit("");
    const result = runDriftAi({
      argv: ["--format", "json", "--output", target],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    const onDisk = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    expect(onDisk["schemaVersion"]).toBe(1);
    expect(onDisk["base"]).toBe("main");
    expect(onDisk["scope"]).toEqual([]);
  });

  it("forwards a stubbed jscpd runner finding through to the rendered report", () => {
    const git = makeRunDriftGit("M\tpackages/server/src/utils/character-auth.ts");
    const calls: string[] = [];
    const jscpd: JscpdRunner = (input) => {
      calls.push(input.scopePath);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              format: "typescript",
              lines: 29,
              firstFile: {
                name: "packages/server/src/utils/character-auth.ts",
                start: 40,
                end: 68,
              },
              secondFile: {
                name: "packages/server/src/utils/campaign-auth.ts",
                start: 22,
                end: 50,
              },
            },
          ],
        }),
      };
    };
    const result = runDriftAi({
      argv: [],
      git,
      jscpd,
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(["packages/server/src"]);
    expect(result.report?.findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/utils/character-auth.ts:40-68",
        message: "duplicates packages/server/src/utils/campaign-auth.ts:22-50 (29 lines)",
        hint: expect.stringContaining("extract or reuse"),
      },
    ]);
    expect(result.stdout).toContain(
      "WARN duplicates: packages/server/src/utils/character-auth.ts:40-68",
    );
  });

  it("surfaces a jscpd subprocess failure as a finding without breaking exit 0", () => {
    const git = makeRunDriftGit("M\tpackages/server/src/utils/character-auth.ts");
    const jscpd: JscpdRunner = () => ({ ok: false, error: "binary missing" });
    const result = runDriftAi({
      argv: [],
      git,
      jscpd,
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: expect.stringContaining("jscpd subprocess failed (binary missing)"),
        hint: expect.stringContaining("Re-run drift:ai locally"),
      },
    ]);
  });

  it("warns once when configured additional source extensions are unsupported by jscpd", () => {
    const repoRoot = makeTempDir();
    const configPath = path.join(repoRoot, "drift-ai.config.json");
    writeFileSync(configPath, JSON.stringify({ additionalSourceExtensions: [".vue"] }));
    const messages: string[] = [];
    const result = runDriftAi({
      argv: ["--config", configPath, "--check", "duplicates"],
      git: makeRunDriftGit("M\tpackages/server/src/foo.ts", "", repoRoot),
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
      warnStderr: (message) => messages.push(message),
    });
    expect(result.exitCode).toBe(0);
    expect(messages).toEqual([
      "drift:ai: configured additionalSourceExtensions [.vue] are not covered by jscpd; duplicates will not flag them.",
    ]);
  });

  it("does not warn about unsupported duplicate extensions when duplicates is not scheduled", () => {
    const repoRoot = makeTempDir();
    const configPath = path.join(repoRoot, "drift-ai.config.json");
    writeFileSync(configPath, JSON.stringify({ additionalSourceExtensions: [".vue"] }));
    const messages: string[] = [];
    const result = runDriftAi({
      argv: ["--config", configPath, "--check", "ghost-files"],
      git: makeRunDriftGit("M\tpackages/server/src/foo.ts", "", repoRoot),
      jscpd: () => {
        throw new Error("duplicates should not run");
      },
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
      warnStderr: (message) => messages.push(message),
    });
    expect(result.exitCode).toBe(0);
    expect(messages).toEqual([]);
  });

  it("does not invoke jscpd when no production-source files changed", () => {
    let jscpdCalls = 0;
    const git = makeRunDriftGit(
      ["A\tpackages/server/src/foo.test.ts", "M\tdocs/agent_notes/STATUS.md"].join("\n"),
    );
    const jscpd: JscpdRunner = () => {
      jscpdCalls += 1;
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    const result = runDriftAi({
      argv: [],
      git,
      jscpd,
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toEqual([]);
    expect(jscpdCalls).toBe(0);
  });

  it("forwards a stubbed listDirectory finding through to the rendered ghost-files report", () => {
    const git = makeRunDriftGit("A\tpackages/server/src/utils/character-auth-utils.ts");
    const dir = "packages/server/src/utils";
    const listDirectory: DirectoryListing = (queried) =>
      queried === dir ? ["character-auth-utils.ts", "character-auth.ts"] : [];
    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory,
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toEqual([
      {
        check: "ghost-files",
        file: `${dir}/character-auth-utils.ts`,
        message: expect.stringContaining(`looks like a sibling of ${dir}/character-auth.ts`),
        hint: expect.stringContaining(`bun run code:intel -- dependents ${dir}/character-auth.ts`),
        relatedFiles: [`${dir}/character-auth-utils.ts`, `${dir}/character-auth.ts`].sort(),
      },
    ]);
    expect(result.stdout).toContain(`WARN ghost-files: ${dir}/character-auth-utils.ts`);
  });

  it("forwards a stubbed readFile finding through to the rendered comments report", () => {
    const target = "packages/server/src/services/example.ts";
    const git = makeRunDriftGit(`M\t${target}`);
    const readFile: FileReader = (queried) =>
      queried === target ? commentHeavySource() : undefined;
    const result = runDriftAi({
      argv: [],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toEqual([
      {
        check: "comments",
        file: target,
        message: expect.stringContaining(
          "41% of non-blank lines are comments over 130 effective code lines",
        ),
        hint: expect.stringContaining("keep comments that explain invariants"),
      },
    ]);
    expect(result.stdout).toContain(`WARN comments: ${target}`);
  });

  it("drives --scope current --check comments end-to-end", () => {
    const repoRoot = makeTempDir();
    const target = "src/current-comment-heavy.ts";
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "comments"],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited([target]),
      stat: statForCurrentFiles(repoRoot, [target]),
      readFile: (queried) => (queried === target ? commentHeavySource() : undefined),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai (report-only) -- scope current");
    expect(result.stdout).toContain(`WARN comments: ${target}`);
    expect(result.report?.findings).toEqual([
      {
        check: "comments",
        file: target,
        message: expect.stringContaining(
          "41% of non-blank lines are comments over 130 effective code lines",
        ),
        hint: expect.stringContaining("keep comments that explain invariants"),
      },
    ]);
  });

  it("--scope current --chunk-dir writes manifest and ghost-file chunks", () => {
    const repoRoot = makeTempDir();
    const chunkDir = path.join(makeTempDir(), "chunks");
    const files = ghostPairFiles(5);
    const writes: CapturedWrite[] = [];
    const result = runDriftAi({
      argv: [
        "--scope",
        "current",
        "--check",
        "ghost-files",
        "--chunk-dir",
        chunkDir,
        "--chunk-size",
        "2",
      ],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      writer: (writePath, contents) => writes.push({ path: writePath, contents }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `chunks: ${path.join(chunkDir, "manifest.json")} (3 chunk(s), 5 finding(s))`,
    );
    const manifest = writtenJson(writes, path.join(chunkDir, "manifest.json"));
    expect(manifest["schemaVersion"]).toBe(1);
    expect(manifest["scopeMode"]).toBe("current");
    expect(manifest["roots"]).toEqual([]);
    expect(manifest["enabledChecks"]).toEqual(["ghost-files"]);
    expect(manifest["totalFindings"]).toBe(5);
    expect(manifest["chunkSize"]).toBe(2);
    expect(manifest["chunks"]).toEqual([
      { index: 1, path: "001-ghost-files.json", check: "ghost-files", findingCount: 2 },
      { index: 2, path: "002-ghost-files.json", check: "ghost-files", findingCount: 2 },
      { index: 3, path: "003-ghost-files.json", check: "ghost-files", findingCount: 1 },
    ]);

    const expectedFindings = result.report?.findings;
    if (expectedFindings === undefined) throw new Error("expected report findings");
    const sliceBounds = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 },
    ];
    for (const index of [1, 2, 3]) {
      const filename = `${String(index).padStart(3, "0")}-ghost-files.json`;
      const chunk = writtenJson(writes, path.join(chunkDir, filename));
      const bounds = sliceBounds[index - 1];
      if (bounds === undefined) throw new Error("missing chunk bounds");
      expect(chunk["scopeMode"]).toBe("current");
      expect(chunk["roots"]).toEqual([]);
      expect(chunk["enabledChecks"]).toEqual(["ghost-files"]);
      expect(chunk["totalFindings"]).toBe(5);
      expect(chunk["chunkSize"]).toBe(2);
      expect(chunk["chunkIndex"]).toBe(index);
      expect(chunk["chunkCount"]).toBe(3);
      expect(chunk["check"]).toBe("ghost-files");
      expect(chunk["findings"]).toEqual(expectedFindings.slice(bounds.start, bounds.end));
    }
  });

  it("--chunk-dir writes only a manifest when there are zero findings", () => {
    const repoRoot = makeTempDir();
    const chunkDir = path.join(makeTempDir(), "empty-chunks");
    const writes: CapturedWrite[] = [];
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "ghost-files", "--chunk-dir", chunkDir],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(["src/app.ts"]),
      stat: statForCurrentFiles(repoRoot, ["src/app.ts"]),
      writer: (writePath, contents) => writes.push({ path: writePath, contents }),
    });
    expect(result.exitCode).toBe(0);
    expect(writes.map((write) => write.path)).toEqual([path.join(chunkDir, "manifest.json")]);
    expect(writtenJson(writes, path.join(chunkDir, "manifest.json"))).toMatchObject({
      schemaVersion: 1,
      scopeMode: "current",
      totalFindings: 0,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunks: [],
    });
  });

  it("chunk helpers let chunks straddle check groups", () => {
    const findings: DriftFinding[] = [
      ghostFinding("src/a-helper.ts"),
      ghostFinding("src/b-helper.ts"),
      ghostFinding("src/c-helper.ts"),
      duplicateFinding("src/a.ts:1-30"),
      duplicateFinding("src/b.ts:1-30"),
    ];
    const chunks = groupFindingsForChunks(
      findings,
      "current",
      ["src"],
      ["ghost-files", "duplicates"],
      4,
    );
    const manifest = buildChunkManifest(
      "current",
      ["src"],
      ["ghost-files", "duplicates"],
      findings.length,
      4,
      chunks,
    );

    expect(manifest.chunks).toEqual([
      { index: 1, path: "001-ghost-files.json", check: "ghost-files", findingCount: 4 },
      { index: 2, path: "002-duplicates.json", check: "duplicates", findingCount: 1 },
    ]);
    expect(chunks[0]?.findings.map((finding) => finding.check)).toEqual([
      "ghost-files",
      "ghost-files",
      "ghost-files",
      "duplicates",
    ]);
    expect(chunks[1]?.findings.map((finding) => finding.check)).toEqual(["duplicates"]);
  });

  it("--chunk-dir is additive to --output", () => {
    const repoRoot = makeTempDir();
    const dir = makeTempDir();
    const outputPath = path.join(dir, "drift.txt");
    const chunkDir = path.join(dir, "chunks");
    const files = ghostPairFiles(1);
    const writes: CapturedWrite[] = [];
    const result = runDriftAi({
      argv: [
        "--scope",
        "current",
        "--check",
        "ghost-files",
        "--output",
        outputPath,
        "--chunk-dir",
        chunkDir,
      ],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      writer: (writePath, contents) => writes.push({ path: writePath, contents }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `drift:ai: wrote text report to ${outputPath}\nchunks: ${path.join(
        chunkDir,
        "manifest.json",
      )} (1 chunk(s), 1 finding(s))`,
    );
    expect(writtenText(writes, outputPath)).toContain("WARN ghost-files:");
    expect(writtenJson(writes, path.join(chunkDir, "manifest.json"))["chunks"]).toEqual([
      { index: 1, path: "001-ghost-files.json", check: "ghost-files", findingCount: 1 },
    ]);
    expect(writes.map((write) => write.path)).toContain(
      path.join(chunkDir, "001-ghost-files.json"),
    );
  });

  it("--chunk-dir without --chunk-size defaults to DEFAULT_CHUNK_SIZE", () => {
    const repoRoot = makeTempDir();
    const chunkDir = path.join(makeTempDir(), "default-size-chunks");
    const files = Array.from({ length: 76 }, (_, index) => `src/source-${index}.ts`);
    const jscpd: JscpdRunner = () => ({
      ok: true,
      reportJson: JSON.stringify({
        duplicates: files.map((file, index) => ({
          lines: 30,
          firstFile: { name: file, start: 1, end: 30 },
          secondFile: { name: `src/shared-${index}.ts`, start: 1, end: 30 },
        })),
      }),
    });
    const writes: CapturedWrite[] = [];
    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "duplicates", "--chunk-dir", chunkDir],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      jscpd,
      writer: (writePath, contents) => writes.push({ path: writePath, contents }),
    });
    expect(result.exitCode).toBe(0);
    const manifest = writtenJson(writes, path.join(chunkDir, "manifest.json"));
    expect(manifest["chunkSize"]).toBe(DEFAULT_CHUNK_SIZE);
    expect(manifest["chunks"]).toEqual([
      { index: 1, path: "001-duplicates.json", check: "duplicates", findingCount: 75 },
      { index: 2, path: "002-duplicates.json", check: "duplicates", findingCount: 1 },
    ]);
  });

  it("JSON output and chunked output coexist", () => {
    const repoRoot = makeTempDir();
    const chunkDir = path.join(makeTempDir(), "json-chunks");
    const files = ghostPairFiles(1);
    const writes: CapturedWrite[] = [];
    const stderr: string[] = [];
    const result = runDriftAi({
      argv: [
        "--scope",
        "current",
        "--check",
        "ghost-files",
        "--format",
        "json",
        "--chunk-dir",
        chunkDir,
      ],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      writer: (writePath, contents) => writes.push({ path: writePath, contents }),
      warnStderr: (message) => stderr.push(message),
    });
    expect(result.exitCode).toBe(0);
    // Stdout must remain valid JSON when --format json is paired with --chunk-dir
    // (no --output) — the chunk pointer is routed to stderr to avoid corrupting it.
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(payload["schemaVersion"]).toBe(1);
    expect(payload["scopeMode"]).toBe("current");
    expect(stderr).toContain(
      `chunks: ${path.join(chunkDir, "manifest.json")} (1 chunk(s), 1 finding(s))`,
    );
    expect(writtenJson(writes, path.join(chunkDir, "manifest.json"))["chunks"]).toEqual([
      { index: 1, path: "001-ghost-files.json", check: "ghost-files", findingCount: 1 },
    ]);
    expect(writtenJson(writes, path.join(chunkDir, "001-ghost-files.json"))["findings"]).toEqual(
      payload["findings"],
    );
  });

  it("returns exit code 2 with usage on argument errors", () => {
    const result = runDriftAi({ argv: ["--check", "made-up"], git: makeStubGit({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Unknown check: made-up");
  });

  it("returns exit code 2 with a clear message when the base ref cannot be resolved", () => {
    const git: GitRunner = () => {
      throw new Error("not found");
    };
    const result = runDriftAi({ argv: ["--base", "missing"], git });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("neither 'missing' nor 'origin/missing' exists");
  });

  it("returns exit code 2 with a clear message when the merge base cannot be resolved", () => {
    const git = makeStubGit({ "rev-parse --verify main": "main-sha" });
    const result = runDriftAi({ argv: [], git });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("could not find a merge base between 'main' and HEAD");
  });
});
