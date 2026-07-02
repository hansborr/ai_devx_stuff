import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  defaultKnipRunner,
  KNIP_SYMBOL_INCLUDE_CATEGORIES,
  type KnipRunner,
  resolveKnipBin,
} from "./drift-ai/knip-runner.js";
import {
  parseKnipUnusedExports,
  type UnusedExportCategory,
} from "./drift-ai/knip-unused-exports.js";
import {
  compareKnipUnusedExportsSnapshots,
  formatKnipUnusedExportsBaseline,
  formatSnapshotLine,
  type KnipUnusedExportsSnapshot,
  type ParseResult,
  readKnipUnusedExportsBaseline,
  zeroKnipUnusedExportsCounts,
} from "./sensor-knip-unused-exports-baseline.js";

export {
  formatKnipUnusedExportsBaseline,
  type KnipUnusedExportsCategoryCounts,
  type KnipUnusedExportsSnapshot,
} from "./sensor-knip-unused-exports-baseline.js";

const DEFAULT_BASELINE_PATH = "sensor-knip-unused-exports.baseline.json";
const DEFAULT_CONFIG_PATH = "knip.config.ts";
const HELP_FLAGS = new Set(["--help", "-h"]);

export type RunKnipUnusedExportsCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly runner?: KnipRunner;
  readonly warn?: (message: string) => void;
};

export type KnipUnusedExportsRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly snapshot?: KnipUnusedExportsSnapshot;
};

type CliOptions = {
  readonly baselinePath: string;
  readonly update: boolean;
};

type ParsedCliOptions =
  | { readonly kind: "options"; readonly options: CliOptions }
  | { readonly kind: "result"; readonly result: KnipUnusedExportsRunResult };

class KnipUnusedExportsHelp extends Error {
  constructor() {
    super(usage());
    this.name = "KnipUnusedExportsHelp";
  }
}

class KnipUnusedExportsCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnipUnusedExportsCliError";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun run sensor:knip-unused-exports",
    "  bun scripts/sensor-knip-unused-exports.ts --update",
    "  bun scripts/sensor-knip-unused-exports.ts --baseline=<path>",
    "",
    "Fails when knip's unused exported symbol count grows above the committed baseline.",
  ].join("\n");
}

export function runKnipUnusedExportsCli(
  options: RunKnipUnusedExportsCliOptions,
): KnipUnusedExportsRunResult {
  const parsed = parseCliOptions(options.argv);
  if (parsed.kind === "result") return parsed.result;

  const cwd = options.cwd ?? process.cwd();
  const baselinePath = resolve(cwd, parsed.options.baselinePath);
  const collected = collectKnipUnusedExports({
    cwd,
    ...(options.runner === undefined ? {} : { runner: options.runner }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
  if (!collected.ok) return { exitCode: 2, stdout: `ERROR: ${collected.error}` };

  if (parsed.options.update) {
    writeFileSync(baselinePath, formatKnipUnusedExportsBaseline(collected.value));
    return {
      exitCode: 0,
      stdout: [
        `sensor:knip-unused-exports -- wrote ${displayPath(cwd, baselinePath)}`,
        formatSnapshotLine("current", collected.value),
      ].join("\n"),
      snapshot: collected.value,
    };
  }

  const baseline = readKnipUnusedExportsBaseline(baselinePath);
  if (!baseline.ok) return { exitCode: 2, stdout: `ERROR: ${baseline.error}` };

  const comparison = compareKnipUnusedExportsSnapshots(baseline.value, collected.value);
  return {
    exitCode: comparison.exitCode,
    stdout: comparison.stdout,
    snapshot: collected.value,
  };
}

function parseCliOptions(argv: readonly string[]): ParsedCliOptions {
  try {
    return { kind: "options", options: parseArgs(argv) };
  } catch (err) {
    if (err instanceof KnipUnusedExportsHelp) {
      return { kind: "result", result: { exitCode: 0, stdout: err.message } };
    }
    if (err instanceof KnipUnusedExportsCliError) {
      return { kind: "result", result: { exitCode: 2, stdout: `ERROR: ${err.message}` } };
    }
    throw err;
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  let baselinePath = DEFAULT_BASELINE_PATH;
  let update = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (HELP_FLAGS.has(arg)) throw new KnipUnusedExportsHelp();
    if (arg === "--update") {
      update = true;
      continue;
    }
    if (arg === "--baseline") {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new KnipUnusedExportsCliError("--baseline requires a path.");
      }
      baselinePath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      baselinePath = arg.slice("--baseline=".length);
      if (baselinePath.length === 0) {
        throw new KnipUnusedExportsCliError("--baseline requires a path.");
      }
      continue;
    }
    throw new KnipUnusedExportsCliError(`Unknown argument: ${arg}\n${usage()}`);
  }

  return { baselinePath, update };
}

type CollectOptions = {
  readonly cwd: string;
  readonly runner?: KnipRunner;
  readonly warn?: (message: string) => void;
};

function collectKnipUnusedExports(options: CollectOptions): ParseResult<KnipUnusedExportsSnapshot> {
  const runnerResult = resolveRunner(options);
  if (!runnerResult.ok) return runnerResult;

  const configPath = existsSync(join(options.cwd, DEFAULT_CONFIG_PATH))
    ? DEFAULT_CONFIG_PATH
    : null;
  const result = runnerResult.value({ configPath });
  if (!result.ok) return { ok: false, error: formatKnipRunFailure(result) };

  const parsed = parseKnipUnusedExports(result.reportJson);
  if (!parsed.ok) {
    return { ok: false, error: `knip JSON could not be parsed: ${parsed.error}` };
  }
  return { ok: true, value: snapshotFromSymbols(parsed.symbols) };
}

function resolveRunner(options: CollectOptions): ParseResult<KnipRunner> {
  if (options.runner !== undefined) return { ok: true, value: options.runner };
  const resolution = resolveKnipBin({ analyzedRepoRoot: options.cwd });
  if (!resolution.found) {
    return {
      ok: false,
      error: `knip executable not found; searched ${resolution.searched.join(", ")}`,
    };
  }
  if (options.warn !== undefined) {
    const warn = options.warn;
    return {
      ok: true,
      value: defaultKnipRunner({
        analyzedRepoRoot: options.cwd,
        includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
        knipBin: resolution.binPath,
        warn: (message) => {
          warn(formatRunnerWarning(message));
        },
      }),
    };
  }
  return {
    ok: true,
    value: defaultKnipRunner({
      analyzedRepoRoot: options.cwd,
      includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
      knipBin: resolution.binPath,
    }),
  };
}

function formatRunnerWarning(message: string): string {
  return message.replace(/^drift:ai:/u, "sensor:knip-unused-exports:");
}

function formatKnipRunFailure(
  result: Exclude<ReturnType<KnipRunner>, { readonly ok: true }>,
): string {
  switch (result.reason) {
    case "timeout":
      return `knip timeout: ${result.error}`;
    case "tool-unavailable":
      return `knip executable unavailable: ${result.error}`;
    case "spawn-failed":
      return `knip subprocess failed: ${result.error}`;
  }
}

function snapshotFromSymbols(
  symbols: readonly { readonly category: UnusedExportCategory }[],
): KnipUnusedExportsSnapshot {
  const categories = zeroKnipUnusedExportsCounts();
  for (const symbol of symbols) categories[symbol.category] += 1;
  return {
    count:
      categories.exports + categories.types + categories.enumMembers + categories.namespaceMembers,
    categories,
  };
}

function displayPath(cwd: string, absolutePath: string): string {
  const relative = absolutePath.startsWith(`${cwd}/`)
    ? absolutePath.slice(cwd.length + 1)
    : absolutePath;
  return relative.replaceAll("\\", "/");
}
