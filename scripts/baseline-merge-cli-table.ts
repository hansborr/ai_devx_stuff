// The single data table behind the four baseline semantic-merge CLIs
// (ready-2026-07 leaf 16). Each entry names one committed baseline's merge CLI
// — the fixed path `scripts/git/baseline-merge-driver.sh` dispatches on — and
// `mergeCliConfigFor` derives the previously hand-copied usage/failure/marker
// strings from it. The per-CLI files stay as path-stable wrappers because
// every caller addresses them by path (the shell registry, the lint-ratchet
// smoke, docs), and each keeps its own merge binding so a merge driver's
// runtime import closure stays its own (the lint-ratchet smoke runs
// baseline-merge-cli.ts in a minimal sandbox; this table is deliberately
// import-free at runtime). Scope note: the general `runCliMain` entry kernel
// across all scripts CLIs was explicitly rejected by the leaf — this table
// covers the merge-CLI family only.
import type { MergeDriverCliConfig } from "@musi/lint-ratchet/git-rail/merge-cli.js";

export interface BaselineMergeCliEntry {
  /** Human label prefixed to the derived failure/marker messages. */
  readonly displayLabel: string;
  /** Repo-relative entry path — the contract the shell registry dispatches on. */
  readonly cliPath: string;
}

export const BASELINE_MERGE_CLI_TABLE = {
  "lint-ratchet": {
    displayLabel: "lint-ratchet",
    cliPath: "scripts/lint-ratchet/baseline-merge-cli.ts",
  },
  "max-lines-exceptions": {
    displayLabel: "max-lines exceptions",
    cliPath: "scripts/max-lines-exceptions-merge-cli.ts",
  },
  "knip-unused-exports": {
    displayLabel: "knip unused-exports",
    cliPath: "scripts/sensor-knip-unused-exports-merge-cli.ts",
  },
  "near-duplicates": {
    displayLabel: "near-duplicates",
    cliPath: "scripts/sensor-near-duplicates-merge-cli.ts",
  },
} as const satisfies Record<string, BaselineMergeCliEntry>;

export type BaselineMergeCliId = keyof typeof BASELINE_MERGE_CLI_TABLE;

export function mergeCliConfigFor(
  id: BaselineMergeCliId,
  merge: MergeDriverCliConfig["merge"],
): MergeDriverCliConfig {
  const entry = BASELINE_MERGE_CLI_TABLE[id];
  return {
    usage: `usage: bun ${entry.cliPath} <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]`,
    unresolvedFailureLabel: `${entry.displayLabel} baseline semantic merge could not resolve`,
    fatalFailureLabel: `${entry.displayLabel} baseline semantic merge failed`,
    markerMessage: `${entry.displayLabel} baseline semantic merge requires post-merge truth-up`,
    merge,
  };
}
