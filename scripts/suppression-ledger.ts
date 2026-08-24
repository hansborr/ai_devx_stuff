#!/usr/bin/env bun
// Leaf 50 step 2: the committed identity ledger for every suppression directive
// in the tree. Step 1 already put the two policy registers in all four slot
// sets, so "would anything fail if an agent disabled a rule in-file?" is
// answered for the *wrong-way* suppressions. This gate answers it for the
// reasoned inline ones, which pass every policy check by design and were
// counted nowhere: new ones cannot land without a ledger entry in the same
// diff, and drained ones must be locked in.

import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";
import { runSuppressionLedgerCli } from "./suppression-ledger-core.js";

if (isCliEntrypoint(import.meta.url)) {
  const result = await runSuppressionLedgerCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
  });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
