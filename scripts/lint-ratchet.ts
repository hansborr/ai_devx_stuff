import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, PROCESS_ARG_OFFSET, usage, UsageError } from "./lint-ratchet/cli.js";
import { WorseBaselineError } from "./lint-ratchet/errors.js";
import { ConfigError } from "./lint-ratchet/lint-ratchet-metrics.js";
import { LINT_RATCHET_REPORT_ARTIFACT_URL_ENV } from "./lint-ratchet/lint-ratchet-report.js";
import { type LintRatchetRuntimeOptions, runLintRatchetCli } from "./lint-ratchet/modes.js";

export { assertCheckBaselineComparisonClean, buildEnvelope } from "./lint-ratchet/diagnostics.js";

const DECIMAL_RADIX = 10;
const MIN_EDIT_CHECK_CONCURRENCY = 1;

function nonEmptyEnvValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function editCheckConcurrencyFromEnv(): number | undefined {
  const raw = process.env.AI_RATCHET_REGRESSION_CONCURRENCY;
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  return Number.isInteger(parsed) && parsed >= MIN_EDIT_CHECK_CONCURRENCY ? parsed : undefined;
}

function runtimeOptionsFromEnv(): LintRatchetRuntimeOptions {
  const reportArtifactName = nonEmptyEnvValue(LINT_RATCHET_REPORT_ARTIFACT_URL_ENV);
  const editCheckConcurrency = editCheckConcurrencyFromEnv();
  return {
    ...(reportArtifactName === undefined ? {} : { reportArtifactName }),
    ...(editCheckConcurrency === undefined ? {} : { editCheckConcurrency }),
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
