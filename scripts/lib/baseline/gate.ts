// Symmetric gate for item-keyed baselines. Mirrors the lint-ratchet's symmetric
// floor across both axes an item can move on:
//   - key set: a current key absent from the baseline is a blocking regression
//     (even when the total count is unchanged — the same-count swap that
//     count-only floors miss); a baseline key absent from the current tree is a
//     blocking improvement that must be locked in by tightening the baseline.
//   - per-key count: for count-bearing metrics (a per-file cap, a suppression
//     tally), a shared key whose current count exceeds the baseline is a
//     blocking regression; a lower count is a blocking improvement.
// Identity ledgers leave `count` undefined (treated as 1), so a shared key never
// moves on the count axis and the gate reduces to pure key-set membership.

import { type BaselineEntry, entryCount } from "./entry-baseline.js";

export interface GateResult {
  readonly status: "ok" | "regressed" | "improved";
  // Current keys missing from the baseline: new debt, blocking.
  readonly added: readonly string[];
  // Baseline keys missing from the current tree: resolved debt, blocking until
  // the baseline is tightened.
  readonly removed: readonly string[];
  // Shared keys whose current count is above the baseline: new debt, blocking.
  readonly increased: readonly string[];
  // Shared keys whose current count is below the baseline: resolved debt,
  // blocking until the baseline is tightened.
  readonly decreased: readonly string[];
}

function countByKey(entries: readonly BaselineEntry[]): Map<string, number> {
  return new Map(entries.map((entry) => [entry.key, entryCount(entry)]));
}

function sorted(keys: readonly string[]): string[] {
  return [...keys].sort((left, right) => left.localeCompare(right));
}

export function gateEntries(
  baseline: readonly BaselineEntry[],
  current: readonly BaselineEntry[],
): GateResult {
  const baselineCounts = countByKey(baseline);
  const currentCounts = countByKey(current);
  const added: string[] = [];
  const increased: string[] = [];
  const decreased: string[] = [];
  for (const [key, count] of currentCounts) {
    const baselineCount = baselineCounts.get(key);
    if (baselineCount === undefined) added.push(key);
    else if (count > baselineCount) increased.push(key);
    else if (count < baselineCount) decreased.push(key);
  }
  const removed = [...baselineCounts.keys()].filter((key) => !currentCounts.has(key));

  const result = {
    added: sorted(added),
    removed: sorted(removed),
    increased: sorted(increased),
    decreased: sorted(decreased),
  };
  if (result.added.length > 0 || result.increased.length > 0) {
    return { status: "regressed", ...result };
  }
  if (result.removed.length > 0 || result.decreased.length > 0) {
    return { status: "improved", ...result };
  }
  return { status: "ok", ...result };
}
