#!/usr/bin/env bun

import { runNearDuplicatesCli } from "./sensor-near-duplicates-core.js";

const PROCESS_ARGV_USER_ARGS_START = 2;

export {
  formatNearDuplicatesBaseline,
  type NearDuplicateBaselineEntry,
} from "./sensor-near-duplicates-baseline.js";
export {
  type NearDuplicatesRunResult,
  runNearDuplicatesCli,
  type RunNearDuplicatesCliOptions,
} from "./sensor-near-duplicates-core.js";
import { isCliEntrypoint } from "./lib/process-argv.js";

if (isCliEntrypoint(import.meta.url)) {
  const result = runNearDuplicatesCli({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
