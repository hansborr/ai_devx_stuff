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

  interface MaxLinesPolicyGeneratedExemption {
    readonly path: string;
    readonly generator: string;
    readonly reason: string;
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
    readonly generatedExemptions: readonly MaxLinesPolicyGeneratedExemption[];
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
  export const productionFunctionStructureFiles: readonly string[];
  export const productionFunctionStructureIgnores: readonly string[];
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

declare module "*eslint-config/max-lines-exceptions-codec.js" {
  type MaxLinesSeverity = "error" | "warn";
  type MaxLinesLifecycle = "permanent" | "candidate-for-split";

  interface MaxLinesExceptionFields {
    readonly path: string;
    readonly cap: number;
    readonly severity: MaxLinesSeverity;
    readonly reason: string;
    readonly lifecycle: MaxLinesLifecycle;
    readonly ratchetExcluded: boolean;
  }

  type MaxLinesExceptionParse =
    | { readonly ok: true; readonly value: MaxLinesExceptionFields; readonly error: null }
    | { readonly ok: false; readonly value: null; readonly error: string };

  export const MAX_LINES_EXCEPTIONS_TOOL: "eslint-max-lines";
  export const MAX_LINES_EXCEPTIONS_METRIC: "file-line-cap-exceptions";
  export function parseMaxLinesExceptionEntry(raw: unknown): MaxLinesExceptionParse;
}

declare module "*eslint-rules/max-lines.js" {
  import type { Rule, SourceCode } from "eslint";

  export const MAX_LINES_SPLIT_GUIDANCE: string;
  export const MAX_LINES_METRIC_GUIDANCE: string;

  export function effectiveLines(
    sourceCode: SourceCode,
    options: { readonly skipBlankLines: boolean; readonly skipComments: boolean },
  ): ReadonlyArray<{ readonly lineNumber: number; readonly text: string }>;

  const rule: Rule.RuleModule;
  export default rule;
}

declare module "*eslint-rules/shared-schema-prefix.js" {
  export const SHARED_SCHEMA_PREFIX: string;
}
