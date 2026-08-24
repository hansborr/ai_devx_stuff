import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  makeFixture,
  parseEnvelope,
  perTestTmpRepo,
  runLintRatchet,
  seedCleanBaseline,
  stageFixtureFiles,
  TWO_CLI_LAUNCH_TIMEOUT_MS,
  writeDebugSourceAt,
  writeFixtureRatchetConfig,
  writeInlineDisabledDebugSource,
} from "./output-fixture.test-helper.js";

describe("lint ratchet inline suppression collection", () => {
  it(
    "counts a ratcheted violation even when the source has an inline disable",
    { timeout: 15_000 },
    async () => {
      const fixtureRoot = makeFixture();
      writeInlineDisabledDebugSource(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot, ["--update"]);

      expect(result.status, result.stderr).toBe(0);
      const baseline = JSON.parse(
        readFileSync(join(fixtureRoot, "lint-ratchet.baseline.json"), "utf8"),
      ) as {
        readonly tests: {
          readonly [testId: string]: {
            readonly items: { readonly [path: string]: { readonly count: number } };
          };
        };
      };
      expect(
        baseline.tests["ratchet/fixture-no-debugger"]?.items["packages/app/src/example.ts"]?.count,
      ).toBe(1);
    },
  );
});

describe("lint ratchet update preflight", () => {
  it("refuses a stale install before writing the baseline", { timeout: 15_000 }, async () => {
    const fixtureRoot = makeFixture();
    writeFileSync(join(fixtureRoot, "bun.lock"), "stale fixture lock\n");

    const result = await runLintRatchet(fixtureRoot, ["--update"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "install state is stale; run bun install, then re-run bun run lint:ratchet:update",
    );
    expect(existsSync(join(fixtureRoot, "lint-ratchet.baseline.json"))).toBe(false);
  });

  it("rejects empty ratchet globs before writing the baseline", { timeout: 15_000 }, async () => {
    const fixtureRoot = makeFixture(perTestTmpRepo, {
      files: ["packages/app/src/missing/**/*.ts"],
    });

    const result = await runLintRatchet(fixtureRoot, ["--update"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("empty-glob");
    expect(result.stderr).toContain("ratchet/fixture-no-debugger");
    expect(existsSync(join(fixtureRoot, "lint-ratchet.baseline.json"))).toBe(false);
  });

  it(
    "lets update account for orphaned baselines with an explicit worse-baseline reason",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture(perTestTmpRepo, {
        ratchetId: "ratchet/fixture-old-no-debugger",
      });
      await seedCleanBaseline(fixtureRoot);
      writeFixtureRatchetConfig(fixtureRoot, { ratchetId: "ratchet/fixture-no-debugger" });

      const result = await runLintRatchet(fixtureRoot, [
        "--update",
        "--allow-worse",
        "--reason",
        "Accept the fixture orphan so update can prove it owns baseline removals.",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("lint:ratchet:update OK");
      expect(result.stderr).toContain("Recorded the debt acceptance");
      expect(readFileSync(join(fixtureRoot, "lint-ratchet.baseline.json"), "utf8")).toContain(
        '"ratchet/fixture-no-debugger"',
      );
    },
  );
});

describe("lint ratchet tracked-file collection", () => {
  it(
    "ignores untracked files that match the ratchet glob",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      await seedCleanBaseline(fixtureRoot);
      writeDebugSourceAt(fixtureRoot, "packages/app/src/untracked-debug.ts");

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it(
    "keeps explicitly ignored tracked files out of ratchet collection",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture(perTestTmpRepo, {
        ignores: [
          "**/dist/**",
          "**/generated/**",
          "**/node_modules/**",
          "packages/app/src/ignored.ts",
        ],
      });
      writeDebugSourceAt(fixtureRoot, "packages/app/src/ignored.ts");
      stageFixtureFiles(fixtureRoot);
      await seedCleanBaseline(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );
});
