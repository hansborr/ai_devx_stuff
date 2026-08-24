import { describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";
import {
  clearKnipRunCache,
  DEFAULT_KNIP_TIMEOUT_MS,
  defaultKnipRunner,
  KNIP_DUPLICATES_INCLUDE_CATEGORIES,
  KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES,
  KNIP_FILE_INCLUDE_CATEGORIES,
  KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES,
  KNIP_INCLUDE_CATEGORIES,
  KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES,
  KNIP_SYMBOL_INCLUDE_CATEGORIES,
  type KnipIncludeCategories,
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
      argv: ["--check", "knip-duplicates"],
      expectedInclude: KNIP_DUPLICATES_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "orphan-files", "--check", "unused-exports"],
      expectedInclude: KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "unused-exports", "--check", "orphan-files"],
      expectedInclude: KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "orphan-files", "--check", "knip-duplicates"],
      expectedInclude: KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "unused-exports", "--check", "knip-duplicates"],
      expectedInclude: KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES,
    },
    {
      argv: ["--check", "orphan-files", "--check", "unused-exports", "--check", "knip-duplicates"],
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
      commandLabel: "drift:ai",
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
      commandLabel: "drift:ai",
      knipBin: "/bin/knip",
      spawn,
    });

    expect(runner({ configPath: null })).toMatchObject({ ok: true });
    expect(observedTimeout).toBe(DEFAULT_KNIP_TIMEOUT_MS);
    expect(observedKillSignal).toBe("SIGKILL");
  });

  it("bounds the default knip timeout so a hang is distinguishable from a slow run", () => {
    // J1: the 10-min budget made silence indistinguishable from a hang; cap it at
    // a few minutes so a stuck self-scan surfaces a timeout notice promptly.
    expect(DEFAULT_KNIP_TIMEOUT_MS).toBe(180 * 1000);
  });

  it("emits a stderr start banner naming the budget BEFORE spawning knip", () => {
    const events: string[] = [];
    const spawn: KnipSpawn = () => {
      events.push("spawn");
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
      commandLabel: "caller:knip",
      knipBin: "/bin/knip",
      spawn,
      timeoutMs: 180 * 1000,
      warn: (message) => events.push(`warn:${message}`),
    });

    expect(runner({ configPath: null })).toMatchObject({ ok: true });
    // Banner first, then the spawn — it must be observable before the blocking call.
    expect(events).toEqual(["warn:caller:knip: running knip self-scan (budget 180s)…", "spawn"]);
  });

  it("explains a timed-out knip self-scan on stderr instead of staying silent", () => {
    const warnings: string[] = [];
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
      commandLabel: "caller:knip",
      knipBin: "/bin/knip",
      spawn,
      timeoutMs: 180 * 1000,
      warn: (message) => warnings.push(message),
    });

    expect(runner({ configPath: null })).toEqual({
      ok: false,
      reason: "timeout",
      error: "timeout of 180000ms",
    });
    // Start banner plus an explicit timeout notice — never silence on a skip.
    expect(warnings).toEqual([
      "caller:knip: running knip self-scan (budget 180s)…",
      "caller:knip: knip self-scan timed out after 180s; skipping knip-backed checks for this run.",
    ]);
  });

  it("stays silent when no warn seam is injected so the stdout/JSON contract is untouched", () => {
    const spawn: KnipSpawn = () => ({
      error: undefined,
      status: 0,
      stdout: '{"issues":[]}',
      stderr: "",
      signal: null,
    });

    const runner = defaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      commandLabel: "drift:ai",
      knipBin: "/bin/knip",
      spawn,
    });

    // No warn callback supplied: must not throw and must still return the report.
    expect(runner({ configPath: null })).toMatchObject({ ok: true });
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
      commandLabel: "drift:ai",
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

describe("entry-graph include categories", () => {
  // Regression guard for the include-category bug: knip's vitest plugin only
  // registers a config's setupFiles/globalSetup (and other config-referenced
  // modules) as entry points when the run resolves the dependency graph, which
  // knip does only when `unlisted`/`dependencies` are among the requested
  // categories. If any selection drops them, every knip-backed check
  // false-positives those live test-infrastructure files as orphans/unused.
  const allSelections: readonly KnipIncludeCategories[] = [
    KNIP_FILE_INCLUDE_CATEGORIES,
    KNIP_SYMBOL_INCLUDE_CATEGORIES,
    KNIP_DUPLICATES_INCLUDE_CATEGORIES,
    KNIP_FILE_SYMBOL_INCLUDE_CATEGORIES,
    KNIP_FILE_DUPLICATES_INCLUDE_CATEGORIES,
    KNIP_SYMBOL_DUPLICATES_INCLUDE_CATEGORIES,
    KNIP_INCLUDE_CATEGORIES,
  ];

  it.each(allSelections)(
    "every include-category selection requests unlisted+dependencies (%s)",
    (selection) => {
      const categories = selection.split(",");
      expect(categories).toContain("unlisted");
      expect(categories).toContain("dependencies");
    },
  );

  it.each([
    { argv: ["--check", "orphan-files"] },
    { argv: ["--check", "unused-exports"] },
    { argv: ["--check", "knip-duplicates"] },
    { argv: ["--check", "orphan-files", "--check", "unused-exports"] },
    { argv: ["--check", "orphan-files", "--check", "knip-duplicates"] },
    { argv: ["--check", "unused-exports", "--check", "knip-duplicates"] },
    { argv: ["--check", "all"] },
    { argv: ["--check", "duplicate-literals"] },
  ])("resolveKnipIncludeCategories keeps entry-graph categories for $argv", ({ argv }) => {
    const categories = resolveKnipIncludeCategories(parseArgs(argv).checks).split(",");
    expect(categories).toEqual(expect.arrayContaining(["unlisted", "dependencies"]));
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
      commandLabel: "drift:ai",
      includeCategories: KNIP_FILE_INCLUDE_CATEGORIES,
      knipBin: "/bin/knip",
      underlyingRunner,
    });
    const fullRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      commandLabel: "drift:ai",
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
      commandLabel: "drift:ai",
      knipBin: "/bin/knip",
      timeoutMs: 1000,
      underlyingRunner,
    });
    const twoSecondRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      commandLabel: "drift:ai",
      knipBin: "/bin/knip",
      timeoutMs: 2000,
      underlyingRunner,
    });

    oneSecondRunner({ configPath: "knip.config.ts" });
    twoSecondRunner({ configPath: "knip.config.ts" });

    expect(spawnCount).toBe(2);
  });
});
