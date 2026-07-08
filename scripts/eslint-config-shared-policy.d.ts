declare module "*eslint-config/shared-policy.js" {
  interface ConfigSurfaceEntry {
    readonly path: string;
    readonly language: "js" | "mjs" | "ts";
    readonly group: "root-js" | "root-package-ts" | "script-ts" | "eslint-rules-ts";
    readonly coverageStatus: "linted";
  }

  type MaxLinesPolicySeverity = "error" | "warn";
  type MaxLinesPolicyLifecycle = "permanent" | "candidate-for-split";

  interface MaxLinesPolicyException {
    readonly path: string;
    readonly cap: number;
    readonly severity: MaxLinesPolicySeverity;
    readonly reason: string;
    readonly lifecycle: MaxLinesPolicyLifecycle;
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
  export const jsTsLintableExtensions: readonly `.${string}`[];
  export const codeFiles: readonly string[];
  export const typescriptFiles: readonly string[];
  export const configSurfaceEntries: readonly ConfigSurfaceEntry[];
  export const rootJsConfigFiles: readonly string[];
  export const rootAndPackageTsConfigFiles: readonly string[];
  export const tsConfigFiles: readonly string[];
  export const eslintRulesConfigReincludePatterns: readonly string[];
  export const scriptFixtureIgnores: readonly string[];
  export const scriptTestAssertFunctionNames: readonly string[];
  export const clientSourceFiles: readonly string[];
  export const clientTestAndHelperSourceFiles: readonly string[];
}

declare module "*eslint-config/config-surfaces.js" {
  export interface ConfigSurfaceEntry {
    readonly path: string;
    readonly language: "js" | "mjs" | "ts";
    readonly group: "root-js" | "root-package-ts" | "script-ts" | "eslint-rules-ts";
    readonly coverageStatus: "linted";
  }

  export const configSurfaceManifestPath: string;
  export const configSurfaceEntries: readonly ConfigSurfaceEntry[];
  export const rootJsConfigFiles: readonly string[];
  export const rootAndPackageTsConfigFiles: readonly string[];
  export const tsConfigFiles: readonly string[];
  export const extraConfigFileReincludePatterns: readonly string[];
  export const eslintRulesConfigReincludePatterns: readonly string[];
  export const scriptProjectConfigIgnores: readonly string[];
}

declare module "*eslint-rules/max-lines.js" {
  import type { Rule } from "eslint";

  export const MAX_LINES_SPLIT_GUIDANCE: string;
  export const MAX_LINES_METRIC_GUIDANCE: string;

  const rule: Rule.RuleModule;
  export default rule;
}
