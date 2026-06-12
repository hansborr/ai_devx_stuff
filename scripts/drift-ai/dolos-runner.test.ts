import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import type { DolosReportFiles } from "./dolos-output.js";
import {
  DEFAULT_DOLOS_TIMEOUT_MS,
  defaultDolosRunner,
  type DolosRunnerInput,
  type DolosSpawn,
  type DolosSpawnResult,
} from "./dolos-runner.js";
import { buildSourceExtensions } from "./scope.js";

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
  const root = mkdtempSync(path.join(tmpdir(), "drift-dolos-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

function fixtureReport(): DolosReportFiles {
  return {
    metadataCsv: "property,value,type\nlanguage,typescript,string\nminSimilarity,0.3,number\n",
    filesCsv: [
      "id,ignored,path,content,amountOfKgrams,ast,mapping,extra",
      '1,false,src/a.ts,"export const a = 1;\n",1,[],[],{}',
      '2,false,src/b.ts,"export const b = 1;\n",1,[],[],{}',
    ].join("\n"),
    pairsCsv: [
      "id,leftFileId,leftFilePath,rightFileId,rightFilePath,similarity,totalOverlap,longestFragment,leftCovered,rightCovered",
      "1,src/a.ts,src/a.ts,src/b.ts,src/b.ts,0.91,22,11,0.9,0.88",
    ].join("\n"),
  };
}

function recordingSpawn(runResult: DolosSpawnResult = successfulRun()): {
  readonly calls: SpawnCall[];
  readonly spawn: DolosSpawn;
} {
  const calls: SpawnCall[] = [];
  const spawn: DolosSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, timeout: options.timeout });
    if (args.length === 1 && args[0] === "--version") {
      return { status: 0, stdout: "Dolos 2.9.3\n", stderr: "", signal: null };
    }
    return runResult;
  };
  return { calls, spawn };
}

function successfulRun(): DolosSpawnResult {
  return { status: 0, stdout: "Completed\n", stderr: "", signal: null };
}

function runInput(repoRoot: string): DolosRunnerInput {
  return {
    repoRoot,
    roots: ["src"],
    sourceExtensions: buildSourceExtensions([]),
    ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
    excludeGlobs: ["**/*.test.ts"],
    languageMode: "typescript",
    threshold: 0.3,
    maxFiles: 20,
    maxCandidatePairs: 50,
    maxReportedPairs: 10,
  };
}

describe("defaultDolosRunner", () => {
  it("uses an explicit command override and hands Dolos the filtered source inventory", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
      "src/a.test.ts": "export const skipped = 1;\n",
      "src/types.d.ts": "export type Skipped = string;\n",
      "docs/example.ts": "export const out = 1;\n",
    });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultDolosRunner({
      command: "/opt/dolos",
      readReportFiles: () => fixtureReport(),
      spawn,
    });

    const result = runner(runInput(repoRoot));

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.command)).toEqual(["/opt/dolos", "/opt/dolos"]);
    const runCall = calls[1];
    expect(runCall?.cwd).toBe(repoRoot);
    expect(runCall?.timeout).toBe(DEFAULT_DOLOS_TIMEOUT_MS);
    expect(runCall?.args).toContain("src/a.ts");
    expect(runCall?.args).not.toContain("src/a.test.ts");
    expect(runCall?.args).not.toContain("src/types.d.ts");
    expect(runCall?.args).not.toContain("docs/example.ts");
    if (result.ok) {
      expect(result.tool).toEqual({
        command: "/opt/dolos",
        source: "override",
        version: "2.9.3",
      });
      expect(result.truncation.filesTruncated).toBe(false);
    }
  });

  it("returns a tool-unavailable result when the PATH command cannot be spawned", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const spawn: DolosSpawn = () => ({
      error: Object.assign(new Error("spawn dolos ENOENT"), { code: "ENOENT" }),
      status: null,
      stdout: "",
      stderr: "",
      signal: null,
    });
    const runner = defaultDolosRunner({ readReportFiles: () => fixtureReport(), spawn });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "tool-unavailable",
    });
  });

  it("returns a run-failed result for non-zero Dolos exits", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const { spawn } = recordingSpawn({
      status: 2,
      stdout: "",
      stderr: "language not supported",
      signal: null,
    });
    const runner = defaultDolosRunner({ readReportFiles: () => fixtureReport(), spawn });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "run-failed",
      error: "dolos exited 2: language not supported",
    });
  });

  it("does not spawn Dolos analysis when fewer than two files are eligible", () => {
    const repoRoot = writeRepo({ "src/a.ts": "export const a = 1;\n" });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultDolosRunner({ readReportFiles: () => fixtureReport(), spawn });

    const result = runner(runInput(repoRoot));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["--version"]);
    if (result.ok) {
      expect(result.candidates).toEqual([]);
      expect(result.truncation).toMatchObject({
        eligibleFiles: 1,
        consideredFiles: 1,
        filesTruncated: false,
        parsedPairs: 0,
      });
    }
  });

  it("returns a timeout result when the subprocess exceeds the wall-clock cap", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const { spawn } = recordingSpawn({
      error: Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" }),
      status: null,
      stdout: "",
      stderr: "",
      // Timeout kills arrive with the configured kill signal.
      signal: "SIGKILL",
    });
    const runner = defaultDolosRunner({
      readReportFiles: () => fixtureReport(),
      spawn,
      timeoutMs: 1234,
    });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
      caps: { timeoutMs: 1234 },
    });
  });

  it("falls back to the kill signal and message when a timeout lacks Node's error code", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const { spawn } = recordingSpawn({
      error: new Error("spawnSync dolos timed out"),
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGKILL",
    });
    const runner = defaultDolosRunner({
      readReportFiles: () => fixtureReport(),
      spawn,
      timeoutMs: 1234,
    });

    expect(runner(runInput(repoRoot))).toMatchObject({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
    });
  });

  it("caps the file inventory and preserves candidate/report truncation disclosure", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
      "src/c.ts": "export const c = 1;\n",
    });
    const { calls, spawn } = recordingSpawn();
    const runner = defaultDolosRunner({
      readReportFiles: () => ({
        ...fixtureReport(),
        pairsCsv: [
          "id,leftFileId,leftFilePath,rightFileId,rightFilePath,similarity,totalOverlap,longestFragment,leftCovered,rightCovered",
          "1,src/a.ts,src/a.ts,src/b.ts,src/b.ts,0.91,22,11,0.9,0.88",
          "2,src/a.ts,src/a.ts,src/c.ts,src/c.ts,0.72,12,6,0.7,0.68",
        ].join("\n"),
      }),
      spawn,
    });

    const result = runner({ ...runInput(repoRoot), maxFiles: 2, maxCandidatePairs: 1 });

    expect(result.ok).toBe(true);
    expect(calls[1]?.args).toContain("src/a.ts");
    expect(calls[1]?.args).toContain("src/b.ts");
    expect(calls[1]?.args).not.toContain("src/c.ts");
    if (result.ok) {
      expect(result.truncation).toMatchObject({
        eligibleFiles: 3,
        consideredFiles: 2,
        filesTruncated: true,
        candidatePairsTruncated: true,
      });
      expect(result.candidates).toHaveLength(1);
    }
  });
});
