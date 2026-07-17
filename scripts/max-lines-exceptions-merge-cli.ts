import { mergeBaseline } from "./lib/baseline/merge.js";
import {
  type MergeDriverCliConfig,
  runMergeDriverCli,
  runMergeDriverCliMain,
} from "./lib/baseline/merge-cli.js";
import { maxLinesExceptionsSpec } from "./max-lines-exceptions-core.js";

const nodeArgvUserArgumentOffset = 2;

const CONFIG: MergeDriverCliConfig = {
  usage:
    "usage: bun scripts/max-lines-exceptions-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
  unresolvedFailureLabel: "max-lines exceptions baseline semantic merge could not resolve",
  fatalFailureLabel: "max-lines exceptions baseline semantic merge failed",
  markerMessage: "max-lines exceptions baseline semantic merge requires post-merge truth-up",
  merge: (input) =>
    mergeBaseline(maxLinesExceptionsSpec, { ...input, oneSidedEntryStrategy: "base-aware" }),
};

export async function runMaxLinesExceptionsMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(nodeArgvUserArgumentOffset), CONFIG);
}
