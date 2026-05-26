import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, PROCESS_ARG_OFFSET, usage, UsageError } from "./lint-ratchet/cli.js";
import { WorseBaselineError } from "./lint-ratchet/errors.js";
import { runLintRatchetCli } from "./lint-ratchet/modes.js";
import { ConfigError } from "./lint-ratchet-metrics.js";

export {
  assertCheckBaselineComparisonClean,
  buildEnvelope,
} from "./lint-ratchet/diagnostics.js";

async function main(): Promise<void> {
  await runLintRatchetCli(parseArgs(process.argv.slice(PROCESS_ARG_OFFSET)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
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
