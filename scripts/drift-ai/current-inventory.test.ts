import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_DRIFT_AI_CONFIG, type DriftAiIgnoreConfig } from "./config.js";
import {
  defaultBufferGitRunner,
  discoverCurrentFiles,
  isIgnoredCurrentPath,
  normalizeCurrentRoots,
  resolveStrictRepoRoot,
  type StatRunner,
} from "./current-inventory.js";
import { DriftAiError } from "./errors.js";
import { buildSourceExtensions, type CurrentScopeFile } from "./scope.js";

const REPO_ROOT = "/repo";

function nulDelimited(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function normalizeFixturePath(filePath: string): string {
  let normalized = filePath.replace(/\\/gu, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

function repoRelativePath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function statFor(filePaths: readonly string[], nonFilePaths: readonly string[] = []): StatRunner {
  const files = new Set(filePaths.map(normalizeFixturePath));
  const nonFiles = new Set(nonFilePaths.map(normalizeFixturePath));
  return (absolutePath) => {
    const relative = repoRelativePath(absolutePath);
    if (nonFiles.has(relative)) return { isFile: () => false };
    if (files.has(relative)) return { isFile: () => true };
    return undefined;
  };
}

type DiscoverStubOptions = {
  readonly paths: readonly string[];
  readonly filePaths?: readonly string[];
  readonly nonFilePaths?: readonly string[];
  readonly roots?: readonly string[];
  readonly ignore?: DriftAiIgnoreConfig;
  readonly sourceExtensions?: ReadonlySet<string>;
};

function discoverWithStubs(options: DiscoverStubOptions): readonly CurrentScopeFile[] {
  const filePaths = options.filePaths ?? options.paths;
  return discoverCurrentFiles({
    repoRoot: REPO_ROOT,
    gitBuffer: () => nulDelimited(options.paths),
    stat: statFor(filePaths, options.nonFilePaths),
    ignore: options.ignore ?? DEFAULT_DRIFT_AI_CONFIG.ignore,
    sourceExtensions: options.sourceExtensions ?? buildSourceExtensions([]),
    ...(options.roots === undefined ? {} : { roots: options.roots }),
  });
}

function discoveredPaths(files: readonly CurrentScopeFile[]): readonly string[] {
  return files.map((file) => file.path);
}

function createTempGitRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "musi-drift-ai-"));
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  return repoRoot;
}

describe("resolveStrictRepoRoot", () => {
  it("returns a trimmed repo root on success", () => {
    expect(resolveStrictRepoRoot(() => "  /workspace/repo \n")).toBe("/workspace/repo");
  });

  it("throws DriftAiError when git throws", () => {
    expect(() =>
      resolveStrictRepoRoot(() => {
        throw new Error("not a git repo");
      }),
    ).toThrow(DriftAiError);
  });

  it.each(["", "   \n"])("throws DriftAiError when git returns %j", (output) => {
    expect(() => resolveStrictRepoRoot(() => output)).toThrow(DriftAiError);
  });
});

describe("discoverCurrentFiles", () => {
  it("runs git inventory from the configured repo root", () => {
    const repoRoot = createTempGitRepo();
    const srcDir = path.join(repoRoot, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(path.join(srcDir, "app.ts"), "export const app = true;\n");

    try {
      const files = discoverCurrentFiles({
        repoRoot,
        gitBuffer: defaultBufferGitRunner({ repoRoot }),
        ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
        sourceExtensions: buildSourceExtensions([]),
      });

      expect(discoveredPaths(files)).toEqual(["src/app.ts"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("returns mixed tracked and untracked input sorted, deduped, and POSIX-normalized", () => {
    const files = discoverWithStubs({
      paths: ["src/zeta.ts", "./src/alpha.ts", "src/zeta.ts", "src/nested\\beta.ts"],
    });

    expect(discoveredPaths(files)).toEqual(["src/alpha.ts", "src/nested/beta.ts", "src/zeta.ts"]);
  });

  it("parses NUL-delimited paths with embedded spaces and newlines unchanged", () => {
    const paths = ["src/with space.ts", "src/line\nbreak.ts"];
    const files = discoverWithStubs({ paths });

    expect(discoveredPaths(files)).toEqual(
      [...paths].sort((left, right) => left.localeCompare(right, "en")),
    );
  });

  it("drops paths matching ignored segments, prefixes, and globs", () => {
    const ignore: DriftAiIgnoreConfig = {
      segments: ["node_modules"],
      prefixes: ["docs/"],
      globs: ["**/*.snap"],
    };
    const files = discoverWithStubs({
      paths: ["node_modules/pkg/index.ts", "docs/guide.ts", "src/output.snap", "src/keep.ts"],
      ignore,
    });

    expect(discoveredPaths(files)).toEqual(["src/keep.ts"]);
  });

  it("drops inventory entries that are not regular files", () => {
    const files = discoverWithStubs({
      paths: ["src/regular.ts", "src/link.ts"],
      nonFilePaths: ["src/link.ts"],
    });

    expect(discoveredPaths(files)).toEqual(["src/regular.ts"]);
  });

  it("limits inventory to roots and returns empty output for unmatched roots", () => {
    const paths = ["src/feature/a.ts", "src/feature/deep/b.ts", "src/other.ts"];

    expect(discoveredPaths(discoverWithStubs({ paths, roots: ["src/feature"] }))).toEqual([
      "src/feature/a.ts",
      "src/feature/deep/b.ts",
    ]);
    expect(discoveredPaths(discoverWithStubs({ paths, roots: ["missing"] }))).toEqual([]);
  });

  it("treats an explicit repo root as whole-repo inventory", () => {
    const paths = ["scripts/drift-ai.ts", "src/app.ts"];

    expect(discoveredPaths(discoverWithStubs({ paths, roots: ["."] }))).toEqual(paths);
  });

  it("treats mixed repo-root and narrow current roots as whole-repo inventory", () => {
    const paths = ["scripts/drift-ai.ts", "src/app.ts"];

    expect(discoveredPaths(discoverWithStubs({ paths, roots: [".", "src"] }))).toEqual(paths);
  });

  it("uses whole-repo ignore semantics when repo root is mixed with narrower roots", () => {
    const paths = ["src/generated/app.ts", "src/keep.ts"];

    expect(discoveredPaths(discoverWithStubs({ paths, roots: [".", "src/generated"] }))).toEqual([
      "src/keep.ts",
    ]);
  });

  it("normalizes duplicate current roots before matching inventory paths", () => {
    const files = discoverWithStubs({
      paths: ["src/app.ts", "other/app.ts"],
      roots: ["./src/", "src"],
    });

    expect(discoveredPaths(files)).toEqual(["src/app.ts"]);
  });

  it("keeps files under an explicit root that matches a default ignored segment", () => {
    const files = discoverWithStubs({
      paths: ["src/generated/app.ts", "src/generated/feature/view.ts"],
      roots: ["src/generated"],
    });

    expect(discoveredPaths(files)).toEqual([
      "src/generated/app.ts",
      "src/generated/feature/view.ts",
    ]);
  });

  it("still drops nested ignored segments under an explicit root", () => {
    const files = discoverWithStubs({
      paths: ["src/app.ts", "src/generated/client.ts", "src/feature/generated/types.ts"],
      roots: ["src"],
    });

    expect(discoveredPaths(files)).toEqual(["src/app.ts"]);
  });

  it("drops non-source extensions after ignore and stat checks", () => {
    const files = discoverWithStubs({
      paths: ["src/app.ts", "src/styles.css"],
    });

    expect(discoveredPaths(files)).toEqual(["src/app.ts"]);
  });

  it("keeps configured additional source extensions", () => {
    const files = discoverWithStubs({
      paths: ["src/component.vue", "src/index.ts"],
      sourceExtensions: buildSourceExtensions([".VUE"]),
    });

    expect(discoveredPaths(files)).toEqual(["src/component.vue", "src/index.ts"]);
  });

  it("honors default ignored files and extensions", () => {
    const files = discoverWithStubs({
      paths: ["src/app.ts", "src/logo.png", "package-lock.json"],
    });

    expect(discoveredPaths(files)).toEqual(["src/app.ts"]);
  });
});

describe("normalizeCurrentRoots", () => {
  it("normalizes and dedupes equivalent current roots", () => {
    expect(normalizeCurrentRoots(["./src/", "src"])).toEqual(["src"]);
  });

  it("collapses internal dot segments before matching inventory roots", () => {
    expect(normalizeCurrentRoots(["packages/../scripts", "src/./feature"])).toEqual([
      "src/feature",
      "scripts",
    ]);
  });

  it("rejects roots that escape the repo after dot-segment collapse", () => {
    expect(() => normalizeCurrentRoots(["packages/../../escape"])).toThrow(DriftAiError);
  });
});

describe("isIgnoredCurrentPath", () => {
  it("matches segments, prefixes, globs, default ignored extensions, and default ignored files", () => {
    const ignore: DriftAiIgnoreConfig = {
      segments: ["node_modules"],
      prefixes: ["docs/"],
      globs: ["**/*.snap"],
    };

    expect(isIgnoredCurrentPath("node_modules/pkg/index.ts", ignore)).toBe(true);
    expect(isIgnoredCurrentPath("docs/guide.ts", ignore)).toBe(true);
    expect(isIgnoredCurrentPath("src/view.snap", ignore)).toBe(true);
    expect(isIgnoredCurrentPath("src/logo.png", ignore)).toBe(true);
    expect(isIgnoredCurrentPath("package-lock.json", ignore)).toBe(true);
    expect(isIgnoredCurrentPath("src/app.ts", ignore)).toBe(false);
  });
});
