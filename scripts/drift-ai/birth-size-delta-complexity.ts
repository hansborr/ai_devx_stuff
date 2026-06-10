// Branch-points overlay derivation for the birth-size-delta lens (backlog task 45b).
// Split out of birth-size-delta-analysis.ts so the size analysis stays focused and the
// overlay translation is directly testable, including the parse-failure degradation.
//
// Both helpers take a `BranchPointResult | null` per blob, where `null` means the blob
// was UNAVAILABLE (a missing birth blob, an unreadable current file). A non-null result
// means the blob was available; `ok: false` means it was available but did NOT parse.
// That distinction is why parse-failure caveats fire only on available-but-unparsed
// blobs: a missing blob is already disclosed by the row's blob state and its own caveat.

import type { BirthSizeDeltaComplexity, BirthSizeDeltaMetric } from "./birth-size-delta-types.js";
import type { BranchPointResult } from "./branch-points.js";

// Heaviest current-blob scopes surfaced per row; the row always discloses the full
// branch-point total, so this display cap never hides the metric itself.
const COMPLEXITY_TOP_FUNCTIONS = 5;

export function birthSizeDeltaComplexityOverlay(
  birth: BranchPointResult | null,
  current: BranchPointResult | null,
): BirthSizeDeltaComplexity {
  return {
    branchPoints: branchMetric(branchTotal(birth), branchTotal(current)),
    birthParsed: birth !== null && birth.ok,
    currentParsed: current !== null && current.ok,
    topFunctions: topComplexityFunctions(current),
  };
}

// Parse failures are degradations, not findings. Only reported when the blob WAS
// available but did not parse, so a missing blob is not double-reported.
export function birthSizeDeltaComplexityCaveats(
  birth: BranchPointResult | null,
  current: BranchPointResult | null,
): string[] {
  const caveats: string[] = [];
  if (birth !== null && !birth.ok) {
    caveats.push(`branch-points metric could not parse birth blob: ${birth.reason}`);
  }
  if (current !== null && !current.ok) {
    caveats.push(`branch-points metric could not parse current blob: ${current.reason}`);
  }
  return caveats;
}

function branchTotal(result: BranchPointResult | null): number | null {
  return result !== null && result.ok ? result.metrics.total : null;
}

function topComplexityFunctions(
  result: BranchPointResult | null,
): BirthSizeDeltaComplexity["topFunctions"] {
  if (result === null || !result.ok) return [];
  return result.metrics.functions.slice(0, COMPLEXITY_TOP_FUNCTIONS);
}

function branchMetric(birth: number | null, current: number | null): BirthSizeDeltaMetric {
  return {
    birth,
    current,
    delta: birth === null || current === null ? null : current - birth,
  };
}
