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
// ratchets plus one type-aware ratchet, so bounded concurrency (3) and
// registry-order output are observable without any Musi registry or repo
// binding. The type-aware single-flight cap is NOT observable here: a single
// type-aware ratchet cannot exceed it, so the scenario that pins the cap adds
// a second type-aware ratchet of its own.
interface FixtureRatchetInput {
  readonly id: string;
  readonly parserProfile?: "minimal-ts" | "type-aware-ts";
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
}

function fixtureRatchet(input: FixtureRatchetInput): LintRatchetConfig {
  const ratchet = {
    id: input.id,
    ruleId: "no-debugger",
    files: input.files ?? ["src/**/*.ts"],
    ignores: input.ignores ?? [],
    ruleOptions: [],
    source: { kind: "core" },
    mode: "no-new",
    metric: "message-count",
    principle: "Fixture scheduler ratchet principle.",
  } as const;
  if (input.parserProfile === "type-aware-ts") {
    return { ...ratchet, parserProfile: "type-aware-ts" };
  }
  return { ...ratchet, parserProfile: "minimal-ts" };
}

const RATCHET_A_ID = "ratchet/fixture-a";
const FAILING_RATCHET_ID = "ratchet/fixture-b";
const RATCHET_C_ID = "ratchet/fixture-c";
const TYPE_AWARE_RATCHET_ID = "ratchet/fixture-type-aware";
const RATCHET_D_ID = "ratchet/fixture-d";
const SERVICES_RATCHET_ID = "ratchet/fixture-services";

const fixtureRatchets: readonly LintRatchetConfig[] = [
  fixtureRatchet({ id: RATCHET_A_ID }),
  fixtureRatchet({ id: FAILING_RATCHET_ID }),
  fixtureRatchet({ id: RATCHET_C_ID }),
  fixtureRatchet({ id: TYPE_AWARE_RATCHET_ID, parserProfile: "type-aware-ts" }),
  fixtureRatchet({ id: RATCHET_D_ID }),
  fixtureRatchet({
    id: SERVICES_RATCHET_ID,
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

function fixtureRuleSourceHashes(
  ratchets: readonly LintRatchetConfig[] = fixtureRatchets,
): Map<string, string> {
  return new Map(ratchets.map((ratchet) => [ratchet.id, FIXTURE_RULE_SOURCE_HASH]));
}

// One named deferred per ratchet id. A mocked worker parks on its own gate and
// stays in flight until the test calls `release` or `rejectWith` for that id,
// so every scheduler transition below is caused by an explicit line in the
// test rather than by wall-clock time. The scheduler is a promise-settlement
// pump, so worker settlement is the only input it has.
interface WorkerGates {
  readonly waitFor: (id: string) => Promise<void>;
  readonly release: (id: string) => void;
  readonly rejectWith: (id: string, reason: Error) => void;
}

type WorkerGate = PromiseWithResolvers<void>;

function createWorkerGates(): WorkerGates {
  const gates = new Map<string, WorkerGate>();
  function gateFor(id: string): WorkerGate {
    const existing = gates.get(id);
    if (existing !== undefined) return existing;
    const created: WorkerGate = Promise.withResolvers();
    gates.set(id, created);
    return created;
  }
  return {
    waitFor: async (id) => {
      await gateFor(id).promise;
    },
    release: (id) => {
      gateFor(id).resolve();
    },
    rejectWith: (id, reason) => {
      gateFor(id).reject(reason);
    },
  };
}

// Releasing a gate settles a chain of promise continuations — the mocked
// worker body, the collector's per-ratchet wrapper, then the scheduler's pump —
// and every link is a microtask. Draining a fixed, generous number of turns is
// therefore "run everything that is ready": no timer is involved, so extra
// turns are free no-ops and the drain cannot be a race.
const MICROTASK_DRAIN_TURNS = 16;

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < MICROTASK_DRAIN_TURNS; turn += 1) {
    await Promise.resolve();
  }
}

describe("collectCurrentById", () => {
  afterEach(() => {
    eslintRunnerMock.runEslintForFiles.mockReset();
    eslintRunnerMock.sweepStaleCacheSiblings.mockReset();
  });

  it("runs ratchet collection with bounded concurrency while preserving registry-order output", async () => {
    const gates = createWorkerGates();
    let inFlight = 0;
    let maxInFlight = 0;
    const startedIds: string[] = [];
    const finishedIds: string[] = [];

    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      startedIds.push(ratchet.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates.waitFor(ratchet.id);
      inFlight -= 1;
      finishedIds.push(ratchet.id);
      return [];
    });

    const collection = collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: fixtureRatchets,
      binding,
      concurrency: 3,
      trackedFiles: FIXTURE_TRACKED_FILES,
    });

    // The pool fills with the first three registry entries and then stalls:
    // every worker is parked on its gate, so no fourth ratchet can start.
    await flushMicrotasks();
    expect(startedIds).toStrictEqual([RATCHET_A_ID, FAILING_RATCHET_ID, RATCHET_C_ID]);
    expect(inFlight).toBe(3);

    // Releasing out of registry order is the entire mechanism behind the
    // completion-order assertion below; each release frees exactly one slot,
    // which the scheduler refills with the next unstarted registry entry.
    gates.release(RATCHET_C_ID);
    await flushMicrotasks();
    expect(finishedIds).toStrictEqual([RATCHET_C_ID]);
    expect(startedIds.at(-1)).toBe(TYPE_AWARE_RATCHET_ID);
    expect(inFlight).toBe(3);

    gates.release(TYPE_AWARE_RATCHET_ID);
    await flushMicrotasks();
    expect(startedIds.at(-1)).toBe(RATCHET_D_ID);
    expect(inFlight).toBe(3);

    gates.release(RATCHET_A_ID);
    await flushMicrotasks();
    expect(startedIds.at(-1)).toBe(SERVICES_RATCHET_ID);
    expect(inFlight).toBe(3);

    // The registry is exhausted now, so the remaining releases only drain the
    // pool: nothing refills the freed slot.
    gates.release(FAILING_RATCHET_ID);
    await flushMicrotasks();
    expect(startedIds).toHaveLength(fixtureRatchets.length);
    expect(inFlight).toBe(2);

    gates.release(RATCHET_D_ID);
    gates.release(SERVICES_RATCHET_ID);
    const currentById = await collection;

    expect(inFlight).toBe(0);
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
    // Scenario-local registry: the shared fixtures plus a second type-aware
    // entry. The single-flight cap is unobservable against a registry with
    // only one type-aware ratchet, and appending the extra entry here rather
    // than to the shared list leaves the other scenarios' registry-order,
    // maxInFlight, and sweep-count assertions untouched.
    const SECOND_TYPE_AWARE_RATCHET_ID = "ratchet/fixture-type-aware-second";
    const typeAwareFixtureRatchets: readonly LintRatchetConfig[] = [
      ...fixtureRatchets,
      fixtureRatchet({ id: SECOND_TYPE_AWARE_RATCHET_ID, parserProfile: "type-aware-ts" }),
    ];
    const gates = createWorkerGates();
    let inFlight = 0;
    let maxInFlight = 0;
    let typeAwareInFlight = 0;
    let maxTypeAwareInFlight = 0;
    const startedIds: string[] = [];

    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      const typeAware = ratchet.parserProfile === "type-aware-ts";
      startedIds.push(ratchet.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (typeAware) {
        typeAwareInFlight += 1;
        maxTypeAwareInFlight = Math.max(maxTypeAwareInFlight, typeAwareInFlight);
      }

      await gates.waitFor(ratchet.id);

      if (typeAware) typeAwareInFlight -= 1;
      inFlight -= 1;
      return [];
    });

    const collection = collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(typeAwareFixtureRatchets),
      ratchets: typeAwareFixtureRatchets,
      binding,
      concurrency: 3,
      trackedFiles: FIXTURE_TRACKED_FILES,
    });

    await flushMicrotasks();
    expect(startedIds).toStrictEqual([RATCHET_A_ID, FAILING_RATCHET_ID, RATCHET_C_ID]);

    // Free a slot so the first type-aware ratchet takes it, then hold it: the
    // pool must stay usable for the minimal-TS entries behind it.
    gates.release(RATCHET_C_ID);
    await flushMicrotasks();
    expect(startedIds.at(-1)).toBe(TYPE_AWARE_RATCHET_ID);
    expect(typeAwareInFlight).toBe(1);

    gates.release(RATCHET_A_ID);
    gates.release(FAILING_RATCHET_ID);
    await flushMicrotasks();
    expect(startedIds.at(-1)).toBe(SERVICES_RATCHET_ID);
    expect(inFlight).toBe(3);

    // With the first type-aware ratchet still held, the second one is the only
    // unstarted entry left — and the scheduler must leave the freed slot empty
    // rather than run two type-aware ratchets at once.
    gates.release(RATCHET_D_ID);
    await flushMicrotasks();
    expect(startedIds).not.toContain(SECOND_TYPE_AWARE_RATCHET_ID);
    expect(inFlight).toBe(2);

    // Releasing the first type-aware ratchet is what admits the second.
    gates.release(TYPE_AWARE_RATCHET_ID);
    await flushMicrotasks();
    expect(startedIds.at(-1)).toBe(SECOND_TYPE_AWARE_RATCHET_ID);
    expect(typeAwareInFlight).toBe(1);

    gates.release(SERVICES_RATCHET_ID);
    gates.release(SECOND_TYPE_AWARE_RATCHET_ID);
    await collection;

    expect(startedIds).toHaveLength(typeAwareFixtureRatchets.length);
    expect(maxInFlight).toBe(3);
    expect(maxTypeAwareInFlight).toBe(1);
  });

  it("rejects when any worker collection rejects instead of returning partial results", async () => {
    const gates = createWorkerGates();
    const failure = new Error("worker failed");
    const startedIds: string[] = [];
    const finishedIds: string[] = [];

    eslintRunnerMock.runEslintForFiles.mockImplementation(async (ratchet: LintRatchetConfig) => {
      startedIds.push(ratchet.id);
      await gates.waitFor(ratchet.id);
      finishedIds.push(ratchet.id);
      return [];
    });

    const collection = collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: fixtureRatchets,
      binding,
      concurrency: 3,
      trackedFiles: FIXTURE_TRACKED_FILES,
    });

    await flushMicrotasks();
    expect(startedIds).toStrictEqual([RATCHET_A_ID, FAILING_RATCHET_ID, RATCHET_C_ID]);

    // Reject one worker while both of its siblings are still parked on their
    // gates: the collection must fail immediately instead of waiting for them
    // or returning what has completed so far.
    gates.rejectWith(FAILING_RATCHET_ID, failure);
    await expect(collection).rejects.toThrow(failure);

    // Release the healthy workers so nothing is left pending. Their late
    // completions must not restart the pool after the fail-fast.
    gates.release(RATCHET_A_ID);
    gates.release(RATCHET_C_ID);
    await flushMicrotasks();
    expect(finishedIds).toStrictEqual([RATCHET_A_ID, RATCHET_C_ID]);
    expect(startedIds).toStrictEqual([RATCHET_A_ID, FAILING_RATCHET_ID, RATCHET_C_ID]);
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
