// Path-stable wrapper: scripts/git/baseline-merge-driver.sh dispatches this
// exact path. Usage/failure strings derive from the merge-CLI table
// (ready-2026-07 leaf 16); the merge binding stays here so this CLI's runtime
// import closure remains its own.
import { runMergeDriverCli, runMergeDriverCliMain } from "@musi/lint-ratchet/git-rail/merge-cli.js";
import { mergeBaseline } from "@musi/lint-ratchet/kernel/merge.js";

import { mergeCliConfigFor } from "./baseline-merge-cli-table.js";
import { PROCESS_ARGV_USER_ARGS_START } from "./lib/process-argv.js";
import { knipUnusedExportsSpec } from "./sensor-knip-unused-exports-baseline.js";

const CONFIG = mergeCliConfigFor("knip-unused-exports", (input) =>
  mergeBaseline(knipUnusedExportsSpec, input),
);

export async function runKnipUnusedExportsMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(PROCESS_ARGV_USER_ARGS_START), CONFIG);
}
