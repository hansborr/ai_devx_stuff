import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { gateEntries, type GateResult } from "@musi/lint-ratchet/kernel/gate.js";

import { loadDriftAiConfig } from "./drift-ai/config.js";
import { findNearDuplicatePairs, NEAR_DUPLICATE_TOOL } from "./drift-ai/near-duplicates.js";
import { nearDuplicateExcludeGlobs } from "./drift-ai/near-duplicates-check-config.js";
import {
  defaultNearDuplicateRunner,
  type NearDuplicateRunner,
} from "./drift-ai/near-duplicates-runner.js";
import { buildSourceExtensions } from "./drift-ai/scope.js";
import { writeFileAtomicallySync } from "./lib/atomic-write.js";
import {
  formatNearDuplicatesBaseline,
  type NearDuplicateBaselineEntry,
  nearDuplicateEntriesFromPairs,
  preserveNearDuplicateAdmissionReasons,
} from "./sensor-near-duplicates-baseline.js";
import {
  resolveNearDuplicatesMergeTruth,
  scopedNearDuplicateEntries,
} from "./sensor-near-duplicates-baseline-gate.js";
import {
  readHeadNearDuplicatesBaseline,
  readNearDuplicatesBaselineFile,
} from "./sensor-near-duplicates-baseline-io.js";
import {
  isNearDuplicatesHelpFlag,
  type NearDuplicatesCliOptions,
  parseNearDuplicatesArgs,
} from "./sensor-near-duplicates-cli-options.js";

const CLI_ERROR_EXIT_CODE = 2;

export type RunNearDuplicatesCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly changedFiles?: readonly string[];
  readonly runner?: NearDuplicateRunner;
};

export type NearDuplicatesRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly entries?: readonly NearDuplicateBaselineEntry[];
};

function collectNearDuplicates(
  cwd: string,
  runner: NearDuplicateRunner,
): ParseResult<readonly NearDuplicateBaselineEntry[]> {
  try {
    const config = loadDriftAiConfig({ repoRoot: cwd }).config;
    const nearConfig = config.checks["near-duplicates"];
    const result = runner({
      repoRoot: cwd,
      roots: config.roots,
      sourceExtensions: buildSourceExtensions(config.additionalSourceExtensions),
      ignore: config.ignore,
      excludeGlobs: nearDuplicateExcludeGlobs(config.ignore, nearConfig),
      engine: NEAR_DUPLICATE_TOOL,
      minLines: nearConfig.minLines,
      minTokens: nearConfig.minTokens,
      similarityThreshold: nearConfig.similarityThreshold,
      includeExactTokens: false,
    });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.engine !== NEAR_DUPLICATE_TOOL) {
      return { ok: false, error: `gate requires the ${NEAR_DUPLICATE_TOOL} engine` };
    }
    const pairs = findNearDuplicatePairs(result.functions, {
      minLines: nearConfig.minLines,
      minTokens: nearConfig.minTokens,
      similarityThreshold: nearConfig.similarityThreshold,
      tokenBandRatio: nearConfig.tokenBandRatio,
    });
    return { ok: true, value: nearDuplicateEntriesFromPairs(pairs) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function stagedFiles(cwd: string): ParseResult<readonly string[]> {
  try {
    const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd,
      encoding: "utf8",
    });
    return { ok: true, value: output.split(/\r?\n/u).filter((path) => path.length > 0) };
  } catch (error) {
    return {
      ok: false,
      error: `could not read staged files: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function regressions(gate: GateResult): readonly string[] {
  return [...gate.added, ...gate.increased];
}

function checkOutput(
  baseline: readonly NearDuplicateBaselineEntry[],
  current: readonly NearDuplicateBaselineEntry[],
): NearDuplicatesRunResult {
  const gate = gateEntries(baseline, current);
  const added = regressions(gate);
  if (added.length > 0) {
    return {
      exitCode: 1,
      stdout: [
        `FAIL: near-duplicate function pairs added ${String(added.length)} new or increased identities`,
        ...added.map((key) => `  + ${key}`),
        "Extract the shared decision flow or remove the new clone; the committed floor cannot grow.",
      ].join("\n"),
      entries: current,
    };
  }
  return {
    exitCode: 0,
    stdout: `OK: staged near-duplicate pairs match the committed no-new floor (${String(current.length)} touched identities)`,
    entries: current,
  };
}

function updateResult(
  baselinePath: string,
  committedBaseline: readonly NearDuplicateBaselineEntry[],
  current: readonly NearDuplicateBaselineEntry[],
): NearDuplicatesRunResult {
  const gate = gateEntries(committedBaseline, current);
  const added = regressions(gate);
  if (added.length > 0) {
    return {
      exitCode: 1,
      stdout: [
        "FAIL: refusing to increase the committed baseline with new near-duplicate debt",
        ...added.map((key) => `  + ${key}`),
      ].join("\n"),
      entries: current,
    };
  }
  const preserved = preserveNearDuplicateAdmissionReasons(current, committedBaseline);
  writeFileAtomicallySync(baselinePath, formatNearDuplicatesBaseline(preserved));
  return {
    exitCode: 0,
    stdout: `sensor:near-duplicates -- wrote ${baselinePath}`,
    entries: preserved,
  };
}

function admissionResult(
  baselinePath: string,
  baseline: readonly NearDuplicateBaselineEntry[],
  current: readonly NearDuplicateBaselineEntry[],
  admission: NonNullable<NearDuplicatesCliOptions["admission"]>,
): NearDuplicatesRunResult {
  const gate = gateEntries(baseline, current);
  if (!gate.added.includes(admission.identity)) {
    return {
      exitCode: 1,
      stdout: `FAIL: --admit identity is not newly detected: ${admission.identity}`,
      entries: current,
    };
  }
  const baselineByKey = new Map(baseline.map((entry) => [entry.key, entry]));
  const blocked = new Set(regressions(gate).filter((key) => key !== admission.identity));
  const admitted = current.flatMap((entry) => {
    if (entry.key === admission.identity) {
      return [{ ...entry, admissionReason: admission.reason }];
    }
    if (!blocked.has(entry.key)) return [entry];
    const prior = baselineByKey.get(entry.key);
    return prior === undefined ? [] : [prior];
  });
  const preserved = preserveNearDuplicateAdmissionReasons(admitted, baseline);
  writeFileAtomicallySync(baselinePath, formatNearDuplicatesBaseline(preserved));
  return {
    exitCode: 0,
    stdout: `sensor:near-duplicates -- admitted 1 reviewed identity at ${baselinePath}`,
    entries: preserved,
  };
}

function fullBaselineResult(
  baseline: readonly NearDuplicateBaselineEntry[],
  current: readonly NearDuplicateBaselineEntry[],
): NearDuplicatesRunResult {
  const gate = gateEntries(baseline, current);
  if (gate.status === "ok") {
    return {
      exitCode: 0,
      stdout: `OK: whole-repo near-duplicate baseline matches ${String(current.length)} identities`,
      entries: current,
    };
  }
  return {
    exitCode: 1,
    stdout: [
      "FAIL: whole-repo near-duplicate baseline is stale after integration",
      ...regressions(gate).map((key) => `  + ${key}`),
      ...gate.removed.map((key) => `  - ${key}`),
      ...gate.decreased.map((key) => `  - ${key}`),
      "run: bun scripts/sensor-near-duplicates.ts --update",
    ].join("\n"),
    entries: current,
  };
}

function parseFailure(
  argv: readonly string[],
  parsed: Extract<ParseResult<NearDuplicatesCliOptions>, { readonly ok: false }>,
): NearDuplicatesRunResult {
  const help = isNearDuplicatesHelpFlag(argv[0]);
  return {
    exitCode: help ? 0 : CLI_ERROR_EXIT_CODE,
    stdout: help ? parsed.error : `ERROR: ${parsed.error}`,
  };
}

function checkResult(
  options: RunNearDuplicatesCliOptions,
  cwd: string,
  baseline: Extract<ParseResult<readonly NearDuplicateBaselineEntry[]>, { readonly ok: true }>,
  collected: readonly NearDuplicateBaselineEntry[],
): NearDuplicatesRunResult {
  if (baseline.warnings !== undefined) {
    return {
      exitCode: 1,
      stdout: [
        ...baseline.warnings.map((warning) => `WARN: ${warning}`),
        "run: bun scripts/sensor-near-duplicates.ts --update",
      ].join("\n"),
    };
  }
  const changed =
    options.changedFiles === undefined
      ? stagedFiles(cwd)
      : { ok: true as const, value: options.changedFiles };
  if (!changed.ok) return { exitCode: CLI_ERROR_EXIT_CODE, stdout: `ERROR: ${changed.error}` };
  return checkOutput(baseline.value, scopedNearDuplicateEntries(collected, changed.value));
}

function workingDirectory(cwd: string | undefined): string {
  return cwd ?? process.cwd();
}

export function runNearDuplicatesCli(
  options: RunNearDuplicatesCliOptions,
): NearDuplicatesRunResult {
  const parsed = parseNearDuplicatesArgs(options.argv);
  if (!parsed.ok) return parseFailure(options.argv, parsed);
  const cwd = workingDirectory(options.cwd);
  const baselinePath = resolve(cwd, parsed.value.baselinePath);
  const baseline = readNearDuplicatesBaselineFile(baselinePath);
  const collected = collectNearDuplicates(cwd, options.runner ?? defaultNearDuplicateRunner());
  if (!collected.ok) {
    return { exitCode: CLI_ERROR_EXIT_CODE, stdout: `ERROR: ${collected.error}` };
  }
  if (!baseline.ok) {
    return {
      exitCode: CLI_ERROR_EXIT_CODE,
      stdout: `ERROR: ${baseline.error}`,
      entries: collected.value,
    };
  }
  const committedBaseline = readHeadNearDuplicatesBaseline(cwd, baselinePath);
  if (!committedBaseline.ok) {
    return { exitCode: CLI_ERROR_EXIT_CODE, stdout: `ERROR: ${committedBaseline.error}` };
  }
  const truthUpResult = resolveNearDuplicatesMergeTruth({
    baselinePath,
    committed: committedBaseline.value,
    current: collected.value,
    cwd,
    proposed: baseline.value,
    restore: parsed.value.restoreMergeTruth,
  });
  if (truthUpResult !== undefined) return truthUpResult;
  if (parsed.value.admission !== undefined) {
    return admissionResult(baselinePath, baseline.value, collected.value, parsed.value.admission);
  }
  if (parsed.value.update) {
    return updateResult(baselinePath, committedBaseline.value, collected.value);
  }
  if (parsed.value.checkBaseline) return fullBaselineResult(baseline.value, collected.value);
  return checkResult(options, cwd, baseline, collected.value);
}
