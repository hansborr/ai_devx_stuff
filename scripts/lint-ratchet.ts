import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { forwardMissingMergeDriverWarning } from "@musi/lint-ratchet/git-rail/merge-driver-presence.js";
import { WorseBaselineError } from "@musi/lint-ratchet/governance/errors.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics.js";

import { parseArgs, PROCESS_ARG_OFFSET, usage, UsageError } from "./lint-ratchet/cli.js";
import { type LintRatchetRuntimeOptions, runLintRatchetCli } from "./lint-ratchet/modes.js";
import { repoRoot } from "./lint-ratchet/paths.js";
import { LINT_RATCHET_REPORT_ARTIFACT_URL_ENV } from "./lint-ratchet/report.js";

export {
  assertCheckBaselineComparisonClean,
  buildEnvelope,
  buildEnvelopeFromComparison,
} from "./lint-ratchet/diagnostics.js";

const DECIMAL_RADIX = 10;
const MIN_EDIT_CHECK_CONCURRENCY = 1;
const MIN_COLLECT_CONCURRENCY = 1;

function nonEmptyEnvValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Parse a concurrency env value, failing loud on garbage. A set env var
 * expresses operator intent, so a typo like `AI_RATCHET_COLLECT_CONCURRENCY=1O`
 * (letter O) or a below-minimum value should stop the run — not silently fall
 * back to the default via `parseInt`'s trailing-junk tolerance. Unset or empty
 * means "use the default" (consistent with nonEmptyEnvValue).
 */
export function parseConcurrencyEnvValue(
  raw: string | undefined,
  name: string,
  minimum: number,
): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (!/^\d+$/u.test(raw)) {
    throw new ConfigError(
      `${name}=${raw} is not a valid concurrency (expected an integer >= ${String(minimum)})`,
    );
  }
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (parsed < minimum) {
    throw new ConfigError(`${name}=${raw} is below the minimum concurrency ${String(minimum)}`);
  }
  return parsed;
}

function concurrencyFromEnv(name: string, minimum: number): number | undefined {
  return parseConcurrencyEnvValue(process.env[name], name, minimum);
}

function editCheckConcurrencyFromEnv(): number | undefined {
  return concurrencyFromEnv("AI_RATCHET_REGRESSION_CONCURRENCY", MIN_EDIT_CHECK_CONCURRENCY);
}

function collectConcurrencyFromEnv(): number | undefined {
  return concurrencyFromEnv("AI_RATCHET_COLLECT_CONCURRENCY", MIN_COLLECT_CONCURRENCY);
}

function runtimeOptionsFromEnv(): LintRatchetRuntimeOptions {
  const reportArtifactName = nonEmptyEnvValue(LINT_RATCHET_REPORT_ARTIFACT_URL_ENV);
  const editCheckConcurrency = editCheckConcurrencyFromEnv();
  const collectConcurrency = collectConcurrencyFromEnv();
  return {
    ...(reportArtifactName === undefined ? {} : { reportArtifactName }),
    ...(editCheckConcurrency === undefined ? {} : { editCheckConcurrency }),
    ...(collectConcurrency === undefined ? {} : { collectConcurrency }),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  if (args.mode === "update" || args.mode === "check-baseline") {
    forwardMissingMergeDriverWarning({
      checkScriptPath: resolve(repoRoot, "scripts/git/check-lint-ratchet-merge-driver.sh"),
      cwd: process.cwd(),
      env: process.env,
      warn: (message) => {
        console.error(message);
      },
    });
  }
  await runLintRatchetCli(args, runtimeOptionsFromEnv());
}

// Injectable path plumbing so the entry classification is unit-testable without
// spawning the script through a real symlink.
interface EntryProbe {
  readonly resolvePath: (path: string) => string;
  readonly realpath: (path: string) => string;
  readonly toHref: (path: string) => string;
}

const nodeEntryProbe: EntryProbe = {
  resolvePath: (path) => resolve(path),
  realpath: (path) => realpathSync(path),
  toHref: (path) => pathToFileURL(path).href,
};

const SCRIPT_BASENAME = "lint-ratchet.ts";

/**
 * Decide whether this module was invoked as the CLI, imported for its exports,
 * or invoked as the CLI with a broken identity match. Node's ESM loader
 * realpaths the entry module URL while `resolve(argv[1])` does not follow
 * symlinks, so a symlinked checkout makes the raw comparison fail; probing the
 * realpathed form too lets a symlinked invocation still `"run"`. When the guard
 * fails yet `argv[1]` still names THIS script, that is a wiring anomaly, not a
 * module import — return `"mismatch"` so the caller fails loud instead of a
 * gate silently exiting 0 having checked nothing.
 */
export function classifyScriptEntry(
  argvPath: string | undefined,
  importMetaHref: string,
  scriptBasename: string = SCRIPT_BASENAME,
  probe: EntryProbe = nodeEntryProbe,
): "run" | "skip" | "mismatch" {
  if (argvPath === undefined) return "skip";
  const resolved = probe.resolvePath(argvPath);
  const candidates = [resolved];
  try {
    candidates.push(probe.realpath(resolved));
  } catch {
    // realpath throws if the path vanished mid-run; the unresolved form stands.
  }
  if (candidates.some((candidate) => probe.toHref(candidate) === importMetaHref)) return "run";
  return basename(argvPath) === scriptBasename ? "mismatch" : "skip";
}

const entryDisposition = classifyScriptEntry(process.argv[1], import.meta.url);
if (entryDisposition === "mismatch") {
  console.error(
    `lint:ratchet: invoked as a script but the entry-point identity check failed — the gate did ` +
      `NOT run. import.meta.url=${import.meta.url} did not match argv[1]=${process.argv[1] ?? "(none)"} ` +
      `(resolved or realpathed). This usually means a symlink or path-casing mismatch in the wiring; ` +
      `fix the invocation so the ratchet actually runs.`,
  );
  process.exitCode = 2;
} else if (entryDisposition === "run") {
  try {
    await main();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`lint:ratchet: ${error.message}\n${usage()}`);
      process.exitCode = 2;
    } else if (error instanceof ConfigError) {
      console.error(`lint:ratchet: ${error.message}`);
      process.exitCode = 2;
    } else if (error instanceof WorseBaselineError) {
      console.error(`lint:ratchet: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
