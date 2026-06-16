import { describe, expect, it } from "vitest";

import type { ClientTestIsolationClassification } from "./client-test-isolation-classifier-types.js";
import {
  buildClientTestIsolationSplitPlan,
  runClientTestIsolationSplitCli,
} from "./client-test-isolation-runner.js";

const ISOLATION_REASON = {
  kind: "module-registry-mutation",
  line: 1,
  method: "mock",
  expression: 'vi.mock("./mocked.js")',
  moduleName: "./mocked.js",
} as const;

const SPLIT_CLASSIFICATION = {
  noIsolateFiles: ["packages/client/src/a-fast.test.ts"],
  isolatedFiles: [
    {
      file: "packages/client/src/b-isolated.test.tsx",
      mode: "isolated",
      reasons: [ISOLATION_REASON],
    },
  ],
  totals: { testFiles: 2, noIsolate: 1, isolated: 1 },
} satisfies ClientTestIsolationClassification;

describe("buildClientTestIsolationSplitPlan", () => {
  it("builds a shuffled no-isolate lane and a normal isolated lane", () => {
    const plan = buildClientTestIsolationSplitPlan(SPLIT_CLASSIFICATION, {
      vitestArgs: ["--reporter=verbose"],
    });

    expect(plan.lanes).toEqual([
      {
        name: "fast",
        description: "no-isolate shuffled client tests",
        files: ["packages/client/src/a-fast.test.ts"],
        args: [
          "run",
          "--passWithNoTests",
          "--project=client",
          "--no-isolate",
          "--sequence.shuffle.files",
          "--reporter=verbose",
          "packages/client/src/a-fast.test.ts",
        ],
      },
      {
        name: "compatibility",
        description: "isolated client tests",
        files: ["packages/client/src/b-isolated.test.tsx"],
        args: [
          "run",
          "--passWithNoTests",
          "--project=client",
          "--reporter=verbose",
          "packages/client/src/b-isolated.test.tsx",
        ],
      },
    ]);
    expect(plan.totals).toEqual({ testFiles: 2, noIsolate: 1, isolated: 1 });
  });

  it("skips an empty bucket instead of invoking Vitest without file paths", () => {
    const classification = {
      noIsolateFiles: [],
      isolatedFiles: SPLIT_CLASSIFICATION.isolatedFiles,
      totals: { testFiles: 1, noIsolate: 0, isolated: 1 },
    } satisfies ClientTestIsolationClassification;

    const plan = buildClientTestIsolationSplitPlan(classification);

    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0]?.name).toBe("compatibility");
    expect(plan.lanes[0]?.args).toContain("packages/client/src/b-isolated.test.tsx");
  });
});

describe("runClientTestIsolationSplitCli", () => {
  it("runs both lanes, prints bucket counts, and returns the first failing exit code", () => {
    const commands: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
    const stdout: string[] = [];

    const exitCode = runClientTestIsolationSplitCli({
      argv: [],
      cwd: "/repo",
      classify: () => SPLIT_CLASSIFICATION,
      runCommand: (command, args) => {
        commands.push({ command, args });
        return { status: commands.length === 1 ? 7 : 0, signal: null };
      },
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
    });

    expect(exitCode).toBe(7);
    expect(stdout.join("")).toContain(
      "client-test:split - 1 no-isolate file(s), 1 isolated file(s), 2 total.",
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]?.command).toBe("bash");
    expect(commands[0]?.args).toContain("scripts/vitest.sh");
    expect(commands[0]?.args).toContain("--no-isolate");
    expect(commands[1]?.args).not.toContain("--no-isolate");
  });

  it("stops after a lane is killed by a signal instead of launching the next lane", () => {
    const commands: Array<{ readonly command: string; readonly args: readonly string[] }> = [];

    const exitCode = runClientTestIsolationSplitCli({
      argv: [],
      cwd: "/repo",
      classify: () => SPLIT_CLASSIFICATION,
      runCommand: (command, args) => {
        commands.push({ command, args });
        return { status: null, signal: "SIGINT" };
      },
      stdout: () => undefined,
      stderr: () => undefined,
    });

    // Ctrl-C during the fast lane must not start the compatibility lane behind
    // the user's back, and the exit code is the conventional 128 + SIGINT(2).
    expect(commands).toHaveLength(1);
    expect(exitCode).toBe(130);
  });

  it("stops and surfaces the error when a lane fails to even start", () => {
    const commands: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
    const stderr: string[] = [];

    const exitCode = runClientTestIsolationSplitCli({
      argv: [],
      cwd: "/repo",
      classify: () => SPLIT_CLASSIFICATION,
      runCommand: (command, args) => {
        commands.push({ command, args });
        return { status: 1, signal: null, error: new Error("spawn bash ENOENT") };
      },
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
    });

    // A failed-to-start fast lane must not launch the compatibility lane (which
    // would fail to start identically), and the underlying error is surfaced.
    expect(commands).toHaveLength(1);
    expect(exitCode).toBe(1);
    expect(stderr.join("")).toContain("fast lane failed to start: spawn bash ENOENT");
  });

  it("rejects coverage arguments because split coverage is not merged yet", () => {
    const commands: Array<readonly string[]> = [];
    const stderr: string[] = [];

    const exitCode = runClientTestIsolationSplitCli({
      argv: ["--coverage"],
      cwd: "/repo",
      classify: () => SPLIT_CLASSIFICATION,
      runCommand: (_command, args) => {
        commands.push(args);
        return { status: 0, signal: null };
      },
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(2);
    expect(commands).toEqual([]);
    expect(stderr.join("")).toContain("coverage is intentionally unsupported");
  });

  it("rejects output-file arguments because split reports are not merged yet", () => {
    const commands: Array<readonly string[]> = [];
    const stderr: string[] = [];

    const exitCode = runClientTestIsolationSplitCli({
      argv: ["--reporter=json", "--outputFile.json=/tmp/client.json"],
      cwd: "/repo",
      classify: () => SPLIT_CLASSIFICATION,
      runCommand: (_command, args) => {
        commands.push(args);
        return { status: 0, signal: null };
      },
      stdout: () => undefined,
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(2);
    expect(commands).toEqual([]);
    expect(stderr.join("")).toContain("output files are intentionally unsupported");
  });
});
