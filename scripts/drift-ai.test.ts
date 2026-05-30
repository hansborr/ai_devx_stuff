import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALL_CHECKS,
  buildInventoryByDir,
  buildReport,
  buildSourceExtensions,
  type ChangedFile,
  CHECK_PLUGINS,
  DEFAULT_BASE,
  DEFAULT_CHECKS,
  DEFAULT_CHUNK_SIZE,
  type DetectorScope,
  discoverChangedFiles,
  DRIFT_SCHEMA_VERSION,
  DriftAiError,
  filterScope,
  formatJson,
  formatText,
  type GitRunner,
  isIgnoredPath,
  parseArgs,
  parseNameStatus,
  resolveBaseRef,
  resolveMergeBase,
  resolveRepoRoot,
  runDriftAi,
  toChangedScopeFile,
  toCurrentScopeFile,
} from "./drift-ai.js";
import type { CheckOverrides, CheckRunInput } from "./drift-ai/check-plugin.js";
import type { FileReader } from "./drift-ai/comments.js";
import { parseDriftAiConfig } from "./drift-ai/config.js";
import type { StatRunner } from "./drift-ai/current-inventory.js";
import type { JscpdRunner } from "./drift-ai/duplicates-runner.js";
import {
  DEFAULT_DEPENDENTS_HINT,
  DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
  DEFAULT_GHOST_FILE_WEAK_TOKENS,
  type DirectoryListing,
  GHOST_FILES_REPAIR_HINT_PREFIX,
} from "./drift-ai/ghost-files.js";
import {
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  NEAR_DUPLICATE_TOOL,
} from "./drift-ai/near-duplicates.js";
import { nearDuplicatesCheck } from "./drift-ai/near-duplicates-check.js";
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

// Hermetic default injection seam: no-op runners for every adapter so a buildReport
// test never spawns a real tool or touches the filesystem. Tests override individual
// entries (or set `jscpd: undefined` + `binExists` to exercise tool-unavailable).
const DEFAULT_OVERRIDES: CheckOverrides = {
  jscpd: emptyJscpdRunner(),
  knip: () => ({ ok: false, reason: "tool-unavailable", error: "knip not provided in test" }),
  moduleGraph: () => ({ ok: false, error: "module-graph not provided in test" }),
  nearDuplicates: () => ({ ok: true, engine: "ts-morph", functions: [] }),
  listDirectory: () => [],
  readFile: () => undefined,
  suppressionsGit: () => "",
  pathExists: () => false,
};

// Overrides for the buildReport run input. `overrides` is the injected runner seam
// each plugin resolves its own services from; `cli` lets a test drive the
// tool-override flags (jscpd-bin/knip-config/tsconfig) plugins read at resolve time.
type CheckContextOverrides = {
  readonly config?: CheckRunInput["config"];
  readonly repoRoot?: string;
  readonly suppressionDiffRef?: string | null;
  readonly warnStderr?: (message: string) => void;
  readonly overrides?: CheckOverrides;
  readonly cli?: ReturnType<typeof parseArgs>;
};

function makeCheckRunContext(
  detectorScope: DetectorScope,
  overrides: CheckContextOverrides = {},
): CheckRunInput {
  const config = overrides.config ?? parseDriftAiConfig({});
  const repoRoot = overrides.repoRoot ?? "/repo/musi";
  return {
    detectorScope,
    inventoryByDir:
      detectorScope.scopeMode === "current" ? buildInventoryByDir(detectorScope.files) : null,
    repoRoot,
    suppressionDiffRef: overrides.suppressionDiffRef ?? null,
    config,
    roots: config.roots,
    sourceExtensions: buildSourceExtensions(config.additionalSourceExtensions),
    warnStderr: overrides.warnStderr ?? (() => undefined),
    env: {
      repoRoot,
      overrides: { ...DEFAULT_OVERRIDES, ...overrides.overrides },
      cli: overrides.cli ?? parseArgs([]),
    },
  };
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

function captureThrown(callback: () => void): unknown {
  try {
    callback();
  } catch (err) {
    return err;
  }
  throw new Error("expected callback to throw");
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
    "rev-parse --is-shallow-repository": "false\n",
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

const CODE_INTEL_DEPENDENTS_HINT = "Run: bun run code:intel -- dependents {path}";

function renderDependentsHint(template: string, peerPath: string): string {
  return template.split("{path}").join(peerPath);
}

function defaultCurrentPairHint(left: string, right: string): string {
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `${renderDependentsHint(DEFAULT_DEPENDENTS_HINT, left)}; ${renderDependentsHint(
      DEFAULT_DEPENDENTS_HINT,
      right,
    )}`,
  ].join(" ");
}

function defaultRepairHint(peerPath: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} ${renderDependentsHint(
    DEFAULT_DEPENDENTS_HINT,
    peerPath,
  )}`;
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
  it("defaults to base main, default checks, text format", () => {
    const options = parseArgs([]);
    expect(options.scopeMode).toBe("changed");
    expect(options.base).toBe(DEFAULT_BASE);
    expect(options.baseExplicit).toBe(false);
    expect(options.checks).toEqual([...DEFAULT_CHECKS]);
    expect(options.format).toBe("text");
    expect(options.roots).toEqual([]);
    expect(options.configPath).toBeUndefined();
    expect(options.outputPath).toBeUndefined();
    expect(options.chunkDir).toBeUndefined();
    expect(options.chunkSize).toBeUndefined();
    expect(options.includeScope).toBe(false);
    expect(options.failOnFindings).toBe(false);
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

  it("parses --include-scope as an opt-in JSON flag", () => {
    expect(parseArgs([]).includeScope).toBe(false);
    expect(parseArgs(["--include-scope"]).includeScope).toBe(true);
    expect(() => parseArgs(["--include-scope=true"])).toThrow(
      /--include-scope does not accept a value/u,
    );
  });

  it("parses --fail-on-findings as an opt-in exit flag", () => {
    expect(parseArgs([]).failOnFindings).toBe(false);
    expect(parseArgs(["--fail-on-findings"]).failOnFindings).toBe(true);
    expect(() => parseArgs(["--fail-on-findings=true"])).toThrow(
      /--fail-on-findings does not accept a value/u,
    );
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

  it("captures --jscpd-bin path and rejects an empty value", () => {
    expect(parseArgs(["--jscpd-bin", "/tools/node_modules/.bin/jscpd"]).jscpdBin).toBe(
      "/tools/node_modules/.bin/jscpd",
    );
    expect(parseArgs(["--jscpd-bin=/abs/jscpd"]).jscpdBin).toBe("/abs/jscpd");
    expect(parseArgs([]).jscpdBin).toBeUndefined();
    expect(() => parseArgs(["--jscpd-bin="])).toThrow(/--jscpd-bin requires a path/u);
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
          dependentsHint: CODE_INTEL_DEPENDENTS_HINT,
          weakTokens: ["Controller", "controller", "service"],
          entryPointStems: ["Mod", "mod", "index.server"],
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
    expect(config.checks["ghost-files"].dependentsHint).toBe(CODE_INTEL_DEPENDENTS_HINT);
    expect(config.checks["ghost-files"].weakTokens).toEqual(["controller", "service"]);
    expect(config.checks["ghost-files"].entryPointStems).toEqual(["index.server", "mod"]);
    expect(config.checks["ghost-files"].currentAllowedPairs).toEqual([
      { files: ["src/a.ts", "src/b.ts"] },
      { files: ["src/foo-helper.ts", "src/foo.ts"] },
    ]);
  });

  it("merges custom ignore segments with defaults, deduping and sorting", () => {
    const config = parseDriftAiConfig({
      ignore: { segments: ["custom-generated", "node_modules"] },
    });
    // "node_modules" is also a built-in default; the merge must keep it once.
    expect(config.ignore.segments.filter((segment) => segment === "node_modules")).toHaveLength(1);
    expect(config.ignore.segments).toContain("custom-generated");
    expect(config.ignore.segments).toEqual(
      [...config.ignore.segments].sort((left, right) => left.localeCompare(right, "en")),
    );
  });

  it("keeps ghost-files weak-token and entrypoint defaults when unset", () => {
    const config = parseDriftAiConfig({});
    expect(config.checks["ghost-files"].weakTokens).toEqual(DEFAULT_GHOST_FILE_WEAK_TOKENS);
    expect(config.checks["ghost-files"].entryPointStems).toEqual(
      DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
    );
  });

  it("uses plugin defaults for every omitted check config", () => {
    const config = parseDriftAiConfig({ checks: {} });
    for (const plugin of CHECK_PLUGINS) {
      expect(config.checks[plugin.id], plugin.id).toEqual(plugin.defaultConfig);
    }
  });

  it("keeps empty per-check config parsing aligned with plugin defaults", () => {
    for (const plugin of CHECK_PLUGINS) {
      const config = parseDriftAiConfig({ checks: { [plugin.id]: {} } });
      expect(config.checks[plugin.id], plugin.id).toEqual(plugin.defaultConfig);
    }
  });

  it("keeps near-duplicates defaults aligned for omitted and empty config", () => {
    const expected = {
      engine: NEAR_DUPLICATE_TOOL,
      minLines: DEFAULT_NEAR_DUPLICATE_MIN_LINES,
      minTokens: DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
      similarityThreshold: DEFAULT_NEAR_DUPLICATE_SIMILARITY,
      tokenBandRatio: DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
      excludeGlobs: [],
    };
    const omitted = parseDriftAiConfig({ checks: { comments: { excludePrefixes: ["docs/"] } } });
    const empty = parseDriftAiConfig({ checks: { "near-duplicates": {} } });

    expect(nearDuplicatesCheck.defaultConfig).toEqual(expected);
    expect(omitted.checks["near-duplicates"]).toEqual(expected);
    expect(empty.checks["near-duplicates"]).toEqual(expected);
  });

  it("collapses internal dot segments in config roots", () => {
    const config = parseDriftAiConfig({ roots: ["packages/../shared"] });
    expect(config.roots).toEqual(["shared"]);
  });

  it("keeps the root starter config parseable as a generic example", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "drift-ai.config.example.json"), "utf8"),
    ) as unknown;
    const config = parseDriftAiConfig(raw, "drift-ai.config.example.json");
    expect(config.roots).toEqual(["src", "packages", "apps"]);
    expect(config.checks["ghost-files"].dependentsHint).toBe("Check what imports {path}");
    expect(config.checks["ghost-files"].currentAllowedPairs).toEqual([]);
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
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { dependentsHint: "Run a dependents lookup" },
        },
      }),
    ).toThrow(/must include a \{path\} placeholder/u);
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { dependentsHint: "" },
        },
      }),
    ).toThrow(/must be a non-empty string/u);
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { dependentsHint: 12 },
        },
      }),
    ).toThrow(/must be a non-empty string/u);
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { weakTokens: ["not-a-token"] },
        },
      }),
    ).toThrow(/must be an alphanumeric token/u);
    expect(() =>
      parseDriftAiConfig({
        checks: {
          "ghost-files": { entryPointStems: ["src/index"] },
        },
      }),
    ).toThrow(/must be one filename stem/u);
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
      "rev-parse --is-shallow-repository": "false\n",
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
      "rev-parse --is-shallow-repository": "false\n",
      "diff --name-status main": "M\tpackages/shared/src/already-tracked.ts",
      "ls-files --others --exclude-standard": "",
    });
    const files = discoverChangedFiles("main", git);
    expect(files).toEqual([{ path: "packages/shared/src/already-tracked.ts", status: "modified" }]);
  });

  it("raises a clear DriftAiError before diffing a shallow repository", () => {
    const calls: string[] = [];
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      calls.push(key);
      if (key === "rev-parse --is-shallow-repository") return "true\n";
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const error = captureThrown(() => discoverChangedFiles("main", git));

    expect(error).toBeInstanceOf(DriftAiError);
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining("changed scope needs full git history"),
    );
    expect(calls).toEqual(["rev-parse --is-shallow-repository"]);
  });

  it("converts a SIGSEGV-like diff failure into the same clear shallow-clone error", () => {
    const rawError = Object.assign(new Error("Command failed: git diff --name-status main"), {
      signal: "SIGSEGV",
    });
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-shallow-repository") return "false\n";
      if (key === "diff --name-status main") throw rawError;
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const error = captureThrown(() => discoverChangedFiles("main", git));

    expect(error).toBeInstanceOf(DriftAiError);
    expect(error).toHaveProperty("message", expect.stringContaining("shallow/blobless clone"));
  });

  it("converts missing-object diff failures into the shallow-clone error", () => {
    const rawError = new Error("fatal: bad tree object abc123");
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-shallow-repository") return "false\n";
      if (key === "diff --name-status main") throw rawError;
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    expect(() => discoverChangedFiles("main", git)).toThrow(
      /changed scope needs full git history/u,
    );
  });

  it("preserves unrelated diff failures", () => {
    const rawError = new Error("fatal: ambiguous argument 'main'");
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --is-shallow-repository") return "false\n";
      if (key === "diff --name-status main") throw rawError;
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    expect(() => discoverChangedFiles("main", git)).toThrow(rawError);
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
  it("enables every default check with no skipped list", () => {
    const options = parseArgs([]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const report = buildReport(options, "main", detectorScope, makeCheckRunContext(detectorScope));
    expect(report.enabledChecks).toEqual([...DEFAULT_CHECKS]);
    expect(report.skippedChecks).toEqual([]);
    expect(report.summary).toEqual({
      total: 0,
      byCheck: { duplicates: 0, "ghost-files": 0, comments: 0, suppressions: 0 },
    });
    expect(report.scopeCount).toBe(1);
    expect(report.findings).toEqual([]);

    const text = formatText(report);
    expect(text).toContain("drift:ai (report-only) -- scope changed -- base main");
    expect(text).toContain("scope: 1 file(s) considered");
    expect(text).toContain("findings: 0 (duplicates 0, ghost-files 0, comments 0, suppressions 0)");
    expect(text).not.toContain("skipped:");
    expect(text).toContain(`OK: no findings from checks: ${DEFAULT_CHECKS.join(", ")}`);

    const json = JSON.parse(formatJson(report)) as Record<string, unknown>;
    const keys = Object.keys(json);
    expect(json["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(json["scopeMode"]).toBe("changed");
    expect(json["base"]).toBe("main");
    expect(json["roots"]).toEqual([]);
    expect(json["configPath"]).toBeNull();
    expect(json["enabledChecks"]).toEqual([...DEFAULT_CHECKS]);
    expect(json["skippedChecks"]).toEqual([]);
    expect(json["summary"]).toEqual({
      total: 0,
      byCheck: { duplicates: 0, "ghost-files": 0, comments: 0, suppressions: 0 },
    });
    expect(json["findings"]).toEqual([]);
    expect(json["scopeCount"]).toBe(1);
    expect(json).not.toHaveProperty("scope");
    expect(keys.indexOf("summary")).toBeLessThan(keys.indexOf("findings"));
    expect(keys.indexOf("findings")).toBeLessThan(keys.indexOf("scopeCount"));
    const jsonWithScope = JSON.parse(formatJson(report, { includeScope: true })) as Record<
      string,
      unknown
    >;
    expect(jsonWithScope["scope"]).toEqual(scope.map(toChangedScopeFile));
    expect(Object.keys(jsonWithScope).indexOf("findings")).toBeLessThan(
      Object.keys(jsonWithScope).indexOf("scope"),
    );
  });

  it("summarizes findings by checks that actually ran", () => {
    const options = parseArgs(["--check", "duplicates", "--check", "comments"]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const report = buildReport(
      options,
      "main",
      detectorScope,
      makeCheckRunContext(detectorScope, {
        overrides: {
          jscpd: () => ({
            ok: true,
            reportJson: JSON.stringify({
              duplicates: [
                {
                  lines: 12,
                  firstFile: { name: "packages/server/src/foo.ts", start: 1, end: 12 },
                  secondFile: { name: "packages/server/src/shared.ts", start: 1, end: 12 },
                },
              ],
            }),
          }),
        },
      }),
    );

    expect(report.summary).toEqual({ total: 1, byCheck: { duplicates: 1, comments: 0 } });
    expect(formatText(report)).toContain("findings: 1 (duplicates 1, comments 0)");
    const json = JSON.parse(formatJson(report)) as Record<string, unknown>;
    expect(json["summary"]).toEqual({ total: 1, byCheck: { duplicates: 1, comments: 0 } });
    expect(json["findings"]).toHaveLength(1);
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

    const report = buildReport(
      options,
      "main",
      detectorScope,
      makeCheckRunContext(detectorScope, {
        overrides: { suppressionsGit },
        repoRoot: "/repo/musi",
        suppressionDiffRef: "merge-base",
      }),
    );

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

  it("skips duplicates with a reason instead of a finding when jscpd is unavailable", () => {
    const options = parseArgs([]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const messages: string[] = [];
    // No injected jscpd runner and binExists always-false: the duplicates plugin
    // resolves its own jscpd, finds none, and skips (never a finding) in preflight.
    const report = buildReport(
      options,
      "main",
      detectorScope,
      makeCheckRunContext(detectorScope, {
        // Drop the default no-op jscpd so the plugin must resolve a real binary;
        // binExists:false makes that resolution fail, the tool-unavailable path.
        overrides: { jscpd: undefined, binExists: () => false },
        warnStderr: (message) => messages.push(message),
      }),
    );
    expect(report.enabledChecks).not.toContain("duplicates");
    const duplicatesSkip = report.skippedChecks.find((skip) => skip.check === "duplicates");
    expect(duplicatesSkip?.reason).toContain("jscpd executable not found");
    expect(report.findings.filter((finding) => finding.check === "duplicates")).toEqual([]);
    expect(messages).toEqual([expect.stringContaining("jscpd executable not found")]);
  });

  it("does not resolve an unselected check's expensive service (lazy, plugin-owned)", () => {
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    let binProbes = 0;
    const binExists = () => {
      binProbes += 1;
      return false;
    };

    // comments selected, duplicates NOT: the duplicates plugin's jscpd binary probe
    // must never run, because buildReport only dispatches selected checks and each
    // plugin resolves its own services lazily on dispatch.
    buildReport(
      parseArgs(["--check", "comments"]),
      "main",
      detectorScope,
      makeCheckRunContext(detectorScope, { overrides: { jscpd: undefined, binExists } }),
    );
    expect(binProbes).toBe(0);

    // duplicates selected: now the same probe is exercised, proving the counter is
    // a faithful witness (the zero above is laziness, not a dead seam).
    buildReport(
      parseArgs(["--check", "duplicates"]),
      "main",
      detectorScope,
      makeCheckRunContext(detectorScope, { overrides: { jscpd: undefined, binExists } }),
    );
    expect(binProbes).toBeGreaterThan(0);
  });

  it("skips suppressions in current scope with a structured reason", () => {
    const options = parseArgs(["--scope", "current", "--check", "suppressions"]);
    const detectorScope: DetectorScope = {
      scopeMode: "current",
      files: ["src/current.ts"].map(toCurrentScopeFile),
    };
    const report = buildReport(options, null, detectorScope, makeCheckRunContext(detectorScope));

    expect(report.enabledChecks).toEqual([]);
    expect(report.skippedChecks).toEqual([
      { check: "suppressions", reason: "only available in changed scope" },
    ]);
    const text = formatText(report);
    expect(text).toContain("skipped: suppressions — only available in changed scope");
    expect(text).toContain(
      "drift:ai: suppressions is only available in changed scope; nothing to run.",
    );
    expect(text).not.toContain("drift:ai: no implemented checks selected.");
  });

  it("uses explicit no-op runners from the supplied context", () => {
    const options = parseArgs([]);
    const scope: ChangedFile[] = [{ path: "packages/server/src/foo.ts", status: "modified" }];
    const detectorScope = changedDetectorScope(scope);
    const report = buildReport(options, "main", detectorScope, makeCheckRunContext(detectorScope));
    expect(report.findings).toEqual([]);
  });

  it("uses current inventory from the supplied context", () => {
    const options = parseArgs(["--scope", "current", "--check", "ghost-files"]);
    const detectorScope: DetectorScope = {
      scopeMode: "current",
      files: ["src/foo.ts", "src/foo-helper.ts"].map(toCurrentScopeFile),
    };
    const report = buildReport(options, null, detectorScope, makeCheckRunContext(detectorScope));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.relatedFiles).toEqual(["src/foo-helper.ts", "src/foo.ts"]);
  });

  it("renders a clear placeholder when no checks are enabled (in-flight leaf state)", () => {
    // Reachable when an in-flight leaf adds a new id to ALL_CHECKS before
    // wiring it into IMPLEMENTED_CHECKS. The branch keeps the CLI
    // self-describing during that handoff window. Using "comments" here is
    // arbitrary — formatText only branches on enabledChecks being empty.
    const skipped = [{ check: "comments" as const, reason: "check is not implemented" }];
    const text = formatText({
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "changed",
      base: "main",
      resolvedRef: "main",
      roots: [],
      configPath: null,
      enabledChecks: [],
      skippedChecks: skipped,
      summary: { total: 0, byCheck: {} },
      scopeCount: 0,
      scope: [],
      findings: [],
    });
    expect(text).toContain("drift:ai: no implemented checks selected.");
    expect(text).not.toContain("OK: no findings from checks: ");
  });

  it("includes the resolved ref when it differs from --base", () => {
    const options = parseArgs(["--base", "main"]);
    const detectorScope = changedDetectorScope([]);
    const report = buildReport(
      options,
      "origin/main",
      detectorScope,
      makeCheckRunContext(detectorScope),
    );
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
        "bun run drift:ai --check <duplicates|ghost-files|comments|suppressions|orphan-files|import-cycles|near-duplicates|all>",
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
    expect(result.stdout).toContain(`OK: no findings from checks: ${DEFAULT_CHECKS.join(", ")}`);
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
    expect(json["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(json["scopeMode"]).toBe("current");
    expect(json["base"]).toBeNull();
    expect(json["resolvedRef"]).toBeNull();
    expect(json["scopeCount"]).toBe(2);
    expect(json).not.toHaveProperty("scope");
  });

  it("skips import-cycles for a missing explicit --tsconfig instead of reporting cycles", () => {
    const repoRoot = makeTempDir();
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "src/a.ts"),
      `import { b } from "./b";\nexport const a = () => b();\n`,
    );
    writeFileSync(
      path.join(repoRoot, "src/b.ts"),
      `import { a } from "./a";\nexport const b = () => a();\n`,
    );
    const files = ["src/a.ts", "src/b.ts"];
    const result = runDriftAi({
      argv: [
        "--scope",
        "current",
        "--check",
        "import-cycles",
        "--tsconfig",
        "missing-tsconfig.json",
      ],
      git: makeCurrentGit(repoRoot),
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report?.findings).toEqual([]);
    expect(result.report?.enabledChecks).toEqual([]);
    expect(result.report?.skippedChecks).toEqual([
      {
        check: "import-cycles",
        code: "no-target-config",
        reason: expect.stringContaining("explicit --tsconfig missing-tsconfig.json"),
      },
    ]);
    expect(result.stdout).toContain("missing-tsconfig.json");
  });

  it("does not probe shallow-clone state for --scope current", () => {
    const repoRoot = makeTempDir();
    const files = ["src/app.ts"];
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
      if (key === "rev-parse --is-shallow-repository") {
        throw new Error("current scope must not run shallow changed-scope probes");
      }
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const result = runDriftAi({
      argv: ["--scope", "current", "--check", "comments"],
      git,
      gitBuffer: () => nulDelimited(files),
      stat: statForCurrentFiles(repoRoot, files),
      readFile: () => "const value = 1;\n",
    });

    expect(result.exitCode).toBe(0);
    expect(result.report?.scopeMode).toBe("current");
    expect(result.report?.scope).toEqual([{ scope: "current", path: "src/app.ts" }]);
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
        hint: defaultCurrentPairHint("src/foo/bar-helper.ts", "src/foo/bar.ts"),
        relatedFiles: ["src/foo/bar-helper.ts", "src/foo/bar.ts"],
      },
    ]);
  });

  it("honors dependentsHint from config for current ghost-files pair hints", () => {
    const repoRoot = makeTempDir();
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({
        checks: {
          "ghost-files": {
            dependentsHint: CODE_INTEL_DEPENDENTS_HINT,
          },
        },
      }),
    );
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
    expect(result.report?.findings[0]?.hint).toContain(
      "Run: bun run code:intel -- dependents src/foo/bar-helper.ts",
    );
    expect(result.report?.findings[0]?.hint).toContain(
      "Run: bun run code:intel -- dependents src/foo/bar.ts",
    );
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
      jscpd: emptyJscpdRunner(),
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(payload["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
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
    expect(payload["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(payload["scopeMode"]).toBe("changed");
    expect(payload["base"]).toBe("main");
    expect(payload["scopeCount"]).toBe(1);
    expect(payload).not.toHaveProperty("scope");
  });

  it("includes the full scope in JSON output when --include-scope is set", () => {
    const target = path.join(makeTempDir(), "drift.json");
    const git = makeRunDriftGit("A\tpackages/server/src/foo.ts");
    const writes: CapturedWrite[] = [];
    const result = runDriftAi({
      argv: ["--format", "json", "--include-scope", "--output", target],
      git,
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
      writer: (writePath, contents) => {
        writes.push({ path: writePath, contents });
      },
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(writtenText(writes, target)) as Record<string, unknown>;
    expect(payload["scopeCount"]).toBe(1);
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
    expect(onDisk["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
    expect(onDisk["base"]).toBe("main");
    expect(onDisk["scopeCount"]).toBe(0);
    expect(onDisk).not.toHaveProperty("scope");
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
        hint: defaultRepairHint(`${dir}/character-auth.ts`),
        relatedFiles: [`${dir}/character-auth-utils.ts`, `${dir}/character-auth.ts`].sort(),
      },
    ]);
    expect(result.stdout).toContain(`WARN ghost-files: ${dir}/character-auth-utils.ts`);
  });

  it("honors dependentsHint from config for changed ghost-files hints", () => {
    const repoRoot = makeTempDir();
    writeFileSync(
      path.join(repoRoot, "drift-ai.config.json"),
      JSON.stringify({
        checks: {
          "ghost-files": {
            dependentsHint: CODE_INTEL_DEPENDENTS_HINT,
          },
        },
      }),
    );
    const dir = "packages/server/src/utils";
    const listDirectory: DirectoryListing = (queried) =>
      queried === dir ? ["character-auth-utils.ts", "character-auth.ts"] : [];
    const result = runDriftAi({
      argv: [],
      git: makeRunDriftGit("A\tpackages/server/src/utils/character-auth-utils.ts", "", repoRoot),
      jscpd: emptyJscpdRunner(),
      listDirectory,
      readFile: emptyFileReader(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report?.findings[0]?.hint).toContain(
      `bun run code:intel -- dependents ${dir}/character-auth.ts`,
    );
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
    expect(manifest["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
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
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "current",
      totalFindings: 0,
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunks: [],
    });
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
    expect(payload["schemaVersion"]).toBe(DRIFT_SCHEMA_VERSION);
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

  function duplicateFindingJscpd(): JscpdRunner {
    return () => ({
      ok: true,
      reportJson: JSON.stringify({
        duplicates: [
          {
            lines: 12,
            firstFile: { name: "packages/server/src/utils/character-auth.ts", start: 1, end: 12 },
            secondFile: { name: "packages/server/src/utils/campaign-auth.ts", start: 1, end: 12 },
          },
        ],
      }),
    });
  }

  it("keeps the default exit code at 0 even when findings exist (report-only)", () => {
    const result = runDriftAi({
      argv: [],
      git: makeRunDriftGit("M\tpackages/server/src/utils/character-auth.ts"),
      jscpd: duplicateFindingJscpd(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.report?.findings.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  it("exits 1 under --fail-on-findings when findings exist", () => {
    const result = runDriftAi({
      argv: ["--fail-on-findings"],
      git: makeRunDriftGit("M\tpackages/server/src/utils/character-auth.ts"),
      jscpd: duplicateFindingJscpd(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.report?.findings.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
    // The opt-in flag changes only the process exit code; report content is unchanged.
    expect(result.stdout).toContain("WARN duplicates:");
  });

  it("exits 0 under --fail-on-findings when there are no findings", () => {
    const result = runDriftAi({
      argv: ["--fail-on-findings"],
      git: makeRunDriftGit("A\tpackages/server/src/foo.ts"),
      jscpd: emptyJscpdRunner(),
      listDirectory: emptyDirectoryListing(),
      readFile: emptyFileReader(),
    });
    expect(result.report?.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("still exits 2 for usage errors even with --fail-on-findings set", () => {
    const result = runDriftAi({
      argv: ["--fail-on-findings", "--check", "made-up"],
      git: makeStubGit({}),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Unknown check: made-up");
  });
});
