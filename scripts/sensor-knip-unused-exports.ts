#!/usr/bin/env bun
// Leaf 39 decision: promote only knip's symbol-level unused-export count to a
// committed floor. Raw knip dependency/file findings and jscpd or duplicate
// export signals stay advisory through doctor/drift reports until their repair
// workflow is stable enough to gate routine commits.

import { runKnipUnusedExportsCli } from "./sensor-knip-unused-exports-core.js";

export {
  formatKnipUnusedExportsBaseline,
  type KnipUnusedExportEntry,
  type KnipUnusedExportsRunResult,
  runKnipUnusedExportsCli,
  type RunKnipUnusedExportsCliOptions,
} from "./sensor-knip-unused-exports-core.js";
import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

if (isCliEntrypoint(import.meta.url)) {
  const result = runKnipUnusedExportsCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
    env: process.env,
    warn: (message) => {
      console.error(message);
    },
  });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
