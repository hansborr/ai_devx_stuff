import { describe, expect, it } from "vitest";

import {
  makeFixture,
  parseEnvelope,
  replaceFixtureMessageFingerprint,
  replaceFixtureRuleSourceHash,
  runLintRatchet,
  seedCleanBaseline,
  stripFixtureMessageFingerprint,
  TWO_CLI_LAUNCH_TIMEOUT_MS,
  writeDebugSource,
} from "./output-fixture.test-helper.js";

describe("lint ratchet rule-source drift output", () => {
  it(
    "classifies stale rule identity when current findings still match",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      await seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary.blocking).toBe(0);
      expect(result.stderr).toContain("rule source identity drift only — findings unchanged");
      expect(result.stderr).not.toContain("equal-count message swaps not provable");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "narrows the claim to finding counts when a baseline item lacks a message fingerprint",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      await seedCleanBaseline(fixtureRoot);
      stripFixtureMessageFingerprint(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary).toMatchObject({ blocking: 0, info: 0 });
      expect(result.stderr).toContain("rule source identity drift only — finding counts unchanged");
      expect(result.stderr).toContain(
        "equal-count message swaps not provable without messagesFingerprint",
      );
      expect(result.stderr).not.toContain("— findings unchanged");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "surfaces informational equal-count swaps while classifying stale rule identity",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      await seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);
      replaceFixtureMessageFingerprint(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary).toMatchObject({ blocking: 0, info: 1 });
      expect(envelope.findings[0]?.reason).toBe("equal-count-message-swap");
      expect(result.stderr).toContain("rule source identity drift — finding set changed");
      expect(result.stderr).toContain("informational finding changes");
      expect(result.stderr).not.toContain("current findings match");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "keeps reporting finding changes when stale rule identity changes results",
    { timeout: TWO_CLI_LAUNCH_TIMEOUT_MS },
    async () => {
      const fixtureRoot = makeFixture();
      await seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);
      writeDebugSource(fixtureRoot);

      const result = await runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary.blocking).toBe(1);
      expect(result.stderr).toContain("rule source identity drift — finding set changed");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );
});
