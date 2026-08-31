import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { defaultGitRunner } from "./lib/git.js";
import {
  findDefaultStrykerConfigFile,
  loadMutationLane,
  MutationTargetsError,
  parseMutateOverride,
  selectMutateTargets,
  SUPPORTED_STRYKER_CONFIG_FILE_NAMES,
} from "./lib/mutation-targets.js";
import { runMutationTargetsCli } from "./mutation-targets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = defaultGitRunner({ cwd: repoRoot });

const temporaryLaneDirs: string[] = [];

/** Write a throwaway lane config and return the cwd it should be resolved from. */
function laneFixture(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "musi-mutation-lane-"));
  temporaryLaneDirs.push(dir);
  writeFileSync(path.join(dir, "stryker.config.mjs"), source, "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of temporaryLaneDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function trackedFiles(): string[] {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter((entry) => entry.length > 0);
}

async function laneTargets(configFile: string): Promise<string[]> {
  const lane = await loadMutationLane(configFile, repoRoot);
  expect(lane.mutate, `${configFile} declares no mutate globs`).toBeDefined();
  return selectMutateTargets(trackedFiles(), lane.mutate ?? [], repoRoot);
}

describe("selectMutateTargets", () => {
  const cwd = "/repo";

  it("selects the files a positive glob matches and nothing else", () => {
    const selected = selectMutateTargets(
      ["src/a.ts", "src/nested/b.ts", "src/a.js", "other/c.ts"],
      ["src/**/*.ts"],
      cwd,
    );

    expect(selected).toEqual(["src/a.ts", "src/nested/b.ts"]);
  });

  it("drops files matched by a later ! exclusion", () => {
    const selected = selectMutateTargets(
      ["src/a.ts", "src/a.test.ts", "src/nested/b.test.ts"],
      ["src/**/*.ts", "!**/*.test.ts"],
      cwd,
    );

    expect(selected).toEqual(["src/a.ts"]);
  });

  it("applies patterns in order, so a later inclusion re-adds an excluded file", () => {
    const excludedFirst = selectMutateTargets(
      ["src/keep.ts", "src/gen/made.ts"],
      ["src/**/*.ts", "!src/gen/**", "src/gen/made.ts"],
      cwd,
    );
    const excludedLast = selectMutateTargets(
      ["src/keep.ts", "src/gen/made.ts"],
      ["src/**/*.ts", "src/gen/made.ts", "!src/gen/**"],
      cwd,
    );

    expect(excludedFirst).toEqual(["src/keep.ts", "src/gen/made.ts"]);
    expect(excludedLast).toEqual(["src/keep.ts"]);
  });

  it("excludes dotfiles, matching Stryker's allowHiddenFiles=false matcher", () => {
    const selected = selectMutateTargets(
      ["src/a.ts", "src/.hidden/b.ts", "src/.rc.ts"],
      ["src/**/*.ts"],
      cwd,
    );

    expect(selected).toEqual(["src/a.ts"]);
  });

  it("resolves candidates and patterns against cwd, so paths outside it never match", () => {
    const selected = selectMutateTargets(["../elsewhere/a.ts", "src/a.ts"], ["src/**/*.ts"], cwd);

    expect(selected).toEqual(["src/a.ts"]);
  });

  it("de-duplicates repeated candidates", () => {
    const selected = selectMutateTargets(["src/a.ts", "src/a.ts"], ["src/**/*.ts"], cwd);

    expect(selected).toEqual(["src/a.ts"]);
  });

  it("strips a Stryker mutation-range suffix before matching", () => {
    const selected = selectMutateTargets(["src/a.ts", "src/b.ts"], ["src/a.ts:1-11"], cwd);

    expect(selected).toEqual(["src/a.ts"]);
  });

  it("returns an empty selection when no pattern matches", () => {
    expect(selectMutateTargets(["src/a.ts"], ["lib/**/*.ts"], cwd)).toEqual([]);
    expect(selectMutateTargets(["src/a.ts"], [], cwd)).toEqual([]);
  });
});

describe("loadMutationLane", () => {
  it("reads mutate globs and inPlace from a lane config's default export", async () => {
    const lane = await loadMutationLane("stryker.config.server.mjs", repoRoot);

    expect(lane.inPlace).toBe(true);
    expect(lane.mutate).toContain("packages/server/src/services/**/*.ts");
  });

  it("reports the sandboxed shared lane as not in-place", async () => {
    const lane = await loadMutationLane("stryker.config.mjs", repoRoot);

    expect(lane.inPlace).toBe(false);
  });

  it("reads a lane that omits mutate, leaving Stryker's own default in force", async () => {
    const cwd = laneFixture("export default { inPlace: false };\n");

    const lane = await loadMutationLane("stryker.config.mjs", cwd);

    expect(lane.mutate).toBeUndefined();
    expect(lane.inPlace).toBe(false);
  });

  it("throws MutationTargetsError for a config that cannot be imported", async () => {
    await expect(loadMutationLane("stryker.config.missing.mjs", repoRoot)).rejects.toBeInstanceOf(
      MutationTargetsError,
    );
  });

  it("throws MutationTargetsError for a module without a usable default export", async () => {
    await expect(loadMutationLane("scripts/mutation-targets.ts", repoRoot)).rejects.toBeInstanceOf(
      MutationTargetsError,
    );
  });
});

describe("findDefaultStrykerConfigFile", () => {
  it("lists Stryker's own supported config file names", () => {
    expect(SUPPORTED_STRYKER_CONFIG_FILE_NAMES).toContain("stryker.config.mjs");
    expect(SUPPORTED_STRYKER_CONFIG_FILE_NAMES).toContain("stryker.conf.json");
    expect(SUPPORTED_STRYKER_CONFIG_FILE_NAMES).toContain(".stryker.config.cjs");
  });

  it("resolves this repo's default lane to stryker.config.mjs", () => {
    expect(findDefaultStrykerConfigFile(repoRoot)).toBe("stryker.config.mjs");
  });

  it("returns undefined when no supported config file exists", () => {
    expect(findDefaultStrykerConfigFile(path.join(repoRoot, "scripts", "lib"))).toBeUndefined();
  });
});

describe("in-place lane target resolution", () => {
  // Stryker's matcher runs with `dot: false`, so nothing under a hidden path is
  // ever a target. Everything else about these three lanes is a plain
  // prefix/suffix rule, which makes an independent filter over `git ls-files` a
  // usable oracle — and an exact one, so an over-narrow glob that silently stops
  // matching a subdirectory fails here just as loudly as a dropped `!`.
  const visible = (file: string): boolean =>
    !file.split("/").some((segment) => segment.startsWith("."));

  it("pins the server lane to exactly its tracked service sources", async () => {
    const expected = trackedFiles().filter(
      (file) =>
        file.startsWith("packages/server/src/services/") &&
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        visible(file),
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(await laneTargets("stryker.config.server.mjs")).toEqual(expected);
  });

  it("pins the scripts lane to exactly its tracked sources, honouring every ! exclusion", async () => {
    const expected = trackedFiles().filter(
      (file) =>
        file.startsWith("scripts/") &&
        file.endsWith(".ts") &&
        !file.startsWith("scripts/codemods/") &&
        !file.endsWith(".test.ts") &&
        !file.includes("/fixtures/") &&
        file !== "scripts/vitest.config.ts" &&
        visible(file),
    );

    expect(expected).toContain("scripts/mutation-survivors.ts");
    expect(await laneTargets("scripts/stryker-scripts.mjs")).toEqual(expected);
  });

  it("pins the lint-ratchet lane to exactly its tracked package sources", async () => {
    const expected = trackedFiles().filter(
      (file) =>
        file.startsWith("tools/lint-ratchet/src/") &&
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        !file.includes("/fixtures/") &&
        visible(file),
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(await laneTargets("tools/stryker-lint-ratchet.mjs")).toEqual(expected);
  });
});

describe("parseMutateOverride", () => {
  it("splits on commas the way Stryker's own CLI splitter does", () => {
    expect(parseMutateOverride("src/a.ts,src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("drops the empty records that splitter filters out", () => {
    expect(parseMutateOverride("src/a.ts,,")).toEqual(["src/a.ts"]);
    expect(parseMutateOverride("")).toEqual([]);
  });

  it("keeps ! exclusions intact so ordering still decides", () => {
    expect(parseMutateOverride("src/**/*.ts,!**/*.test.ts")).toEqual([
      "src/**/*.ts",
      "!**/*.test.ts",
    ]);
  });
});

describe("runMutationTargetsCli", () => {
  // Reading stdin eagerly would block until EOF, so every path that answers
  // from argv alone must never call this.
  const refuseStdin = (): string => {
    throw new Error("stdin was read");
  };

  it("writes the selected targets as NUL-delimited stdout", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--config", "tools/stryker-lint-ratchet.mjs"],
      readStdin: () =>
        ["tools/lint-ratchet/src/engine.ts", "tools/lint-ratchet/src/engine.test.ts"].join("\0"),
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("tools/lint-ratchet/src/engine.ts\0");
    expect(result.stderr).toBe("");
  });

  it("falls back to Stryker's default config lookup when --config is omitted", async () => {
    const result = await runMutationTargetsCli({
      argv: [],
      readStdin: () => "packages/shared/src/dice/roll.ts\0",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("packages/shared/src/dice/roll.ts\0");
  });

  it("exits 3 with no output when --require-in-place meets a sandboxed lane", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--config", "stryker.config.mjs", "--require-in-place"],
      readStdin: () => "packages/shared/src/dice/roll.ts\0",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
  });

  it("exits 0 with --require-in-place on an in-place lane", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--config", "scripts/stryker-scripts.mjs", "--require-in-place"],
      readStdin: () => "scripts/mutation-targets.ts\0",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("scripts/mutation-targets.ts\0");
  });

  it("exits 3 before reading mutate when a sandboxed lane omits it", async () => {
    const cwd = laneFixture("export default { inPlace: false };\n");

    const result = await runMutationTargetsCli({
      argv: ["--config", "stryker.config.mjs", "--require-in-place"],
      readStdin: () => "src/a.ts\0",
      cwd,
    });

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("");
  });

  it("exits 2 when an in-place lane omits mutate, leaving the rails no scope", async () => {
    const cwd = laneFixture("export default { inPlace: true };\n");

    const result = await runMutationTargetsCli({
      argv: ["--config", "stryker.config.mjs", "--require-in-place"],
      readStdin: () => "src/a.ts\0",
      cwd,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('declares no "mutate" globs');
  });

  it("exits 2 with usage on an unknown argument", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--nope"],
      readStdin: () => "",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown argument: --nope");
  });

  it("exits 2 when the named config cannot be loaded", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--config", "stryker.config.missing.mjs"],
      readStdin: () => "",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("stryker.config.missing.mjs");
  });

  it("prints usage for --help", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--help"],
      readStdin: () => "",
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mutation-targets.ts");
  });

  it("takes --mutate over the lane config's globs, replacing them as stryker run does", async () => {
    const result = await runMutationTargetsCli({
      argv: [
        "--config",
        "scripts/stryker-scripts.mjs",
        "--require-in-place",
        "--mutate",
        "scripts/*.test.ts",
      ],
      readStdin: () => "scripts/mutation-targets.ts\0scripts/mutation-targets.test.ts\0",
      cwd: repoRoot,
    });

    // The lane's own globs include mutation-targets.ts and exclude every
    // *.test.ts, so a union or an ignored override would both fail here.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("scripts/mutation-targets.test.ts\0");
  });

  it("gives an in-place lane that omits mutate a scope when --mutate supplies one", async () => {
    const cwd = laneFixture("export default { inPlace: true };\n");

    const result = await runMutationTargetsCli({
      argv: [
        "--config",
        "stryker.config.mjs",
        "--require-in-place",
        "--mutate",
        "src/a.ts,src/b.ts",
      ],
      readStdin: () => "src/a.ts\0src/c.ts\0",
      cwd,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("src/a.ts\0");
  });

  it("does not read stdin for --help, which would hang the real CLI on a terminal", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--help"],
      readStdin: refuseStdin,
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("does not read stdin on a usage error", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--nope"],
      readStdin: refuseStdin,
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown argument: --nope");
  });

  it("does not read stdin when --require-in-place rejects a sandboxed lane", async () => {
    const result = await runMutationTargetsCli({
      argv: ["--config", "stryker.config.mjs", "--require-in-place"],
      readStdin: refuseStdin,
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(3);
  });
});

describe("mutation-targets CLI entrypoint", () => {
  // The injected-reader cases above cannot see the entrypoint's own wiring, and
  // that is where the hang would live: `readFileSync(0, "utf8")` blocks until
  // EOF, so evaluating it as an argument hangs `bun scripts/mutation-targets.ts
  // --help` for anyone who runs it in a terminal rather than through the
  // runner's pipe. Spawn the shipped entrypoint with an open stdin pipe that is
  // never written or closed: it exits only while the read stays lazy.
  const exitTimeoutMs = 20_000;
  const testTimeoutMs = exitTimeoutMs * 2;

  it(
    "exits on --help with stdin left open",
    async () => {
      const child = spawn(
        "bun",
        [path.join(repoRoot, "scripts", "mutation-targets.ts"), "--help"],
        {
          cwd: repoRoot,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      try {
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("mutation-targets --help did not exit with stdin left open"));
          }, exitTimeoutMs);
          child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });

        expect(exitCode).toBe(0);
        expect(stdout).toContain("Usage:");
      } finally {
        child.stdin.destroy();
      }
    },
    testTimeoutMs,
  );
});
