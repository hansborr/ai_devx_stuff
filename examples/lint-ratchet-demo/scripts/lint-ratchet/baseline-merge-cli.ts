import {
  type MergeDriverCliConfig,
  runMergeDriverCliMain,
} from "@musi/lint-ratchet/git-rail/merge-cli.js";
import { mergeLintRatchetBaselines } from "@musi/lint-ratchet/kernel/baseline-merge.js";

const nodeArgvUserArgumentOffset = 2;

// The fixed-path CLI wrapper the installed Git merge driver dispatches. It binds
// the demo's baseline merge to the package's pure git-rail merge runner; the
// driver shell invokes this file directly, so only the import.meta.main entry is
// needed (no exported surface).
const CONFIG: MergeDriverCliConfig = {
  usage:
    "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
  unresolvedFailureLabel: "lint-ratchet baseline semantic merge could not resolve",
  fatalFailureLabel: "lint-ratchet baseline semantic merge failed",
  markerMessage: "lint-ratchet baseline semantic merge requires post-merge truth-up",
  merge: mergeLintRatchetBaselines,
};

if (import.meta.main) {
  runMergeDriverCliMain(process.argv.slice(nodeArgvUserArgumentOffset), CONFIG);
}
