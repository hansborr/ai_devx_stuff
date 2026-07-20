// Path-stable wrapper: scripts/git/baseline-merge-driver.sh dispatches this
// exact path. Usage/failure strings derive from the merge-CLI table
// (ready-2026-07 leaf 16); the merge binding stays here so this CLI's runtime
// import closure remains its own (the lint-ratchet merge smoke runs this file
// inside a minimal sandbox fixture — see copy_lint_ratchet_merge_runtime in
// scripts/tests/test-lint-ratchet.sh).
import { runMergeDriverCli, runMergeDriverCliMain } from "@musi/lint-ratchet/git-rail/merge-cli.js";
import { mergeLintRatchetBaselines } from "@musi/lint-ratchet/kernel/baseline-merge.js";

import { mergeCliConfigFor } from "../baseline-merge-cli-table.js";
import { PROCESS_ARGV_USER_ARGS_START } from "../lib/process-argv.js";

const CONFIG = mergeCliConfigFor("lint-ratchet", mergeLintRatchetBaselines);

export async function runBaselineMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(PROCESS_ARGV_USER_ARGS_START), CONFIG);
}
