import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  makeFixture,
  OUTPUT_ENV,
  parseEnvelope,
  REGRESSION_RECOVERY_FOOTER,
  runLintRatchet,
  seedCleanBaseline,
  TWO_CLI_LAUNCH_TIMEOUT_MS,
  writeDebugSource,
} from "./output-fixture.test-helper.js";

describe("lint ratchet diagnostics output file", () => {
  // The four read-only output cases below build a byte-identical clean+seeded
  // fixture and differ only by the env/args they pass and the output file they
  // read, so they share ONE fixture built once in beforeAll. Each test reads or
  // writes a UNIQUE output filename so the negative-existence assertions stay
  // meaningful (no test can observe another's leftover file). The mutating
  // writeDebugSource case keeps its own throwaway fixture (tracked by the
  // module-level temp handle) so its debugger; mutation never corrupts the
  // shared clean seed.
  const sharedTmpRepo = registerTempRootCleanup(afterAll);
  let sharedFixtureRoot: string;

  beforeAll(async () => {
    sharedFixtureRoot = makeFixture(sharedTmpRepo);
    await seedCleanBaseline(sharedFixtureRoot);
  }, 15_000);

  it(
    "writes the same default-mode envelope to HARNESS_DIAGNOSTICS_OUTPUT",
    { timeout: 15_000 },
    async () => {
      const outputPath = join(sharedFixtureRoot, "diagnostics.json");

      const result = await runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: outputPath });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it(
    "leaves default-mode behavior unchanged when the env var is unset",
    { timeout: 15_000 },
    async () => {
      const outputPath = join(sharedFixtureRoot, "unset-diagnostics.json");

      const result = await runLintRatchet(sharedFixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(outputPath)).toBe(false);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it("treats an empty HARNESS_DIAGNOSTICS_OUTPUT value as unset", { timeout: 15_000 }, async () => {
    const outputPath = join(sharedFixtureRoot, "empty-output.json");

    const result = await runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(false);
    expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
  });

  it(
    "writes the envelope before exiting non-zero for findings",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      await seedCleanBaseline(fixtureRoot);
      writeDebugSource(fixtureRoot);
      const outputPath = join(fixtureRoot, "failure-diagnostics.json");

      const result = await runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: outputPath });

      expect(result.status, result.stderr).toBe(1);
      expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary.blocking).toBe(1);
      expect(envelope.findings[0]?.ruleId).toBe("no-debugger");
      expect(result.stderr).toContain("blocking=1 info=0");
      expect(result.stderr).not.toContain("warning=");
      expect(result.stderr).toContain(REGRESSION_RECOVERY_FOOTER);
    },
  );

  it("creates the output file parent directory when missing", { timeout: 15_000 }, async () => {
    const outputPath = join(sharedFixtureRoot, "new", "nested", "diagnostics.json");

    const result = await runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
  });
});
