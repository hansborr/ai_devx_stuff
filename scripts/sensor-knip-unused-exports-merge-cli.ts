import { mergeBaseline } from "./lib/baseline/merge.js";
import {
  type MergeDriverCliConfig,
  runMergeDriverCli,
  runMergeDriverCliMain,
} from "./lib/baseline/merge-cli.js";
import { knipUnusedExportsSpec } from "./sensor-knip-unused-exports-baseline.js";

const nodeArgvUserArgumentOffset = 2;

const CONFIG: MergeDriverCliConfig = {
  usage:
    "usage: bun scripts/sensor-knip-unused-exports-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
  unresolvedFailureLabel: "knip unused-exports baseline semantic merge could not resolve",
  fatalFailureLabel: "knip unused-exports baseline semantic merge failed",
  markerMessage: "knip unused-exports baseline semantic merge requires post-merge truth-up",
  merge: (input) => mergeBaseline(knipUnusedExportsSpec, input),
};

export async function runKnipUnusedExportsMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(nodeArgvUserArgumentOffset), CONFIG);
}
