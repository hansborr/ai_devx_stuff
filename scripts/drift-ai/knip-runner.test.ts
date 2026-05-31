import { describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";
import {
  clearKnipRunCache,
  DEFAULT_KNIP_TIMEOUT_MS,
  defaultKnipRunner,
  KNIP_FILE_INCLUDE_CATEGORIES,
  KNIP_INCLUDE_CATEGORIES,
  KNIP_SYMBOL_INCLUDE_CATEGORIES,
  type KnipRunner,
  type KnipSpawn,
  memoizingDefaultKnipRunner,
  resolveKnipIncludeCategories,
} from "./knip-runner.js";

describe("defaultKnipRunner", () => {
  it.each([
    {
      argv: ["--check", "orphan-files"],
      expectedInclude: KNIP_FILE_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "unused-exports"],
      expectedInclude: KNIP_SYMBOL_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "orphan-files", "--check", "unused-exports"],
      expectedInclude: KNIP_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "unused-exports", "--check", "orphan-files"],
      expectedInclude: KNIP_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "all"],
      expectedInclude: KNIP_INCLUDE_CATEGORIES,
    },
  ])("passes selected-check-aware include categories for $argv", ({ argv, expectedInclude }) => {
    let observedArgs: readonly string[] = [];
    const spawn: KnipSpawn = (_command, args) => {
      observedArgs = args;
      return {
        error: undefined,
        status: 0,
        stdout: '{"issues":[]}',
        stderr: "",
        signal: null,
      };
    };

    const runner = defaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      includeCategories: resolveKnipIncludeCategories(parseArgs(argv).checks),
      knipBin: "/bin/knip",
      spawn,
    });

    expect(runner({ configPath: "knip.config.ts" })).toMatchObject({ ok: true });
    expect(observedArgs).toEqual([
      "--reporter",
      "json",
      "--include",
      expectedInclude,
      "--no-progress",
      "--config",
      "knip.config.ts",
    ]);
  });

  it("passes the default timeout to the knip subprocess", () => {
    let observedTimeout: number | undefined;
    let observedKillSignal: number | NodeJS.Signals | undefined;
    const spawn: KnipSpawn = (_command, _args, options) => {
      observedTimeout = options.timeout;
      observedKillSignal = options.killSignal;
      return {
        error: undefined,
        status: 0,
        stdout: '{"issues":[]}',
        stderr: "",
        signal: null,
      };
    };

    const runner = defaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      spawn,
    });

    expect(runner({ configPath: null })).toMatchObject({ ok: true });
    expect(observedTimeout).toBe(DEFAULT_KNIP_TIMEOUT_MS);
    expect(observedKillSignal).toBe("SIGKILL");
  });

  it("returns a dedicated timeout result when spawnSync times out", () => {
    const timeoutError = Object.assign(new Error("spawnSync timed out"), {
      code: "ETIMEDOUT",
    });
    const spawn: KnipSpawn = () => ({
      error: timeoutError,
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    });

    const runner = defaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      spawn,
      timeoutMs: 1234,
    });

    expect(runner({ configPath: "knip.config.ts" })).toEqual({
      ok: false,
      reason: "timeout",
      error: "timeout of 1234ms",
    });
  });
});

describe("memoizingDefaultKnipRunner", () => {
  it("keys cached results by include categories", () => {
    clearKnipRunCache();
    let spawnCount = 0;
    const underlyingRunner: KnipRunner = () => {
      spawnCount += 1;
      return { ok: true, reportJson: '{"issues":[]}', exitCode: 0, stderr: "" };
    };

    const fileOnlyRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      includeCategories: KNIP_FILE_INCLUDE_CATEGORIES,
      knipBin: "/bin/knip",
      underlyingRunner,
    });
    const fullRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      includeCategories: KNIP_INCLUDE_CATEGORIES,
      knipBin: "/bin/knip",
      underlyingRunner,
    });

    fileOnlyRunner({ configPath: "knip.config.ts" });
    fullRunner({ configPath: "knip.config.ts" });

    expect(spawnCount).toBe(2);
  });

  it("keys cached results by timeout budget", () => {
    clearKnipRunCache();
    let spawnCount = 0;
    const underlyingRunner: KnipRunner = () => {
      spawnCount += 1;
      return { ok: true, reportJson: '{"issues":[]}', exitCode: 0, stderr: "" };
    };

    const oneSecondRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      timeoutMs: 1000,
      underlyingRunner,
    });
    const twoSecondRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      timeoutMs: 2000,
      underlyingRunner,
    });

    oneSecondRunner({ configPath: "knip.config.ts" });
    twoSecondRunner({ configPath: "knip.config.ts" });

    expect(spawnCount).toBe(2);
  });
});
