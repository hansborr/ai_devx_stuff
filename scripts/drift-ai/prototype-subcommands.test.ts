import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { StatRunner } from "./current-inventory.js";
import type { DolosRunner, DolosRunnerInput } from "./dolos-runner.js";
import { currentRepoGit as makeCurrentGit } from "./git-runner.test-helper.js";
import { NEAR_DUPLICATE_TOOL, type NearDuplicateFunction } from "./near-duplicates.js";
import { type PrototypeSubcommandResult, runPrototypeSubcommand } from "./prototype-subcommands.js";
import { capturePrototypeScanSnapshot } from "./scan-provenance.js";
import type { SemgrepRunner, SemgrepRunnerInput } from "./semgrep-runner.js";

const tmpRepo = registerTempRootCleanup();

function makeTempDir(): string {
  return tmpRepo.makeTempRepo("drift-ai-prototype-subcommands-");
}

function nulDelimited(paths: readonly string[]): Buffer {
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function statForCurrentFiles(repoRoot: string, filePaths: readonly string[]): StatRunner {
  const files = new Set(filePaths);
  return (absolutePath) => {
    const relative = path.relative(repoRoot, absolutePath).split(path.sep).join("/");
    if (!files.has(relative)) return undefined;
    return { isFile: () => true };
  };
}

function expectPrototypeResult(
  result: PrototypeSubcommandResult | undefined,
): PrototypeSubcommandResult {
  if (result === undefined) throw new Error("expected prototype subcommand result");
  return result;
}

function cloneFunctions(
  leftPath = "src/left.ts",
  rightPath = "src/right.ts",
): NearDuplicateFunction[] {
  const features = ["if", "id", "call", "return", "literal", "binary", "name"];
  return [
    {
      filePath: leftPath,
      name: "leftClone",
      enclosingContext: "",
      startOffset: 0,
      endOffset: 100,
      startLine: 1,
      endLine: 12,
      lineCount: 12,
      tokenCount: 72,
      features,
      statementFeatures: ["if", "return"],
      exactTokens: [],
    },
    {
      filePath: rightPath,
      name: "rightClone",
      enclosingContext: "",
      startOffset: 200,
      endOffset: 300,
      startLine: 3,
      endLine: 14,
      lineCount: 12,
      tokenCount: 72,
      features,
      statementFeatures: ["if", "return"],
      exactTokens: [],
    },
  ];
}

describe("runPrototypeSubcommand", () => {
  it("probes the whole repository when scan provenance is captured from a nested directory", () => {
    const repoRoot = tmpRepo.makeTmpGitRepo("drift-ai-prototype-provenance-");
    tmpRepo.writeRepoFile(repoRoot, "outside.ts", "export const value = 'clean';\n");
    execFileSync("git", ["add", "outside.ts"], { cwd: repoRoot });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base"],
      { cwd: repoRoot },
    );
    const nested = path.join(repoRoot, "packages/server");
    mkdirSync(nested, { recursive: true });
    tmpRepo.writeRepoFile(repoRoot, "outside.ts", "export const value = 'dirty';\n");
    const originalCwd = process.cwd();

    try {
      process.chdir(nested);
      expect(
        capturePrototypeScanSnapshot(undefined, repoRoot, ["generated-report.json"]).provenance
          .gitDirty,
      ).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("dispatches clone-candidates as a prototype advisory subcommand", () => {
    const repoRoot = makeTempDir();
    const files = ["src/left.ts", "src/right.ts"];
    let includeExactTokens: boolean | undefined;

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: ["clone-candidates", "--root", "src", "--top", "1", "--format", "json"],
        git: makeCurrentGit(repoRoot),
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        nearDuplicates: (input) => {
          includeExactTokens = input.includeExactTokens;
          return {
            ok: true,
            engine: NEAR_DUPLICATE_TOOL,
            functions: cloneFunctions(),
          };
        },
      }),
    );

    expect(includeExactTokens).toBe(false);
    expect(result.exitCode).toBe(0);
    // type-assertion-boundary: test - the JSON output contract is what this dispatch test verifies.
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("clone-candidates");
    expect("findings" in advisory).toBe(false);
  });

  it("lets ghost-files current allowed pairs suppress clone-candidate sibling overlays", () => {
    const repoRoot = makeTempDir();
    const files = ["src/encounter.ts", "src/encounter-legacy.ts"];
    const configPath = path.join(repoRoot, "drift-ai.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        checks: {
          "ghost-files": {
            currentAllowedPairs: [
              {
                files: ["src/encounter-legacy.ts", "src/encounter.ts"],
                rationale:
                  "The legacy and current encounter modules represent separate candidates; remove when the legacy module is retired.",
              },
            ],
          },
        },
      }),
    );

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: [
          "clone-candidates",
          "--root",
          "src",
          "--top",
          "1",
          "--format",
          "json",
          "--config",
          configPath,
        ],
        git: makeCurrentGit(repoRoot),
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        nearDuplicates: () => ({
          ok: true,
          engine: NEAR_DUPLICATE_TOOL,
          functions: cloneFunctions("src/encounter.ts", "src/encounter-legacy.ts"),
        }),
      }),
    );

    expect(result.exitCode).toBe(0);
    // type-assertion-boundary: test - narrow just the advisory fields needed for this assertion.
    const advisory = JSON.parse(result.stdout) as {
      readonly sections: readonly {
        readonly entries: readonly { readonly siblingNaming?: unknown }[];
      }[];
    };
    const row = advisory.sections[0]?.entries[0];
    expect(row).toBeDefined();
    expect(row?.siblingNaming).toBeUndefined();
  });

  it("dispatches dolos-candidates through an injected runner over the filtered inventory", () => {
    const repoRoot = makeTempDir();
    const files = ["src/left.ts", "src/right.ts"];
    const calls: DolosRunnerInput[] = [];
    const fakeDolos: DolosRunner = (input) => {
      calls.push(input);
      return {
        ok: true,
        tool: { command: "dolos", source: "path", version: "2.9.3" },
        metadata: {
          engine: "dolos",
          engineVersion: "2.9.3",
          languageMode: input.languageMode,
          threshold: input.threshold,
        },
        candidates: [
          {
            engine: "dolos",
            engineVersion: "2.9.3",
            languageMode: input.languageMode,
            threshold: input.threshold,
            score: 0.97,
            left: { filePath: "src/left.ts", startLine: 1, endLine: 12, lineCount: 12 },
            right: { filePath: "src/right.ts", startLine: 1, endLine: 12, lineCount: 12 },
            metrics: { similarity: 0.97, totalOverlap: 120, longestFragment: 60 },
          },
        ],
        caps: {
          timeoutMs: 600_000,
          maxFiles: input.maxFiles,
          maxCandidatePairs: input.maxCandidatePairs,
          maxReportedPairs: input.maxReportedPairs,
        },
        truncation: {
          parsedPairs: 1,
          candidatePairsTruncated: false,
          reportedPairsTruncated: false,
          missingFileRanges: [],
          eligibleFiles: 2,
          consideredFiles: 2,
          filesTruncated: false,
        },
      };
    };

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: ["dolos-candidates", "--root", "src", "--top", "1", "--format", "json"],
        git: (args) => {
          const key = args.join(" ");
          if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
          if (key.endsWith("rev-parse HEAD")) return "dolos-scan-head\n";
          if (key.includes("status --porcelain")) return "";
          throw new Error(`unexpected git invocation: git ${key}`);
        },
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        dolos: fakeDolos,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.repoRoot).toBe(repoRoot);
    expect(calls[0]?.roots).toEqual(["src"]);
    // type-assertion-boundary: test - the JSON output contract is what this dispatch test verifies.
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("dolos-candidates");
    expect(advisory["scanProvenance"]).toEqual({
      gitHead: "dolos-scan-head",
      gitDirty: false,
      stateFingerprint: null,
      changedDuringScan: null,
    });
    expect("findings" in advisory).toBe(false);
  });

  it("dispatches semgrep-candidates through an injected runner with unfiltered roots", () => {
    const repoRoot = makeTempDir();
    // The dispatch path has no existence-probe injection point, so the declared
    // rule config must really exist for the default fs probe.
    mkdirSync(path.join(repoRoot, "rules"), { recursive: true });
    writeFileSync(path.join(repoRoot, "rules", "mit.yml"), "rules: []\n");
    const files = ["src/a.ts"];
    const calls: SemgrepRunnerInput[] = [];
    const fakeSemgrep: SemgrepRunner = (input) => {
      calls.push(input);
      return {
        ok: true,
        tool: { command: "semgrep", source: "path", version: "1.165.0" },
        scan: {
          engineVersion: "1.165.0",
          findings: [],
          malformedResultCount: 0,
          errors: [],
          skippedRules: [],
          scannedCount: 1,
        },
        caps: { timeoutMs: 600_000 },
      };
    };

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: [
          "semgrep-candidates",
          "--root",
          "src",
          "--semgrep-config",
          "rules/mit.yml",
          "--rule-license",
          "MIT",
          "--format",
          "json",
        ],
        git: makeCurrentGit(repoRoot),
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        semgrep: fakeSemgrep,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.repoRoot).toBe(repoRoot);
    expect(calls[0]?.roots).toEqual(["src"]);
    expect(calls[0]?.ruleConfigs).toEqual(["rules/mit.yml"]);
    // type-assertion-boundary: test - the JSON output contract is what this dispatch test verifies.
    const advisory = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(advisory["kind"]).toBe("advisory");
    expect(advisory["lane"]).toBe("prototype");
    expect(advisory["subcommand"]).toBe("semgrep-candidates");
    expect("findings" in advisory).toBe(false);
  });

  it("dispatches semgrep-candidates to exit 0 with unmet prerequisites on a bare machine", () => {
    const repoRoot = makeTempDir();
    const files = ["src/a.ts"];
    const calls: SemgrepRunnerInput[] = [];
    const neverRuns: SemgrepRunner = (input) => {
      calls.push(input);
      throw new Error("the scan must be skipped when no rule source is declared");
    };

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: ["semgrep-candidates", "--root", "src"],
        git: makeCurrentGit(repoRoot),
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        semgrep: neverRuns,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("prerequisite semgrep rule source: unmet");
    expect(result.stdout).toContain("prerequisite semgrep engine: unmet");
  });

  it("dispatches dolos-candidates to exit 0 with an unmet prerequisite when Dolos is absent", () => {
    const repoRoot = makeTempDir();
    const files = ["src/left.ts", "src/right.ts"];
    const missingDolos: DolosRunner = (input) => ({
      ok: false,
      reason: "tool-unavailable",
      error: "spawn dolos ENOENT",
      tool: { command: "dolos", source: "path" },
      caps: {
        timeoutMs: 600_000,
        maxFiles: input.maxFiles,
        maxCandidatePairs: input.maxCandidatePairs,
        maxReportedPairs: input.maxReportedPairs,
      },
      truncation: { consideredFiles: 0, eligibleFiles: 2, filesTruncated: false },
    });

    const result = expectPrototypeResult(
      runPrototypeSubcommand({
        argv: ["dolos-candidates", "--root", "src"],
        git: makeCurrentGit(repoRoot),
        gitBuffer: () => nulDelimited(files),
        stat: statForCurrentFiles(repoRoot, files),
        rootExists: () => true,
        dolos: missingDolos,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prerequisite dolos engine: unmet");
  });
});
