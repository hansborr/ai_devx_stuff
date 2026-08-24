import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  DRIVER_WARN,
  makeFixture,
  runLintRatchet,
  seedCleanBaseline,
  SIX_CLI_LAUNCH_TIMEOUT_MS,
  stampFixtureBaselineWithStaleV2Regenerate,
  SUPPRESS_DRIVER_WARN_ENV,
  TWO_CLI_LAUNCH_TIMEOUT_MS,
  writeFixtureRatchetConfig,
} from "./output-fixture.test-helper.js";

describe("lint ratchet merge-driver presence warning", () => {
  it(
    "warns in check/update, stays off stdout, and suppresses for installed drivers and CI",
    { timeout: SIX_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      writeFixtureRatchetConfig(fixtureRoot);

      const update = await runLintRatchet(fixtureRoot, ["--update"]);
      expect(update.status).toBe(0);
      expect(update.stdout).not.toContain(DRIVER_WARN);
      expect(update.stderr.split(DRIVER_WARN).length - 1).toBe(1);

      const check = await runLintRatchet(fixtureRoot, ["--check-baseline"]);
      expect(check.status).toBe(0);
      expect(check.stdout).not.toContain(DRIVER_WARN);
      expect(check.stderr.split(DRIVER_WARN).length - 1).toBe(1);

      const ci = await runLintRatchet(fixtureRoot, ["--check-baseline"], { CI: "1" });
      expect(ci.status).toBe(0);
      expect(ci.stderr).not.toContain(DRIVER_WARN);

      const suppressed = await runLintRatchet(fixtureRoot, ["--check-baseline"], {
        [SUPPRESS_DRIVER_WARN_ENV]: "1",
      });
      expect(suppressed.status).toBe(0);
      expect(suppressed.stderr).not.toContain(DRIVER_WARN);

      const installation = spawnSync("bash", ["scripts/git/install-lint-ratchet-merge-driver.sh"], {
        cwd: fixtureRoot,
        encoding: "utf8",
      });
      expect(installation.status, installation.stderr).toBe(0);
      expect(installation.stderr).not.toContain("install: WARN");
      const installed = await runLintRatchet(fixtureRoot, ["--check-baseline"]);
      expect(installed.status).toBe(0);
      expect(installed.stderr).not.toContain(DRIVER_WARN);
    },
  );
});

describe("lint ratchet baseline annotation warning", () => {
  it(
    "warns without failing check mode when a v2 regenerate annotation is stale",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      await seedCleanBaseline(fixtureRoot);
      stampFixtureBaselineWithStaleV2Regenerate(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot, ["--check-baseline"], {
        [SUPPRESS_DRIVER_WARN_ENV]: "1",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain(
        "lint:ratchet WARN - baseline regenerate annotation is stale; regenerate with `bun run lint:ratchet:update`",
      );
      expect(result.stderr).toContain("lint:ratchet:check-baseline OK");
    },
  );
});
