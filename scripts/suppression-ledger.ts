#!/usr/bin/env bun
// Leaf 50 step 2: the committed identity ledger for every suppression directive
// in the tree. Step 1 already put the two policy registers in all four slot
// sets, so "would anything fail if an agent disabled a rule in-file?" is
// answered for the *wrong-way* suppressions. This gate answers it for the
// reasoned inline ones, which pass every policy check by design and were
// counted nowhere: new ones cannot land without a ledger entry in the same
// diff, and drained ones must be locked in.

import { pathToFileURL } from "node:url";

import { runSuppressionLedgerCli } from "./suppression-ledger-core.js";

const PROCESS_ARGV_USER_ARGS_START = 2;

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = await runSuppressionLedgerCli({
    argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START),
  });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
