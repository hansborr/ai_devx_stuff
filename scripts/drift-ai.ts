#!/usr/bin/env bun
// Report-only AI drift sensors. This file is a pure executable entrypoint;
// detector and report internals live in focused modules under
// `scripts/drift-ai/` and are imported from there directly.

import { runDriftAi } from "./drift-ai/runner.js";
import { PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";

const result = runDriftAi({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
if (result.stdout) console.log(result.stdout);
if (result.exitCode !== 0) process.exitCode = result.exitCode;
