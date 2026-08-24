import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { GitRunner } from "./git-changed-scope.js";
import { currentRepoGit } from "./git-runner.test-helper.js";
import {
  type HarnessFreshnessFinding,
  type HarnessFreshnessPathKind,
  runHarnessFreshnessCheck,
} from "./harness-freshness.js";
import type { PathExists } from "./repo-io.js";
import { runDriftAi } from "./runner.js";

const tmpRepo = registerTempRootCleanup();

function makePathExists(paths: ReadonlyArray<`${HarnessFreshnessPathKind}:${string}`>): PathExists {
  const existing = new Set(paths);
  return (repoRelativePath, kind) => existing.has(`${kind}:${repoRelativePath}`);
}

function runFixture(options: {
  readonly harness: string;
  readonly guides: readonly string[];
  readonly existingPaths?: ReadonlyArray<`${HarnessFreshnessPathKind}:${string}`>;
  readonly ignoredPaths?: readonly string[];
}): HarnessFreshnessFinding[] {
  const ignoredPaths = new Set(options.ignoredPaths ?? []);
  return runHarnessFreshnessCheck({
    readFile: (filePath) => (filePath === "docs/ai-harness.md" ? options.harness : undefined),
    listDirectory: (directory) => (directory === "docs/guides" ? options.guides : []),
    pathExists: makePathExists(options.existingPaths ?? []),
    isIgnored: (repoRelativePath) => ignoredPaths.has(repoRelativePath),
  });
}

describe("runHarnessFreshnessCheck", () => {
  it("returns no findings when guide inventory and backtick paths are fresh", () => {
    const findings = runFixture({
      harness: [
        "| `docs/guides/add-trpc-procedure.md` | tRPC guide |",
        "| `docs/guides/change-rules-logic.md` | Rules guide |",
        "`packages/server/src/index.ts`",
        "`docs/guides/`",
        "`bun run lint -- --max-warnings=0`",
      ].join("\n"),
      guides: ["change-rules-logic.md", "add-trpc-procedure.md"],
      existingPaths: [
        "file:docs/guides/add-trpc-procedure.md",
        "file:docs/guides/change-rules-logic.md",
        "file:packages/server/src/index.ts",
        "directory:docs/guides",
      ],
    });

    expect(findings).toEqual([]);
  });

  it("reports docs/guides markdown files that are not referenced by the harness", () => {
    const findings = runFixture({
      harness: "| `docs/guides/add-trpc-procedure.md` | tRPC guide |",
      guides: ["add-trpc-procedure.md", "change-rules-logic.md"],
      existingPaths: ["file:docs/guides/add-trpc-procedure.md"],
    });

    expect(findings).toEqual([
      {
        check: "harness-freshness",
        file: "docs/guides/change-rules-logic.md",
        message: "guide is not referenced by docs/ai-harness.md",
        hint: "add the guide to docs/ai-harness.md or remove the stale guide file.",
        details: {
          category: "unreferenced-guide",
          path: "docs/guides/change-rules-logic.md",
        },
      },
    ]);
  });

  it("reports stale backtick-quoted repo paths with harness line context", () => {
    const findings = runFixture({
      harness: [
        "`bun run lint`",
        "`packages/server/src/missing.ts`",
        "`docs/guides/missing-dir/`",
        "`packages/{shared,server,client}`",
      ].join("\n"),
      guides: [],
    });

    expect(findings).toEqual([
      {
        check: "harness-freshness",
        file: "docs/ai-harness.md:2",
        message: "backtick path packages/server/src/missing.ts does not resolve to a file",
        hint: "update or remove the stale path reference.",
        details: {
          category: "stale-backtick-path",
          line: 2,
          path: "packages/server/src/missing.ts",
        },
      },
      {
        check: "harness-freshness",
        file: "docs/ai-harness.md:3",
        message: "backtick path docs/guides/missing-dir/ does not resolve to a directory",
        hint: "update or remove the stale path reference.",
        details: {
          category: "stale-backtick-path",
          line: 3,
          path: "docs/guides/missing-dir/",
        },
      },
    ]);
  });

  it("does not report missing backtick paths that are gitignored", () => {
    const findings = runFixture({
      harness: "`reports/mutation/index.html`",
      guides: [],
      ignoredPaths: ["reports/mutation/index.html"],
    });

    expect(findings).toEqual([]);
  });

  it("still reports missing backtick paths that are not gitignored", () => {
    const findings = runFixture({
      harness: "`packages/server/src/missing.ts`",
      guides: [],
    });

    expect(findings).toEqual([
      {
        check: "harness-freshness",
        file: "docs/ai-harness.md:1",
        message: "backtick path packages/server/src/missing.ts does not resolve to a file",
        hint: "update or remove the stale path reference.",
        details: {
          category: "stale-backtick-path",
          line: 1,
          path: "packages/server/src/missing.ts",
        },
      },
    ]);
  });

  it("identifies harness-freshness when its default Git ignore probe fails", () => {
    expect(() =>
      runHarnessFreshnessCheck({
        repoRoot: tmpRepo.makeTempRepo("drift-harness-ignore-failure-"),
        readFile: () => "`packages/server/src/missing.ts`",
        listDirectory: () => [],
        pathExists: () => false,
      }),
    ).toThrow("harness-freshness git check-ignore failed");
  });

  it("cross-checks every guide path referenced by the harness", () => {
    const findings = runFixture({
      harness: [
        "| docs/guides/add-trpc-procedure.md | exists |",
        "| docs/guides/deleted-guide.md | stale |",
      ].join("\n"),
      guides: ["add-trpc-procedure.md"],
    });

    expect(findings).toEqual([
      {
        check: "harness-freshness",
        file: "docs/ai-harness.md:2",
        message: "references missing guide docs/guides/deleted-guide.md",
        hint: "restore the guide file or update docs/ai-harness.md.",
        details: {
          category: "missing-referenced-guide",
          line: 2,
          path: "docs/guides/deleted-guide.md",
        },
      },
    ]);
  });

  it("requires file-like paths to be files and trailing-slash paths to be directories", () => {
    const findings = runFixture({
      harness: ["`docs/guides/add-trpc-procedure.md`", "`docs/guides/`"].join("\n"),
      guides: ["add-trpc-procedure.md"],
      existingPaths: ["directory:docs/guides/add-trpc-procedure.md", "file:docs/guides"],
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      "backtick path docs/guides/add-trpc-procedure.md does not resolve to a file",
      "backtick path docs/guides/ does not resolve to a directory",
    ]);
  });
});

// The subcommand was retrofitted onto the shared subcommand arg parser (task 40 /
// 50-M4) so it gains --format/--output parity. Pointing git at an empty temp dir
// makes the check deterministic: a missing harness file yields one finding.
function gitAtEmptyRepo(): GitRunner {
  const repoRoot = tmpRepo.makeTempRepo("drift-harness-");
  return currentRepoGit(repoRoot);
}

describe("harness-freshness subcommand", () => {
  it("renders findings-shaped text by default", () => {
    const result = runDriftAi({ argv: ["harness-freshness"], git: gitAtEmptyRepo() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("WARN harness-freshness");
    expect(result.stdout).toContain("harness inventory file is missing");
  });

  it("emits findings-shaped JSON with --format json (NOT an advisory)", () => {
    const result = runDriftAi({
      argv: ["harness-freshness", "--format", "json"],
      git: gitAtEmptyRepo(),
    });
    const payload = JSON.parse(result.stdout) as {
      check: string;
      findingCount: number;
      findings: ReadonlyArray<{ check: string }>;
    };
    expect(payload.check).toBe("harness-freshness");
    expect(payload.findingCount).toBe(1);
    expect(payload.findings[0]?.check).toBe("harness-freshness");
  });

  it("writes to --output and returns a pointer message", () => {
    const written: Array<{ path: string; contents: string }> = [];
    const result = runDriftAi({
      argv: ["harness-freshness", "--output", "harness.txt"],
      git: gitAtEmptyRepo(),
      writer: (filePath, contents) => written.push({ path: filePath, contents }),
    });
    expect(result.stdout).toBe("drift:ai: wrote text report to harness.txt");
    expect(written[0]?.path).toBe("harness.txt");
  });

  it("prints usage on --help (exit 0) and rejects unknown args (exit 2)", () => {
    const help = runDriftAi({ argv: ["harness-freshness", "--help"], git: gitAtEmptyRepo() });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("bun run drift:ai harness-freshness");

    const bad = runDriftAi({ argv: ["harness-freshness", "--bogus"], git: gitAtEmptyRepo() });
    expect(bad.exitCode).toBe(2);
    expect(bad.stdout).toContain("Unknown argument: --bogus");
  });

  it("rejects --config as unknown since it does not read config (exit 2)", () => {
    const result = runDriftAi({
      argv: ["harness-freshness", "--config", "drift-ai.config.json"],
      git: gitAtEmptyRepo(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Unknown argument: --config");
  });

  it("still accepts --format json with --output", () => {
    const written: Array<{ path: string; contents: string }> = [];
    const result = runDriftAi({
      argv: ["harness-freshness", "--format", "json", "--output", "out.json"],
      git: gitAtEmptyRepo(),
      writer: (filePath, contents) => written.push({ path: filePath, contents }),
    });
    expect(result.stdout).toBe("drift:ai: wrote json report to out.json");
    expect(written[0]?.path).toBe("out.json");
  });
});
