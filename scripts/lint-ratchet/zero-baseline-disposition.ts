import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import type { LintRatchetZeroBaselineDispositionKind } from "./zero-baseline-types.js";

const ZERO_BASELINE_DISPOSITION_KINDS = new Set<LintRatchetZeroBaselineDispositionKind>([
  "intentional-ratchet-only",
  "narrow-floor",
  "promote-to-normal-lint",
  "temporary-ratchet-only",
]);

export function validateZeroBaselineDisposition(
  ratchet: LintRatchetConfig,
  failures: string[],
): void {
  const disposition = ratchet.zeroBaselineDisposition;
  if (disposition === undefined) return;
  if (!ZERO_BASELINE_DISPOSITION_KINDS.has(disposition.kind)) {
    failures.push(`${ratchet.id}: zeroBaselineDisposition.kind is invalid: ${disposition.kind}`);
  }
  if (disposition.reason.trim().length === 0) {
    failures.push(`${ratchet.id}: zeroBaselineDisposition.reason must be non-empty`);
  }
  if (
    (disposition.kind === "promote-to-normal-lint" ||
      disposition.kind === "temporary-ratchet-only") &&
    (disposition.exitPath?.trim() ?? "").length === 0
  ) {
    failures.push(
      `${ratchet.id}: zeroBaselineDisposition.exitPath is required for ${disposition.kind}`,
    );
  }
}
