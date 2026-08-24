#!/usr/bin/env bun
// Read-only JSONL log quality audit.

import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";
import { runLogsAudit } from "./logs-audit/logs-audit-runner.js";

if (isCliEntrypoint(import.meta.url)) {
  const result = runLogsAudit({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
