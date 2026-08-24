import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { forwardMissingMergeDriverWarning } from "@musi/lint-ratchet/git-rail/merge-driver-presence.js";
import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { z } from "zod";

import {
  defaultKnipRunner,
  KNIP_SYMBOL_INCLUDE_CATEGORIES,
  type KnipRunner,
  resolveKnipBin,
} from "./drift-ai/knip-runner.js";
import { parseKnipUnusedExports } from "./drift-ai/knip-unused-exports.js";
import { writeFileAtomicallySync } from "./lib/atomic-write.js";
import { parseCli } from "./lib/cli.js";
import {
  compareKnipUnusedExports,
  formatKnipUnusedExportsBaseline,
  formatSummaryLine,
  knipEntriesFromSymbols,
  type KnipUnusedExportEntry,
  readKnipUnusedExportsBaseline,
} from "./sensor-knip-unused-exports-baseline.js";

export {
  formatKnipUnusedExportsBaseline,
  type KnipUnusedExportEntry,
} from "./sensor-knip-unused-exports-baseline.js";

const DEFAULT_BASELINE_PATH = "sensor-knip-unused-exports.baseline.json";
const DEFAULT_CONFIG_PATH = "knip.config.ts";
const SUMMARY_DRIFT_EXIT_CODE = 4;
const CORRUPT_BASELINE_EXIT_CODE = 5;

export type RunKnipUnusedExportsCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runner?: KnipRunner;
  readonly warn?: (message: string) => void;
};

export type KnipUnusedExportsRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly entries?: readonly KnipUnusedExportEntry[];
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

const cliOptionsSchema = z.object({
  "--baseline": z.string().default(DEFAULT_BASELINE_PATH),
  "--update": z.boolean().default(false),
});

function warnIfMergeDriverMissing(options: RunKnipUnusedExportsCliOptions, cwd: string): void {
  if (options.warn === undefined) return;
  forwardMissingMergeDriverWarning({
    checkScriptPath: resolve(import.meta.dirname, "git/check-knip-unused-exports-merge-driver.sh"),
    cwd,
    env: options.env ?? {},
    warn: options.warn,
  });
}

function usage(): string {
  return [
    "Usage:",
    "  bun run sensor:knip-unused-exports",
    "  bun scripts/sensor-knip-unused-exports.ts --update",
    "  bun scripts/sensor-knip-unused-exports.ts --baseline=<path>",
    "",
    "Fails when knip's unused exported symbol identities differ from the committed baseline.",
    "Exit codes: 0 clean; 1 unclassified failure; 2 usage or transient failure; 3 stale entries; 4 summary drift; 5 corrupt or unreadable baseline.",
  ].join("\n");
}

export function runKnipUnusedExportsCli(
  options: RunKnipUnusedExportsCliOptions,
): KnipUnusedExportsRunResult {
  const parsed = parseCliOptions(options.argv);
  if (parsed.kind === "result") return parsed.result;

  const cwd = options.cwd ?? process.cwd();
  warnIfMergeDriverMissing(options, cwd);
  const baselinePath = resolve(cwd, parsed.options.baselinePath);
  const collected = collectKnipUnusedExports({
    cwd,
    ...(options.runner === undefined ? {} : { runner: options.runner }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
  if (!collected.ok) return { exitCode: 2, stdout: `ERROR: ${collected.error}` };

  if (parsed.options.update) {
    writeFileAtomicallySync(baselinePath, formatKnipUnusedExportsBaseline(collected.value));
    return {
      exitCode: 0,
      stdout: [
        `sensor:knip-unused-exports -- wrote ${displayPath(cwd, baselinePath)}`,
        formatSummaryLine("current", collected.value),
      ].join("\n"),
      entries: collected.value,
    };
  }

  const baseline = readBaseline(baselinePath);
  if (!baseline.ok) {
    return { exitCode: CORRUPT_BASELINE_EXIT_CODE, stdout: `ERROR: ${baseline.error}` };
  }

  const comparison = compareKnipUnusedExports(baseline.value, collected.value);
  const warningLines = baseline.warnings?.map((warning) => `WARN: ${warning}`) ?? [];
  return checkResult(comparison, warningLines, collected.value);
}

function checkResult(
  comparison: { readonly exitCode: number; readonly stdout: string },
  warningLines: readonly string[],
  entries: readonly KnipUnusedExportEntry[],
): KnipUnusedExportsRunResult {
  if (comparison.exitCode !== 0) {
    return {
      exitCode: comparison.exitCode,
      stdout: comparison.stdout,
      entries,
    };
  }
  if (warningLines.length > 0) {
    return {
      exitCode: SUMMARY_DRIFT_EXIT_CODE,
      stdout: [
        ...warningLines,
        comparison.stdout,
        "run: bun scripts/sensor-knip-unused-exports.ts --update",
      ].join("\n"),
      entries,
    };
  }
  return {
    exitCode: comparison.exitCode,
    stdout: comparison.stdout,
    entries,
  };
}

function readBaseline(baselinePath: string): ParseResult<readonly KnipUnusedExportEntry[]> {
  if (!existsSync(baselinePath)) {
    return {
      ok: false,
      error: `baseline missing at ${baselinePath}; run bun scripts/sensor-knip-unused-exports.ts --update`,
    };
  }
  return readKnipUnusedExportsBaseline(readFileSync(baselinePath, "utf8"));
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
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new KnipUnusedExportsCliError(message),
    allowEmptyArgs: true,
    rejectPositionals: true,
    options: [
      { name: "--baseline", kind: "value", valueErrorMessage: "--baseline requires a path." },
      { name: "--update", kind: "flag" },
    ],
    schema: cliOptionsSchema,
    onHelp: () => {
      throw new KnipUnusedExportsHelp();
    },
  });
  return {
    baselinePath: parsed.options["--baseline"],
    update: parsed.options["--update"],
  };
}

type CollectOptions = {
  readonly cwd: string;
  readonly runner?: KnipRunner;
  readonly warn?: (message: string) => void;
};

function collectKnipUnusedExports(
  options: CollectOptions,
): ParseResult<readonly KnipUnusedExportEntry[]> {
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
  return { ok: true, value: knipEntriesFromSymbols(parsed.symbols) };
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
        commandLabel: "sensor:knip-unused-exports",
        includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
        knipBin: resolution.binPath,
        warn,
      }),
    };
  }
  return {
    ok: true,
    value: defaultKnipRunner({
      analyzedRepoRoot: options.cwd,
      commandLabel: "sensor:knip-unused-exports",
      includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
      knipBin: resolution.binPath,
    }),
  };
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

function displayPath(cwd: string, absolutePath: string): string {
  const relative = absolutePath.startsWith(`${cwd}/`)
    ? absolutePath.slice(cwd.length + 1)
    : absolutePath;
  return relative.replaceAll("\\", "/");
}
