import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, PROCESS_ARG_OFFSET, usage, UsageError } from "./lint-ratchet/cli.js";
import { WorseBaselineError } from "./lint-ratchet/errors.js";
import { ConfigError } from "./lint-ratchet/lint-ratchet-metrics.js";
import { LINT_RATCHET_REPORT_ARTIFACT_URL_ENV } from "./lint-ratchet/lint-ratchet-report.js";
import { type LintRatchetRuntimeOptions, runLintRatchetCli } from "./lint-ratchet/modes.js";

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

function concurrencyFromEnv(name: string, minimum: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : undefined;
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
  await runLintRatchetCli(
    parseArgs(process.argv.slice(PROCESS_ARG_OFFSET)),
    runtimeOptionsFromEnv(),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
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
