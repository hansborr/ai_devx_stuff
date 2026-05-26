import type {
  LintRatchetBaseline,
  LintRatchetUpdateDecision,
} from "../lint-ratchet-baseline.js";
import { compareCurrentToBaseline as compareCurrentToBaselineImpl } from "../lint-ratchet-baseline-compare.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { currentByIdFromBaseline } from "./baseline-format.js";

export function decideLintRatchetUpdate(
  committed: LintRatchetBaseline,
  generated: LintRatchetBaseline,
  ratchets: readonly LintRatchetConfig[],
  options: { readonly allowWorse: boolean; readonly reason?: string },
): LintRatchetUpdateDecision {
  const comparison = compareCurrentToBaselineImpl(
    committed,
    ratchets,
    currentByIdFromBaseline(generated),
  );
  const failures: string[] = [];
  const reason = options.reason?.trim() ?? "";
  if (comparison.regressions.length > 0 && !options.allowWorse) {
    failures.push(
      `generated baseline is worse for ${String(comparison.regressions.length)} path(s); ` +
        "pass --allow-worse --reason \"<why>\" to accept intentional new debt",
    );
  }

  const registryIds = new Set(ratchets.map((ratchet) => ratchet.id));
  const orphanIds = Object.keys(committed.tests)
    .filter((id) => !registryIds.has(id))
    .sort();
  if (orphanIds.length > 0 && !options.allowWorse) {
    failures.push(
      `committed baseline carries ${String(orphanIds.length)} entr${orphanIds.length === 1 ? "y" : "ies"} ` +
        `with no matching registry id (${orphanIds.join(", ")}); ` +
        "this looks like a rename or removal — pass --allow-worse --reason \"<why>\" " +
        "so count protection is not bypassed silently",
    );
  }
  if (options.allowWorse && reason.length === 0) {
    failures.push("--allow-worse requires a non-empty --reason");
  }
  return { ...comparison, allowed: failures.length === 0, failures };
}
