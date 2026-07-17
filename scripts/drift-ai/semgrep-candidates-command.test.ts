import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { StatRunner } from "./current-inventory.js";
import type { GitRunner } from "./git-changed-scope.js";
import { currentRepoGit as makeCurrentGit } from "./git-runner.test-helper.js";
import { runSemgrepCandidates } from "./semgrep-candidates-command.js";
import type { SemgrepRunner, SemgrepRunnerInput, SemgrepRunnerResult } from "./semgrep-runner.js";
import type { SemgrepScanOutput } from "./semgrep-types.js";

const tmpRepo = registerTempRootCleanup();

function makeTempDir(): string {
  return tmpRepo.makeTempRepo("drift-ai-semgrep-command-");
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

type RepoHarness = {
  readonly repoRoot: string;
  readonly git: GitRunner;
  readonly gitBuffer: () => Buffer;
  readonly stat: StatRunner;
  readonly rootExists: () => boolean;
  readonly ruleConfigExists: () => boolean;
};

function makeRepo(files: readonly string[] = ["src/a.ts"]): RepoHarness {
  const repoRoot = makeTempDir();
  return {
    repoRoot,
    git: makeCurrentGit(repoRoot),
    gitBuffer: () => nulDelimited(files),
    stat: statForCurrentFiles(repoRoot, files),
    rootExists: () => true,
    // Most tests declare rule configs that exist only as --config strings.
    ruleConfigExists: () => true,
  };
}

function emptyScan(overrides: Partial<SemgrepScanOutput> = {}): SemgrepScanOutput {
  return {
    engineVersion: "1.165.0",
    findings: [],
    malformedResultCount: 0,
    errors: [],
    skippedRules: [],
    scannedCount: 1,
    ...overrides,
  };
}

function okResult(): SemgrepRunnerResult {
  return {
    ok: true,
    tool: { command: "semgrep", source: "path", version: "1.165.0" },
    scan: emptyScan(),
    caps: { timeoutMs: 600_000 },
  };
}

function recordingRunner(
  calls: SemgrepRunnerInput[],
  result: SemgrepRunnerResult = okResult(),
): SemgrepRunner {
  return (input) => {
    calls.push(input);
    return result;
  };
}

function writeManifest(repoRoot: string, sources: readonly unknown[]): string {
  const manifestPath = path.join(repoRoot, "semgrep-rules.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, sources }));
  return manifestPath;
}

describe("runSemgrepCandidates", () => {
  it("scans manifest and CLI rule sources through the injected runner under the advisory envelope", () => {
    const repo = makeRepo();
    const manifestPath = writeManifest(repo.repoRoot, [
      {
        kind: "local",
        config: "/rules/manifest.yml",
        license: "MIT",
        sourceUrl: "https://example.invalid/rules",
        commit: "abc123",
      },
    ]);
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      git: (args) => {
        const key = args.join(" ");
        if (key === "rev-parse --show-toplevel") return `${repo.repoRoot}\n`;
        if (key.endsWith("rev-parse HEAD")) return "scan-head\n";
        if (key.includes("status --porcelain")) return " M src/a.ts\n";
        throw new Error(`unexpected git invocation: git ${key}`);
      },
      argv: [
        "--root",
        "src",
        "--rule-source-manifest",
        manifestPath,
        "--semgrep-config",
        "/rules/cli.yml",
        "--rule-license",
        "Apache-2.0",
        "--format",
        "json",
      ],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.repoRoot).toBe(repo.repoRoot);
    expect(calls[0]?.roots).toEqual(["src"]);
    // Manifest sources scan ahead of CLI sources, each verbatim as a --config value.
    expect(calls[0]?.ruleConfigs).toEqual(["/rules/manifest.yml", "/rules/cli.yml"]);
    // The drift ignore config reaches the runner for --exclude mapping.
    expect(calls[0]?.ignore.segments).toContain("node_modules");
    // type-assertion-boundary: test - the JSON output contract is what this test verifies.
    const advisory = JSON.parse(result.stdout) as {
      readonly kind: string;
      readonly lane: string;
      readonly subcommand: string;
      readonly scanProvenance: unknown;
      readonly sections: readonly {
        readonly ruleSources: readonly { source: string }[];
        readonly scanScope: unknown;
      }[];
    };
    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("semgrep-candidates");
    expect(advisory.scanProvenance).toEqual({
      gitHead: "scan-head",
      gitDirty: true,
      stateFingerprint: null,
      changedDuringScan: null,
    });
    expect("findings" in advisory).toBe(false);
    expect(advisory.sections[0]?.ruleSources.map((source) => source.source)).toEqual([
      "/rules/manifest.yml",
      "/rules/cli.yml",
    ]);
    // No .semgrepignore in the temp repo: the scan-scope data says so.
    expect(advisory.sections[0]?.scanScope).toEqual({
      semgrepTargetFilters: "default",
      targetSemgrepignore: false,
    });
  });

  it("stamps pre-scan provenance and flags a repository change made during the scan", () => {
    const repo = makeRepo();
    const sourcePath = path.join(repo.repoRoot, "src/a.ts");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "export const value = 'before';\n");
    let renderedOutput = "";
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${repo.repoRoot}\n`;
      if (key.endsWith("rev-parse HEAD")) return "scan-head\n";
      if (key.includes("status --porcelain")) return " M src/a.ts\n";
      if (key.includes("diff --name-only -z HEAD")) return "src/a.ts\0";
      if (key.includes("ls-files -z --others --exclude-standard")) return "";
      throw new Error(`unexpected git invocation: git ${key}`);
    };
    const semgrep: SemgrepRunner = () => {
      writeFileSync(sourcePath, "export const value = 'after';\n");
      return okResult();
    };

    const result = runSemgrepCandidates({
      ...repo,
      git,
      argv: [
        "--semgrep-config",
        "/rules/cli.yml",
        "--rule-license",
        "MIT",
        "--format",
        "json",
        "--output",
        "semgrep-candidates.json",
      ],
      semgrep,
      writer: (_path, contents) => {
        renderedOutput = contents;
      },
    });

    expect(result.exitCode).toBe(0);
    // type-assertion-boundary: test - narrow the serialized provenance fields under test.
    const advisory = JSON.parse(renderedOutput) as {
      readonly scanProvenance?: { readonly stateFingerprint?: unknown };
    };
    expect(advisory).toMatchObject({
      scanProvenance: {
        gitHead: "scan-head",
        gitDirty: true,
        changedDuringScan: true,
      },
    });
    expect(advisory.scanProvenance?.stateFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("excludes a pre-existing sibling triage report from scan provenance", () => {
    const repo = makeRepo();
    let renderedOutput = "";
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${repo.repoRoot}\n`;
      if (key.endsWith("rev-parse HEAD")) return "scan-head\n";
      if (key.includes("status --porcelain")) {
        return args.includes(":(top,exclude,literal)drift-all.json") ? "" : "?? drift-all.json\n";
      }
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const result = runSemgrepCandidates({
      ...repo,
      git,
      argv: [
        "--semgrep-config",
        "/rules/cli.yml",
        "--rule-license",
        "MIT",
        "--format",
        "json",
        "--output",
        "semgrep-candidates.json",
      ],
      semgrep: () => okResult(),
      writer: (_path, contents) => {
        renderedOutput = contents;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(renderedOutput)).toMatchObject({
      scanProvenance: {
        gitHead: "scan-head",
        gitDirty: false,
        changedDuringScan: null,
      },
    });
  });

  it("probes nested target .semgrepignore files and discloses that they shaped the scan", () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo.repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "src", ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "degraded: the target's own .semgrepignore file(s) further excluded paths from this scan",
    );
    expect(result.stdout).toContain("scan scope: Semgrep target filters applied");
  });

  it("does not attribute a .semgrepignore inside a drift-excluded directory to the scan", () => {
    const repo = makeRepo();
    // "vendor" is a default drift ignore segment, so the scan --excludes it; a
    // .semgrepignore in there cannot have shaped the scan.
    mkdirSync(path.join(repo.repoRoot, "vendor"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "vendor", ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("the target's own .semgrepignore");
    expect(result.stdout).toContain("scan scope: Semgrep target filters applied");
  });

  it("does not attribute a .semgrepignore outside the requested roots to the scan", () => {
    const repo = makeRepo();
    // A nested .semgrepignore governs only its own subtree (Semgrepignore v2
    // gitignore semantics), so with --root src a docs one cannot shape the scan.
    mkdirSync(path.join(repo.repoRoot, "docs"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "docs", ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--root", "src", "--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("the target's own .semgrepignore");
    expect(result.stdout).toContain("scan scope: Semgrep target filters applied");
  });

  it("attributes a .semgrepignore inside a requested root to the scan", () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo.repoRoot, "src", "sub"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "src", "sub", ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--root", "src", "--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("the target's own .semgrepignore");
  });

  it("attributes a .semgrepignore in an ancestor of a requested root to the scan", () => {
    const repo = makeRepo(["packages/server/src/a.ts"]);
    // packages/.semgrepignore governs subtrees that include the root, exactly
    // like the repo-root file; both stay in the scoped probe.
    mkdirSync(path.join(repo.repoRoot, "packages", "server"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "packages", ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: [
        "--root",
        "packages/server",
        "--semgrep-config",
        "/rules/cli.yml",
        "--rule-license",
        "MIT",
      ],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("the target's own .semgrepignore");
  });

  it("attributes a repo-root .semgrepignore to a root-scoped scan", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo.repoRoot, ".semgrepignore"), "fixtures/\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--root", "src", "--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("the target's own .semgrepignore");
  });

  it("never attributes the drift tools checkout to the target's scan shaping", () => {
    const repo = makeRepo();
    // Slice 0 installs the engine under .tools/semgrep/.venv inside the
    // checkout; vendored files there are not target-supplied scan shaping.
    mkdirSync(path.join(repo.repoRoot, ".tools", "semgrep", ".venv"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, ".tools", "semgrep", ".venv", ".semgrepignore"), "*\n");

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("the target's own .semgrepignore");
  });

  it("hands the runner empty roots untouched so Semgrep's own discovery sees the whole repo", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    // No --root and no config roots: the runner owns the "." normalization.
    expect(calls[0]?.roots).toEqual([]);
  });

  it("includes Semgrep-rendered rule messages only under --include-rule-messages", () => {
    const repo = makeRepo();
    const findingScan = emptyScan({
      findings: [
        {
          checkId: "rules.hardcoded-secret",
          path: "src/a.ts",
          startLine: 3,
          startCol: 1,
          endLine: 3,
          endCol: 20,
          // Rendered message with an interpolated matched value, the shape that
          // must never reach a default report.
          message: "Hardcoded secret sk-via-metavar found",
          severity: "ERROR",
          metadata: {
            confidence: "HIGH",
            likelihood: null,
            impact: null,
            category: null,
            subcategory: [],
            cwe: [],
            owasp: [],
            references: [],
          },
        },
      ],
    });
    const runnerResult: SemgrepRunnerResult = {
      ok: true,
      tool: { command: "semgrep", source: "path", version: "1.165.0" },
      scan: findingScan,
      caps: { timeoutMs: 600_000 },
    };
    const baseArgv = ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"];

    const withheld = runSemgrepCandidates({
      ...repo,
      argv: baseArgv,
      semgrep: recordingRunner([], runnerResult),
    });
    const included = runSemgrepCandidates({
      ...repo,
      argv: [...baseArgv, "--include-rule-messages"],
      semgrep: recordingRunner([], runnerResult),
    });

    expect(withheld.exitCode).toBe(0);
    expect(withheld.stdout).not.toContain("sk-via-metavar");
    expect(withheld.stdout).toContain("rule messages: withheld");
    expect(included.exitCode).toBe(0);
    expect(included.stdout).toContain("message: Hardcoded secret sk-via-metavar found");
    expect(included.stdout).toContain("rule messages: included via --include-rule-messages");
  });

  it("exits 0 with an unmet engine prerequisite when the binary is missing", () => {
    const repo = makeRepo();
    const missing: SemgrepRunnerResult = {
      ok: false,
      reason: "tool-unavailable",
      error: "spawn semgrep ENOENT",
      tool: { command: "semgrep", source: "path" },
      caps: { timeoutMs: 600_000 },
    };

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([], missing),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prerequisite semgrep engine: unmet");
  });

  it("skips the scan and exits 0 when no rule source is declared", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({ ...repo, argv: [], semgrep: recordingRunner(calls) });

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("prerequisite semgrep rule source: unmet");
    expect(result.stdout).toContain("no rule sources declared");
  });

  it("skips the scan and exits 0 when every declared source is blocked by the license gate", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--semgrep-config", "/rules/trailofbits", "--rule-license", "AGPL-3.0"],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("prerequisite semgrep rule source: unmet");
    expect(result.stdout).toContain("--allow-rule-license AGPL-3.0");
  });

  it("reports a missing local rule config as an unmet prerequisite without scanning", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      ruleConfigExists: () => false,
      argv: ["--semgrep-config", "/rules/missing.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("prerequisite semgrep rule source: unmet");
    expect(result.stdout).toContain("was not found");
  });

  it("scans only existing local configs and discloses a missing one as excluded", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      ruleConfigExists: (absolutePath) => absolutePath === "/rules/mit.yml",
      argv: [
        "--semgrep-config",
        "/rules/mit.yml",
        "--rule-license",
        "MIT",
        "--semgrep-config",
        "/rules/missing.yml",
        "--rule-license",
        "MIT",
      ],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["/rules/mit.yml"]);
    expect(result.stdout).toContain(
      "degraded: rule source local /rules/missing.yml was excluded from this scan",
    );
    expect(result.stdout).toContain("was not found");
  });

  it("resolves relative rule-config paths from the repo root for the existence probe", () => {
    const repo = makeRepo();
    const probed: string[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      ruleConfigExists: (absolutePath) => {
        probed.push(absolutePath);
        return true;
      },
      argv: ["--semgrep-config", "rules/cli.yml", "--rule-license", "MIT"],
      semgrep: recordingRunner([]),
    });

    expect(result.exitCode).toBe(0);
    expect(probed).toEqual([path.resolve(repo.repoRoot, "rules/cli.yml")]);
  });

  it("probes rule-config existence on the real filesystem by default", () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo.repoRoot, "rules"), { recursive: true });
    writeFileSync(path.join(repo.repoRoot, "rules", "real.yml"), "rules: []\n");
    const calls: SemgrepRunnerInput[] = [];

    // No injected ruleConfigExists: the default existsSync probe must allow the
    // real file and block the missing one.
    const result = runSemgrepCandidates({
      argv: [
        "--semgrep-config",
        "rules/real.yml",
        "--rule-license",
        "MIT",
        "--semgrep-config",
        "rules/missing.yml",
        "--rule-license",
        "MIT",
      ],
      git: repo.git,
      gitBuffer: repo.gitBuffer,
      stat: repo.stat,
      rootExists: repo.rootExists,
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["rules/real.yml"]);
    expect(result.stdout).toContain("rule source local rules/missing.yml was excluded");
  });

  it("scans only the allowed sources when the gate blocks part of the declared set", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: [
        "--semgrep-config",
        "/rules/mit.yml",
        "--rule-license",
        "MIT",
        "--registry-pack",
        "p/default",
      ],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["/rules/mit.yml"]);
    expect(result.stdout).toContain("degraded: rule source registry pack p/default");
  });

  it("passes an opted-in registry pack to the runner as a --config value", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: [
        "--registry-pack",
        "p/default",
        "--allow-live-registry",
        "--allow-rule-license",
        "Semgrep-Rules-License-1.0",
      ],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["p/default"]);
    expect(result.stdout).toContain("reproducible: false");
  });

  it("deduplicates repeated rule configs before invoking Semgrep", () => {
    const repo = makeRepo();
    const manifestPath = writeManifest(repo.repoRoot, [
      { kind: "local", config: "/rules/repeated.yml", license: "MIT" },
    ]);
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: [
        "--rule-source-manifest",
        manifestPath,
        "--semgrep-config",
        "/rules/repeated.yml",
        "--rule-license",
        "MIT",
      ],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["/rules/repeated.yml"]);
  });

  it("rejects a malformed manifest as a usage error with exit 2", () => {
    const repo = makeRepo();
    const manifestPath = path.join(repo.repoRoot, "semgrep-rules.json");
    writeFileSync(manifestPath, "{ not json");
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--rule-source-manifest", manifestPath],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(2);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("is not valid JSON");
  });

  it("rejects an unreadable manifest path as a usage error with exit 2", () => {
    const repo = makeRepo();
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--rule-source-manifest", "no-such-manifest.json"],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(2);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toContain("cannot be read");
  });

  it("resolves a repo-relative manifest path against the repo root", () => {
    const repo = makeRepo();
    writeManifest(repo.repoRoot, [
      { kind: "local", config: "/rules/manifest.yml", license: "MIT" },
    ]);
    const calls: SemgrepRunnerInput[] = [];

    const result = runSemgrepCandidates({
      ...repo,
      argv: ["--rule-source-manifest", "semgrep-rules.json"],
      semgrep: recordingRunner(calls),
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.ruleConfigs).toEqual(["/rules/manifest.yml"]);
  });
});
