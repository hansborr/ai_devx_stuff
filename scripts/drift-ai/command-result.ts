// The one base command-result contract for every drift:ai command family, plus
// the one sentinel-error mapping. drift:ai surfaces exactly two sentinel errors
// to the CLI: DriftAiHelp is a successful help request (exit 0) and DriftAiError
// is a usage/configuration problem (exit 2). Anything else is an unexpected bug
// and must propagate. Centralizing the contract and the mapping keeps the
// prototype wrapper, the main runner, config inspection, hotspots, and coldspots
// from each re-deriving (and drifting on) the result fields or the exit policy.

import { DriftAiHelp } from "./cli-args.js";
import { DriftAiError } from "./errors.js";

// Families with extra fields (the main runner's optional report) intersect onto
// this contract rather than redeclaring it; the base never forces those fields
// onto subcommands.
export type DriftAiCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function sentinelToCommandResult(err: unknown): DriftAiCommandResult {
  if (err instanceof DriftAiHelp) return { exitCode: 0, stdout: err.message };
  if (err instanceof DriftAiError) return { exitCode: 2, stdout: err.message };
  throw err;
}
