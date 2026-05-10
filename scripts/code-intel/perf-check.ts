#!/usr/bin/env bun
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { performance } from "node:perf_hooks";

import { runServerCliCommand } from "./server-cli.js";

type QuerySpec = {
  args: string[];
  label: string;
};

type TimingSample = {
  label: string;
  ms: number;
};

type TimingStats = {
  p50: number;
  p95: number;
};

const PERCENTILE_BASE = 100;
const P50_PERCENTILE = 50;
const P95_PERCENTILE = 95;
const QUERY_MIX: QuerySpec[] = [
  {
    args: ["def", "--name", "characterDetailSchema"],
    label: "def --name characterDetailSchema",
  },
  {
    args: [
      "dependents",
      "packages/shared/src/schemas/character.ts",
      "--depth",
      "1",
      "--limit",
      "20",
    ],
    label: "dependents character schema",
  },
  {
    args: [
      "tests",
      "packages/server/src/services/level-up/level-up.ts",
      "--direct",
      "--limit",
      "20",
    ],
    label: "tests level-up direct",
  },
];

async function main(): Promise<void> {
  const initialStatus = await runServerCliCommand(["status"]);
  const initialDaemonRunning = isRunningStatus(initialStatus.output);
  let daemonStartedForWarmRun = false;

  try {
    await serverCommand(["stop"]);
    const coldSamples = runTimedMix();

    await serverCommand(["restart"]);
    daemonStartedForWarmRun = true;
    runUntimedMix();
    const warmSamples = runTimedMix();

    printReport(coldSamples, warmSamples);
  } finally {
    if (initialDaemonRunning && !daemonStartedForWarmRun) {
      await serverCommand(["restart"]);
    }
    if (!initialDaemonRunning) {
      await serverCommand(["stop"]);
    }
  }
}

function isRunningStatus(output: string): boolean {
  return output.startsWith("code-intel daemon: running ");
}

async function serverCommand(args: string[]): Promise<void> {
  const result = await runServerCliCommand(args);
  if (result.exitCode !== 0) {
    throw new Error(result.output);
  }
}

function runUntimedMix(): void {
  for (const query of QUERY_MIX) {
    runCodeIntel(query);
  }
}

function runTimedMix(): TimingSample[] {
  return QUERY_MIX.map((query) => {
    const start = performance.now();
    runCodeIntel(query);
    return { label: query.label, ms: performance.now() - start };
  });
}

function runCodeIntel(query: QuerySpec): void {
  const result: SpawnSyncReturns<string> = spawnSync(
    "bun",
    ["run", "code:intel", "--", ...query.args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.error) throw result.error;
  if (result.status === 0) return;

  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  const suffix = details.length > 0 ? `\n${details}` : "";
  throw new Error(
    `code:intel perf query failed (${query.label}) with exit ${String(result.status)}.${suffix}`,
  );
}

function printReport(coldSamples: TimingSample[], warmSamples: TimingSample[]): void {
  console.log("code:intel perf check (advisory)");
  console.log(
    "daemon policy: opt-in only; cold uses one-shot, warm uses a manually started daemon",
  );
  printPhase("cold one-shot", coldSamples);
  printPhase("warm daemon", warmSamples);
  console.log("No thresholds are enforced by this command.");
}

function printPhase(label: string, samples: TimingSample[]): void {
  const stats = summarize(samples);
  console.log(`${label}: p50 ${formatMs(stats.p50)}, p95 ${formatMs(stats.p95)}`);
  for (const sample of samples) {
    console.log(`  ${formatMs(sample.ms)} ${sample.label}`);
  }
}

function summarize(samples: TimingSample[]): TimingStats {
  const values = samples.map((sample) => sample.ms);
  return {
    p50: percentile(values, P50_PERCENTILE),
    p95: percentile(values, P95_PERCENTILE),
  };
}

function percentile(values: number[], rank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((rank / PERCENTILE_BASE) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function formatMs(value: number): string {
  return `${Math.round(value).toString()}ms`;
}

await main();
