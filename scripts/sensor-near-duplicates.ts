#!/usr/bin/env bun

import { runNearDuplicatesCli } from "./sensor-near-duplicates-core.js";

export {
  formatNearDuplicatesBaseline,
  type NearDuplicateBaselineEntry,
} from "./sensor-near-duplicates-baseline.js";
export {
  type NearDuplicatesRunResult,
  runNearDuplicatesCli,
  type RunNearDuplicatesCliOptions,
} from "./sensor-near-duplicates-core.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

if (isCliEntrypoint(import.meta.url)) {
  const result = runNearDuplicatesCli({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
