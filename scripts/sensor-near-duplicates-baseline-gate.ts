import { writeFileAtomicallySync } from "@musi/lint-ratchet/kernel/atomic-write.js";
import { gateEntries } from "@musi/lint-ratchet/kernel/gate.js";

import {
  formatNearDuplicatesBaseline,
  type NearDuplicateBaselineEntry,
  preserveNearDuplicateAdmissionReasons,
} from "./sensor-near-duplicates-baseline.js";
import { validateNearDuplicatesMergeTruthUp } from "./sensor-near-duplicates-baseline-io.js";

type MergeTruthResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly entries?: readonly NearDuplicateBaselineEntry[];
};

export function scopedNearDuplicateEntries(
  entries: readonly NearDuplicateBaselineEntry[],
  changedFiles: readonly string[],
): NearDuplicateBaselineEntry[] {
  const changed = new Set(changedFiles);
  return entries.filter((entry) => changed.has(entry.leftFile) || changed.has(entry.rightFile));
}

function proposedBaselineGrowthMessage(
  committedBaseline: readonly NearDuplicateBaselineEntry[],
  proposedBaseline: readonly NearDuplicateBaselineEntry[],
): string | undefined {
  const gate = gateEntries(committedBaseline, proposedBaseline);
  const proposedByKey = new Map(proposedBaseline.map((entry) => [entry.key, entry]));
  const added = gate.added.filter((key) => proposedByKey.get(key)?.admissionReason === undefined);
  const increased = gate.increased;
  if (added.length === 0 && increased.length === 0) return undefined;
  return [
    "FAIL: proposed baseline adds near-duplicate debt over HEAD (unreviewed)",
    ...[...added, ...increased].map((key) => `  + ${key}`),
    "Remove the added identity or record it with --admit <identity> --reason <text>.",
  ].join("\n");
}

export function resolveNearDuplicatesMergeTruth(options: {
  readonly baselinePath: string;
  readonly committed: readonly NearDuplicateBaselineEntry[];
  readonly current: readonly NearDuplicateBaselineEntry[];
  readonly cwd: string;
  readonly proposed: readonly NearDuplicateBaselineEntry[];
  readonly restore: boolean;
}): MergeTruthResult | undefined {
  const proposedGrowth = proposedBaselineGrowthMessage(options.committed, options.proposed);
  if (!options.restore && proposedGrowth === undefined) return undefined;
  const truthUp = validateNearDuplicatesMergeTruthUp(options.cwd);
  if (options.restore) {
    if (!truthUp.ok) return { exitCode: 2, stdout: `ERROR: ${truthUp.error}` };
    const restored = preserveNearDuplicateAdmissionReasons(options.current, options.proposed);
    writeFileAtomicallySync(options.baselinePath, formatNearDuplicatesBaseline(restored));
    return {
      exitCode: 0,
      stdout: `sensor:near-duplicates -- restored stamped merge truth at ${options.baselinePath}`,
      entries: restored,
    };
  }
  const exactTruth = gateEntries(options.proposed, options.current).status === "ok";
  if (!truthUp.ok || !exactTruth) return { exitCode: 1, stdout: proposedGrowth ?? "" };
  return undefined;
}
