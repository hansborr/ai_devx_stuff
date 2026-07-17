import { mergeBaseline } from "./lib/baseline/merge.js";
import {
  type MergeDriverCliConfig,
  runMergeDriverCli,
  runMergeDriverCliMain,
} from "./lib/baseline/merge-cli.js";
import { nearDuplicatesSpec } from "./sensor-near-duplicates-baseline.js";

const PROCESS_ARGV_USER_ARGS_START = 2;

const CONFIG: MergeDriverCliConfig = {
  usage:
    "usage: bun scripts/sensor-near-duplicates-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
  unresolvedFailureLabel: "near-duplicates baseline semantic merge could not resolve",
  fatalFailureLabel: "near-duplicates baseline semantic merge failed",
  markerMessage: "near-duplicates baseline semantic merge requires post-merge truth-up",
  merge: (input) =>
    mergeBaseline(nearDuplicatesSpec, {
      ...input,
      preserveOneSidedAddition: (entry) => entry.admissionReason !== undefined,
      truthUpOnOneSidedFastPath: true,
    }),
};

export async function runNearDuplicatesMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(PROCESS_ARGV_USER_ARGS_START), CONFIG);
}
