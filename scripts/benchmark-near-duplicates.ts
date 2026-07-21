#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  decideNearDuplicatesBudget,
  type NearDuplicatesMeasurement,
  summarizeNearDuplicatesMeasurements,
} from "./benchmark-near-duplicates-core.js";
import { loadDriftAiConfig } from "./drift-ai/config.js";
import { findNearDuplicatePairs, NEAR_DUPLICATE_TOOL } from "./drift-ai/near-duplicates.js";
import { nearDuplicateExcludeGlobs } from "./drift-ai/near-duplicates-check-config.js";
import {
  findExactFunctionClonePairs,
  markFuzzyOccurrencePairs,
  unionNearDuplicateOccurrencePairs,
} from "./drift-ai/near-duplicates-exact.js";
import { defaultNearDuplicateRunner } from "./drift-ai/near-duplicates-runner.js";
import { buildSourceExtensions } from "./drift-ai/scope.js";
import { nearDuplicateEntriesFromPairs } from "./sensor-near-duplicates-baseline.js";

const DEFAULT_SAMPLE_COUNT = 5;
const RSS_POLL_INTERVAL_MS = 25;
const WORKER_FLAG = "--worker";
const MILLISECONDS_PER_SECOND = 1_000;
const EXPECTED_OPTION_ARGUMENTS = 2;
const ODD_DIVISOR = 2;
const USER_ARGUMENT_START = 2;
const JSON_INDENT = 2;

type BenchmarkState = "fuzzy" | "fuzzy-exact";

type WorkerAudit = {
  readonly state: BenchmarkState;
  readonly functionCount: number;
  readonly tokenizedFunctionCount: number;
  readonly fuzzyPairs: number;
  readonly exactPairs: number;
  readonly unionPairs: number;
  readonly newBaselineIdentities: number;
  readonly exactAudit?: {
    readonly eligibleFunctions: number;
    readonly hashBuckets: number;
    readonly maximumRawHashBucketSize: number;
    readonly maximumEqualityGroupSize: number;
    readonly projectedPairs: number;
    readonly postOverlapPairs: number;
  };
};

type WorkerCounts = Pick<
  WorkerAudit,
  | "functionCount"
  | "tokenizedFunctionCount"
  | "fuzzyPairs"
  | "exactPairs"
  | "unionPairs"
  | "newBaselineIdentities"
>;

type SampledRun = NearDuplicatesMeasurement & { readonly audit: WorkerAudit };

type StateMeasurements = {
  readonly fresh: readonly SampledRun[];
  readonly repeat: readonly SampledRun[];
};

function collectWorkerAudit(cwd: string, state: BenchmarkState): WorkerAudit {
  const config = loadDriftAiConfig({ repoRoot: cwd }).config;
  const nearConfig = config.checks["near-duplicates"];
  const result = defaultNearDuplicateRunner()({
    repoRoot: cwd,
    roots: config.roots,
    sourceExtensions: buildSourceExtensions(config.additionalSourceExtensions),
    ignore: config.ignore,
    excludeGlobs: nearDuplicateExcludeGlobs(config.ignore, nearConfig),
    engine: NEAR_DUPLICATE_TOOL,
    minLines: nearConfig.minLines,
    minTokens: nearConfig.minTokens,
    similarityThreshold: nearConfig.similarityThreshold,
    includeExactTokens: state === "fuzzy-exact",
  });
  if (!result.ok) throw new Error(result.error);
  if (result.engine !== NEAR_DUPLICATE_TOOL) throw new Error("benchmark requires ts-morph");
  const fuzzy = findNearDuplicatePairs(result.functions, nearConfig);
  if (state === "fuzzy") {
    return {
      state,
      functionCount: result.functions.length,
      tokenizedFunctionCount: 0,
      fuzzyPairs: fuzzy.length,
      exactPairs: 0,
      unionPairs: fuzzy.length,
      newBaselineIdentities: 0,
    };
  }
  const exact = findExactFunctionClonePairs(result.functions);
  if (!exact.ok) throw new Error(exact.error);
  const union = unionNearDuplicateOccurrencePairs(markFuzzyOccurrencePairs(fuzzy), exact.pairs);
  const fuzzyKeys = new Set(nearDuplicateEntriesFromPairs(fuzzy).map((entry) => entry.key));
  const unionKeys = new Set(nearDuplicateEntriesFromPairs(union).map((entry) => entry.key));
  return {
    state,
    functionCount: result.functions.length,
    tokenizedFunctionCount: result.functions.filter((item) => item.exactTokens.length > 0).length,
    fuzzyPairs: fuzzy.length,
    exactPairs: exact.pairs.length,
    unionPairs: union.length,
    newBaselineIdentities: [...unionKeys].filter((key) => !fuzzyKeys.has(key)).length,
    exactAudit: exact.audit,
  };
}

function processTreeRssKiB(rootPid: number): number {
  const output = execFileSync("ps", ["-e", "-o", "pid=,ppid=,rss="], { encoding: "utf8" });
  const rows = output.split(/\r?\n/u).flatMap((line) => {
    const [pidText, parentText, rssText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const parentPid = Number(parentText);
    const rssKiB = Number(rssText);
    return Number.isInteger(pid) && Number.isInteger(parentPid) && Number.isFinite(rssKiB)
      ? [{ pid, parentPid, rssKiB }]
      : [];
  });
  const tree = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (tree.has(row.parentPid) && !tree.has(row.pid)) {
        tree.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.reduce((total, row) => total + (tree.has(row.pid) ? row.rssKiB : 0), 0);
}

async function sampleWorker(cwd: string, state: BenchmarkState): Promise<SampledRun> {
  const started = performance.now();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), WORKER_FLAG, state], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  let peakRssKiB = processTreeRssKiB(child.pid ?? -1);
  const poller = setInterval(() => {
    peakRssKiB = Math.max(peakRssKiB, processTreeRssKiB(child.pid ?? -1));
  }, RSS_POLL_INTERVAL_MS);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearInterval(poller);
  if (exitCode !== 0) {
    throw new Error(`benchmark ${state} worker failed (${String(exitCode)}): ${stderr.trim()}`);
  }
  return {
    wallSeconds: (performance.now() - started) / MILLISECONDS_PER_SECOND,
    peakRssKiB,
    audit: parseWorkerAudit(stdout),
  };
}

function parseWorkerAudit(stdout: string): WorkerAudit {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || (parsed.state !== "fuzzy" && parsed.state !== "fuzzy-exact")) {
    throw new Error("benchmark worker returned invalid JSON");
  }
  if (!hasWorkerCounts(parsed)) {
    throw new Error("benchmark worker returned invalid counts");
  }
  return {
    state: parsed.state,
    functionCount: parsed.functionCount,
    tokenizedFunctionCount: parsed.tokenizedFunctionCount,
    fuzzyPairs: parsed.fuzzyPairs,
    exactPairs: parsed.exactPairs,
    unionPairs: parsed.unionPairs,
    newBaselineIdentities: parsed.newBaselineIdentities,
    ...(isExactAudit(parsed.exactAudit) ? { exactAudit: parsed.exactAudit } : {}),
  };
}

function hasWorkerCounts(
  value: Record<string, unknown>,
): value is Record<string, unknown> & WorkerCounts {
  return (
    typeof value.functionCount === "number" &&
    typeof value.tokenizedFunctionCount === "number" &&
    typeof value.fuzzyPairs === "number" &&
    typeof value.exactPairs === "number" &&
    typeof value.unionPairs === "number" &&
    typeof value.newBaselineIdentities === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactAudit(value: unknown): value is NonNullable<WorkerAudit["exactAudit"]> {
  if (!isRecord(value)) return false;
  return [
    "eligibleFunctions",
    "hashBuckets",
    "maximumRawHashBucketSize",
    "maximumEqualityGroupSize",
    "projectedPairs",
    "postOverlapPairs",
  ].every((key) => typeof value[key] === "number");
}

async function measureState(
  cwd: string,
  state: BenchmarkState,
  sampleCount: number,
): Promise<StateMeasurements> {
  const fresh: SampledRun[] = [];
  const repeat: SampledRun[] = [];
  for (let index = 0; index < sampleCount; index += 1) fresh.push(await sampleWorker(cwd, state));
  for (let index = 0; index < sampleCount; index += 1) repeat.push(await sampleWorker(cwd, state));
  return { fresh, repeat };
}

function parseSampleCount(argv: readonly string[]): number {
  if (argv.length === 0) return DEFAULT_SAMPLE_COUNT;
  if (argv.length !== EXPECTED_OPTION_ARGUMENTS || argv[0] !== "--samples") {
    throw new Error(
      "usage: bun scripts/benchmark-near-duplicates.ts [--samples <positive odd integer>]",
    );
  }
  const count = Number(argv[1]);
  if (!Number.isInteger(count) || count < 1 || count % ODD_DIVISOR === 0) {
    throw new Error("--samples must be a positive odd integer");
  }
  return count;
}

async function runBenchmark(argv: readonly string[]): Promise<void> {
  const sampleCount = parseSampleCount(argv);
  const cwd = process.cwd();
  const fuzzy = await measureState(cwd, "fuzzy", sampleCount);
  const fuzzyExact = await measureState(cwd, "fuzzy-exact", sampleCount);
  const fuzzyWarm = summarizeNearDuplicatesMeasurements(fuzzy.repeat);
  const exactWarm = summarizeNearDuplicatesMeasurements(fuzzyExact.repeat);
  const budget = decideNearDuplicatesBudget({
    fuzzyMedianWallSeconds: fuzzyWarm.medianWallSeconds,
    exactMedianWallSeconds: exactWarm.medianWallSeconds,
    totalMedianWallSeconds: exactWarm.medianWallSeconds,
  });
  console.log(
    JSON.stringify(
      {
        command: `bun scripts/benchmark-near-duplicates.ts --samples ${String(sampleCount)}`,
        samples: sampleCount,
        rssPollIntervalMs: RSS_POLL_INTERVAL_MS,
        fuzzy: reportState(fuzzy),
        fuzzyExact: reportState(fuzzyExact),
        budget,
        audit: fuzzyExact.repeat.at(-1)?.audit,
      },
      null,
      JSON_INDENT,
    ),
  );
}

function reportState(measurements: StateMeasurements): object {
  return {
    fresh: measurements.fresh.map(({ wallSeconds, peakRssKiB }) => ({
      wallSeconds,
      peakRssKiB,
    })),
    repeat: measurements.repeat.map(({ wallSeconds, peakRssKiB }) => ({
      wallSeconds,
      peakRssKiB,
    })),
    freshMedian: summarizeNearDuplicatesMeasurements(measurements.fresh),
    repeatMedian: summarizeNearDuplicatesMeasurements(measurements.repeat),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(USER_ARGUMENT_START);
  if (argv[0] === WORKER_FLAG) {
    const state = argv[1];
    if (state !== "fuzzy" && state !== "fuzzy-exact") {
      throw new Error("benchmark worker state must be fuzzy or fuzzy-exact");
    }
    console.log(JSON.stringify(collectWorkerAudit(process.cwd(), state)));
  } else {
    await runBenchmark(argv);
  }
}
