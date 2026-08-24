import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetZeroBaselineDispositionKind } from "./zero-baseline-types.js";

const ZERO_BASELINE_DISPOSITION_KINDS = new Set<LintRatchetZeroBaselineDispositionKind>([
  "intentional-ratchet-only",
  "narrow-floor",
  "promote-to-normal-lint",
  "temporary-ratchet-only",
]);

function requiresExitPath(kind: LintRatchetZeroBaselineDispositionKind): boolean {
  return kind === "promote-to-normal-lint" || kind === "temporary-ratchet-only";
}

export function validateZeroBaselineDisposition(
  ratchet: LintRatchetConfig,
  failures: string[],
  exitPathExists?: (exitPath: string) => boolean,
): void {
  const disposition = ratchet.zeroBaselineDisposition;
  if (disposition === undefined) return;
  if (!ZERO_BASELINE_DISPOSITION_KINDS.has(disposition.kind)) {
    failures.push(`${ratchet.id}: zeroBaselineDisposition.kind is invalid: ${disposition.kind}`);
  }
  if (disposition.reason.trim().length === 0) {
    failures.push(`${ratchet.id}: zeroBaselineDisposition.reason must be non-empty`);
  }
  if (!requiresExitPath(disposition.kind)) return;
  const exitPath = disposition.exitPath?.trim() ?? "";
  if (exitPath.length === 0) {
    failures.push(
      `${ratchet.id}: zeroBaselineDisposition.exitPath is required for ${disposition.kind}`,
    );
  } else if (exitPathExists !== undefined && !exitPathExists(exitPath)) {
    failures.push(`${ratchet.id}: zeroBaselineDisposition.exitPath does not exist: ${exitPath}`);
  }
}
