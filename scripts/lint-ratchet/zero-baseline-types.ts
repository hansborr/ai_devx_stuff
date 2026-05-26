export type LintRatchetZeroBaselineDispositionKind =
  | "intentional-ratchet-only"
  | "narrow-floor"
  | "promote-to-normal-lint"
  | "temporary-ratchet-only";

export interface LintRatchetZeroBaselineDisposition {
  readonly kind: LintRatchetZeroBaselineDispositionKind;
  readonly reason: string;
  readonly exitPath?: string;
}
