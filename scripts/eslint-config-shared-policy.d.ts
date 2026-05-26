declare module "*eslint-config/shared-policy.js" {
  type MaxLinesPolicySeverity = "error" | "warn";

  interface MaxLinesPolicyException {
    readonly path: string;
    readonly cap: number;
    readonly severity: MaxLinesPolicySeverity;
    readonly reason: string;
    readonly ratchetExcluded: boolean;
  }

  interface MaxLinesPolicyCounting {
    readonly skipBlankLines: true;
    readonly skipComments: true;
  }

  interface MaxLinesPolicyRatchet {
    readonly id: string;
    readonly files: readonly string[];
    readonly ignores: readonly string[];
    readonly zeroBaselineDisposition: {
      readonly kind: "intentional-ratchet-only" | "narrow-floor";
      readonly reason: string;
    };
  }

  interface MaxLinesPolicy {
    readonly counting: MaxLinesPolicyCounting;
    readonly ratchetFloor: { readonly cap: number };
    readonly exceptions: readonly MaxLinesPolicyException[];
    readonly ratchets: readonly MaxLinesPolicyRatchet[];
  }

  export const maxLinesPolicy: MaxLinesPolicy;
}
