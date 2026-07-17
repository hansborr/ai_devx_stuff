#!/usr/bin/env bun

import { pathToFileURL } from "node:url";

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

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runNearDuplicatesCli({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
