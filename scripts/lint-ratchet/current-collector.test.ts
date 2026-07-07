import { afterEach, describe, expect, it, vi } from "vitest";

import { collectCurrentById } from "./current-collector.js";
import { type LintRatchetConfig, lintRatchets } from "./lint-ratchet-config.js";

const eslintRunnerMock = vi.hoisted(() => ({
  runEslintForFiles: vi.fn(),
  sweepStaleCacheSiblings: vi.fn(),
}));

vi.mock("./eslint-runner.js", () => eslintRunnerMock);

const FIXTURE_RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;

function fixtureRuleSourceHashes(): Map<string, string> {
  return new Map(lintRatchets.map((ratchet) => [ratchet.id, FIXTURE_RULE_SOURCE_HASH]));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

describe("collectCurrentById", () => {
  afterEach(() => {
    eslintRunnerMock.runEslintForFiles.mockReset();
    eslintRunnerMock.sweepStaleCacheSiblings.mockReset();
  });

  it("runs ratchet collection with bounded concurrency while preserving registry-order output", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const startedIds: string[] = [];
    const finishedIds: string[] = [];

    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      startedIds.push(ratchet.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const ratchetIndex = lintRatchets.findIndex((entry) => entry.id === ratchet.id);
      await delay((lintRatchets.length - ratchetIndex) * 2);
      inFlight -= 1;
      finishedIds.push(ratchet.id);
      return [];
    });

    const currentById = await collectCurrentById(fixtureRuleSourceHashes(), 3);

    expect(maxInFlight).toBe(3);
    expect(startedIds.slice(0, 3)).toStrictEqual(
      lintRatchets.slice(0, 3).map((ratchet) => ratchet.id),
    );
    expect(finishedIds).not.toStrictEqual(lintRatchets.map((ratchet) => ratchet.id));
    expect([...currentById.keys()]).toStrictEqual(lintRatchets.map((ratchet) => ratchet.id));
    expect(eslintRunnerMock.sweepStaleCacheSiblings).toHaveBeenCalledTimes(lintRatchets.length * 2);
  });

  it("caps type-aware ratchets at one in flight while keeping the worker pool available", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let typeAwareInFlight = 0;
    let maxTypeAwareInFlight = 0;

    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      const typeAware = ratchet.parserProfile === "type-aware-ts";
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (typeAware) {
        typeAwareInFlight += 1;
        maxTypeAwareInFlight = Math.max(maxTypeAwareInFlight, typeAwareInFlight);
      }

      await delay(typeAware ? 20 : 5);

      if (typeAware) typeAwareInFlight -= 1;
      inFlight -= 1;
      return [];
    });

    await collectCurrentById(fixtureRuleSourceHashes(), 3);

    expect(maxInFlight).toBe(3);
    expect(maxTypeAwareInFlight).toBe(1);
  });

  it("rejects when any worker collection rejects instead of returning partial results", async () => {
    const failure = new Error("worker failed");
    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      if (ratchet.id === lintRatchets[1].id) throw failure;
      await delay(5);
      return [];
    });

    await expect(collectCurrentById(fixtureRuleSourceHashes(), 3)).rejects.toThrow(failure);
  });

  it("collects each ratchet from matched tracked files instead of raw globs", async () => {
    eslintRunnerMock.runEslintForFiles.mockResolvedValue([]);

    await collectCurrentById(fixtureRuleSourceHashes(), 1, [
      "packages/server/src/services/upload-service.ts",
      "packages/server/src/services/upload-service.test.ts",
    ]);

    const strictBooleanCall = eslintRunnerMock.runEslintForFiles.mock.calls.find((call) => {
      const ratchet = call[0] as LintRatchetConfig;
      return ratchet.id === "ratchet/strict-boolean-expressions-server-services";
    });
    expect(strictBooleanCall?.[2]).toStrictEqual([
      "packages/server/src/services/upload-service.ts",
    ]);
    expect(eslintRunnerMock.sweepStaleCacheSiblings).toHaveBeenCalled();
  });
});
