import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { DriftAiIgnoreConfig } from "./config.js";
import {
  DEFAULT_SEMGREP_TIMEOUT_MS,
  defaultSemgrepRunner,
  SEMGREP_TOOLS_CHECKOUT_BIN,
  type SemgrepRunnerInput,
  type SemgrepSpawn,
  type SemgrepSpawnResult,
} from "./semgrep-runner.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "semgrep");

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | URL | undefined;
  readonly timeout: number | undefined;
};

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-semgrep-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

function fixtureScanJson(name = "scan-output.logged-out.json"): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

function recordingSpawn(scanResult: SemgrepSpawnResult = successfulScan()): {
  readonly calls: SpawnCall[];
  readonly spawn: SemgrepSpawn;
} {
  const calls: SpawnCall[] = [];
  const spawn: SemgrepSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, timeout: options.timeout });
    if (args.length === 1 && args[0] === "--version") {
      return { status: 0, stdout: "1.165.0\n", stderr: "", signal: null };
    }
    return scanResult;
  };
  return { calls, spawn };
}

function successfulScan(): SemgrepSpawnResult {
  return { status: 0, stdout: fixtureScanJson(), stderr: "", signal: null };
}

const EMPTY_IGNORE: DriftAiIgnoreConfig = { segments: [], prefixes: [], globs: [] };

function runInput(repoRoot: string): SemgrepRunnerInput {
  return {
    repoRoot,
    roots: ["src"],
    ignore: EMPTY_IGNORE,
    ruleConfigs: ["/rules/a.yml"],
  };
}

describe("defaultSemgrepRunner", () => {
  it("uses a binary override and passes report-only flags, configs, and unfiltered roots", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    const result = runner({
      ...runInput(repoRoot),
      // Semgrep does its own file discovery: roots pass through verbatim, with
      // no sourceExtensions gating, so a non-TS target stays reachable.
      roots: ["src", "cmd/main.go"],
      ruleConfigs: ["/rules/a.yml", "p/custom"],
    });

    expect(calls.map((call) => call.command)).toEqual(["/opt/semgrep", "/opt/semgrep"]);
    expect(calls[0]?.args).toEqual(["--version"]);
    const scanCall = calls[1];
    expect(scanCall?.cwd).toBe(repoRoot);
    expect(scanCall?.timeout).toBe(DEFAULT_SEMGREP_TIMEOUT_MS);
    expect(scanCall?.args).toEqual([
      "scan",
      "--json",
      "--metrics=off",
      "--disable-version-check",
      "--oss-only",
      "--config",
      "/rules/a.yml",
      "--config",
      "p/custom",
      "src",
      "cmd/main.go",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tool).toEqual({
        command: "/opt/semgrep",
        source: "override",
        version: "1.165.0",
      });
      expect(result.scan.findings).toHaveLength(4);
      expect(result.caps).toEqual({ timeoutMs: DEFAULT_SEMGREP_TIMEOUT_MS });
    }
  });

  it("normalizes empty roots to the repo-root dot target", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    runner({ ...runInput(repoRoot), roots: [] });

    expect(calls[1]?.args.slice(-1)).toEqual(["."]);
  });

  it("maps the drift ignore config to repeated --exclude flags and writes nothing", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const before = readdirSync(repoRoot, { recursive: true, encoding: "utf8" }).sort();
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    runner({
      ...runInput(repoRoot),
      ignore: { segments: ["node_modules"], prefixes: ["gen/"], globs: ["**/*.min.js"] },
    });

    const args = calls[1]?.args ?? [];
    expect(args.join(" ")).toContain(
      "--exclude **/*.min.js --exclude **/node_modules/** --exclude gen/**",
    );
    // Excludes are CLI-only: no .semgrepignore or any other file lands in the
    // target repo.
    const after = readdirSync(repoRoot, { recursive: true, encoding: "utf8" }).sort();
    expect(after).toEqual(before);
  });

  it("drops exclude globs that would swallow an explicitly requested root", () => {
    const repoRoot = writeRepo({ "src/generated/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    runner({
      ...runInput(repoRoot),
      // Current scope deliberately preserves an explicitly requested ignored
      // root (current-inventory.ts); the exclude mapping must not undo that by
      // letting semgrep silently scan nothing under the requested root.
      roots: ["src/generated", "vendor/app.min.js"],
      ignore: { segments: ["generated"], prefixes: ["docs/"], globs: ["**/*.min.js"] },
    });

    const args = (calls[1]?.args ?? []).join(" ");
    expect(args).toContain("--exclude docs/**");
    expect(args).not.toContain("**/generated/**");
    expect(args).not.toContain("**/*.min.js");
  });

  it("keeps every exclude glob when scanning the whole repo", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    runner({
      ...runInput(repoRoot),
      roots: ["."],
      ignore: { segments: ["generated"], prefixes: [], globs: [] },
    });

    expect((calls[1]?.args ?? []).join(" ")).toContain("--exclude **/generated/**");
  });

  it("resolves the tools-checkout engine path by walking up from the module dir", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const checkoutBin = path.join("/checkout", SEMGREP_TOOLS_CHECKOUT_BIN);
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({
      moduleDir: path.join("/checkout", "scripts", "drift-ai"),
      fileExists: (candidate) => candidate === checkoutBin,
      spawn,
    });

    const result = runner(runInput(repoRoot));

    expect(calls[0]?.command).toBe(checkoutBin);
    expect(result.tool).toMatchObject({ command: checkoutBin, source: "tools-checkout" });
  });

  it("falls back to semgrep on PATH when no override or tools-checkout engine exists", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ fileExists: () => false, spawn });

    const result = runner(runInput(repoRoot));

    expect(calls[0]?.command).toBe("semgrep");
    expect(result.tool).toMatchObject({ command: "semgrep", source: "path" });
  });

  it("returns a tool-unavailable result when the binary cannot be spawned", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const spawn: SemgrepSpawn = () => ({
      error: Object.assign(new Error("spawn semgrep ENOENT"), { code: "ENOENT" }),
      status: null,
      stdout: "",
      stderr: "",
      signal: null,
    });
    const runner = defaultSemgrepRunner({ fileExists: () => false, spawn });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "tool-unavailable",
    });
  });

  it("returns a scan timeout result with the subprocess cap", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { spawn } = recordingSpawn({
      error: Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" }),
      status: null,
      stdout: "",
      stderr: "",
      // Timeout kills arrive with the configured kill signal.
      signal: "SIGKILL",
    });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn, timeoutMs: 1234 });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
      caps: { timeoutMs: 1234 },
      phase: "scan",
    });
  });

  it("falls back to the kill signal and message when a timeout lacks Node's error code", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { spawn } = recordingSpawn({
      error: new Error("spawnSync /opt/semgrep timed out"),
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGKILL",
    });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn, timeoutMs: 1234 });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
      phase: "scan",
    });
  });

  it("marks a --version timeout as a probe-phase timeout", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const spawn: SemgrepSpawn = () => ({
      error: Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" }),
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGKILL",
    });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn, timeoutMs: 1234 });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
      caps: { timeoutMs: 1234 },
      phase: "probe",
    });
  });

  it("treats non-zero semgrep exits as degraded runs, not findings", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { spawn } = recordingSpawn({
      status: 2,
      stdout: "",
      stderr: "invalid rule schema",
      signal: null,
    });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "run-failed",
      error: "semgrep exited 2: invalid rule schema",
    });
  });

  it("treats invalid scan JSON as a degraded run", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { spawn } = recordingSpawn({ status: 0, stdout: "not json {", stderr: "", signal: null });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    const result = runner(runInput(repoRoot));

    expect(result).toMatchObject({ ok: false, reason: "run-failed" });
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/u);
  });

  it("preserves semgrep scan errors for degradation disclosure", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { spawn } = recordingSpawn({
      status: 0,
      stdout: fixtureScanJson("scan-output.synthetic-rich.json"),
      stderr: "",
      signal: null,
    });
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    const result = runner(runInput(repoRoot));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scan.errors).toHaveLength(1);
      expect(result.scan.errors[0]?.message).toContain("Syntax error");
      expect(result.scan.skippedRules).toEqual(["rules.invalid-pattern"]);
    }
  });

  it("refuses to run without an explicit rule config instead of spawning", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultSemgrepRunner({ bin: "/opt/semgrep", spawn });

    const result = runner({ ...runInput(repoRoot), ruleConfigs: [] });

    // Never let semgrep fall through to its default/registry config resolution.
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: false, reason: "run-failed" });
    if (!result.ok) expect(result.error).toContain("--config");
  });
});
