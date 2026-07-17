import {
  type MergeDriverCliConfig,
  runMergeDriverCli,
  runMergeDriverCliMain,
} from "../lib/baseline/merge-cli.js";
import { mergeLintRatchetBaselines } from "./baseline-merge.js";

const nodeArgvUserArgumentOffset = 2;

const CONFIG: MergeDriverCliConfig = {
  usage:
    "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
  unresolvedFailureLabel: "lint-ratchet baseline semantic merge could not resolve",
  fatalFailureLabel: "lint-ratchet baseline semantic merge failed",
  markerMessage: "lint-ratchet baseline semantic merge requires post-merge truth-up",
  merge: mergeLintRatchetBaselines,
};

export async function runBaselineMergeCli(argv: readonly string[]): Promise<number> {
  return runMergeDriverCli(argv, CONFIG);
}

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(nodeArgvUserArgumentOffset), CONFIG);
}
