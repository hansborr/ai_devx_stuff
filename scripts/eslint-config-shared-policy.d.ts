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
  export const e2eNoNthMethodsDebtFiles: readonly string[];
  export const e2ePreferNativeLocatorDebtFiles: readonly string[];
  export const e2ePreferRoleSelectorDebtFiles: readonly string[];
  export const scriptFixtureIgnores: readonly string[];
  export const scriptTestAssertFunctionNames: readonly string[];
}

declare module "*eslint-rules/max-lines.js" {
  import type { Rule } from "eslint";

  export const MAX_LINES_SPLIT_GUIDANCE: string;
  export const MAX_LINES_METRIC_GUIDANCE: string;

  const rule: Rule.RuleModule;
  export default rule;
}
