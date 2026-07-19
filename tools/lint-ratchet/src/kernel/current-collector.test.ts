import { afterEach, describe, expect, it, vi } from "vitest";

import type { LintRatchetConfig } from "./config-types.js";
import { collectCurrentById } from "./current-collector.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";

const eslintRunnerMock = vi.hoisted(() => ({
  runEslintForFiles: vi.fn(),
  sweepStaleCacheSiblings: vi.fn(),
}));

vi.mock("./eslint-runner.js", () => eslintRunnerMock);

const FIXTURE_RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;

// A synthetic registry sized to exercise the scheduler: five minimal-TS core
// ratchets plus one type-aware ratchet, so bounded concurrency (3), the
// type-aware single-flight cap, and registry-order output are all observable
// without any Musi registry or repo binding.
interface FixtureRatchetInput {
  readonly id: string;
  readonly parserProfile?: "minimal-ts" | "type-aware-ts";
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
}

function fixtureRatchet(input: FixtureRatchetInput): LintRatchetConfig {
  return {
    id: input.id,
    ruleId: "no-debugger",
    files: input.files ?? ["src/**/*.ts"],
    ignores: input.ignores ?? [],
    ruleOptions: [],
    source: { kind: "core" },
    parserProfile: input.parserProfile ?? "minimal-ts",
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    principle: "Fixture scheduler ratchet principle.",
  };
}

const FAILING_RATCHET_ID = "ratchet/fixture-b";
const fixtureRatchets: readonly LintRatchetConfig[] = [
  fixtureRatchet({ id: "ratchet/fixture-a" }),
  fixtureRatchet({ id: FAILING_RATCHET_ID }),
  fixtureRatchet({ id: "ratchet/fixture-c" }),
  fixtureRatchet({ id: "ratchet/fixture-type-aware", parserProfile: "type-aware-ts" }),
  fixtureRatchet({ id: "ratchet/fixture-d" }),
  fixtureRatchet({
    id: "ratchet/fixture-services",
    files: ["src/services/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
  }),
];

const binding: LintRatchetEngineBinding = {
  repoRoot: "/lint-ratchet-fixture",
  thirdPartyPluginAllowlist: [],
};

// Hermetic tracked files for the scheduler tests: with trackedFiles supplied
// the collector never shells out to git in the synthetic repo root.
const FIXTURE_TRACKED_FILES: readonly string[] = ["src/a.ts"];

function fixtureRuleSourceHashes(): Map<string, string> {
  return new Map(fixtureRatchets.map((ratchet) => [ratchet.id, FIXTURE_RULE_SOURCE_HASH]));
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
      const ratchetIndex = fixtureRatchets.findIndex((entry) => entry.id === ratchet.id);
      await delay((fixtureRatchets.length - ratchetIndex) * 2);
      inFlight -= 1;
      finishedIds.push(ratchet.id);
      return [];
    });

    const currentById = await collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: fixtureRatchets,
      binding,
      concurrency: 3,
      trackedFiles: FIXTURE_TRACKED_FILES,
    });

    expect(maxInFlight).toBe(3);
    expect(startedIds.slice(0, 3)).toStrictEqual(
      fixtureRatchets.slice(0, 3).map((ratchet) => ratchet.id),
    );
    expect(finishedIds).not.toStrictEqual(fixtureRatchets.map((ratchet) => ratchet.id));
    expect([...currentById.keys()]).toStrictEqual(fixtureRatchets.map((ratchet) => ratchet.id));
    expect(eslintRunnerMock.sweepStaleCacheSiblings).toHaveBeenCalledTimes(
      fixtureRatchets.length * 2,
    );
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

    await collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: fixtureRatchets,
      binding,
      concurrency: 3,
      trackedFiles: FIXTURE_TRACKED_FILES,
    });

    expect(maxInFlight).toBe(3);
    expect(maxTypeAwareInFlight).toBe(1);
  });

  it("rejects when any worker collection rejects instead of returning partial results", async () => {
    const failure = new Error("worker failed");
    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      if (ratchet.id === FAILING_RATCHET_ID) throw failure;
      await delay(5);
      return [];
    });

    await expect(
      collectCurrentById({
        ruleSourceHashesById: fixtureRuleSourceHashes(),
        ratchets: fixtureRatchets,
        binding,
        concurrency: 3,
        trackedFiles: FIXTURE_TRACKED_FILES,
      }),
    ).rejects.toThrow(failure);
  });

  it("collects each ratchet from matched tracked files instead of raw globs", async () => {
    eslintRunnerMock.runEslintForFiles.mockResolvedValue([]);

    await collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: fixtureRatchets,
      binding,
      concurrency: 1,
      trackedFiles: ["src/services/upload-service.ts", "src/services/upload-service.test.ts"],
    });

    const servicesCall = eslintRunnerMock.runEslintForFiles.mock.calls.find((call) => {
      const ratchet = call[0] as LintRatchetConfig;
      return ratchet.id === "ratchet/fixture-services";
    });
    expect(servicesCall?.[2]).toStrictEqual(["src/services/upload-service.ts"]);
    expect(eslintRunnerMock.sweepStaleCacheSiblings).toHaveBeenCalled();
  });
});
