import { maxLinesPolicy } from "../eslint-config/shared-policy.js";
import type { LintRatchetZeroBaselineDisposition } from "./lint-ratchet/zero-baseline-types.js";
import {
  coreComplexityRatchet,
  coreNoMagicNumbersRatchet,
  localMaxLinesRatchet,
  localTypeAssertionBoundaryRatchet,
  regexpNoUnusedCapturingGroupRatchet,
  vitestValidExpectRatchet,
} from "./lint-ratchet-registry-builders.js";

type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "complexity-severity" | "effective-line-count" | "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export interface LintRatchetCoreSource {
  readonly kind: "core";
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource
  | LintRatchetCoreSource;

type MaxLinesRatchetPolicy = (typeof maxLinesPolicy.ratchets)[number];

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly target: number;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
  readonly allowEmpty?: boolean;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

// This union intentionally rejects type-aware local entries; see Leaf 22
// Review Cycle F3.
export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetCoreSource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

// prettier-ignore
export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] = [
  { pluginModule: "typescript-eslint", ruleNamespace: "@typescript-eslint", pluginExport: "plugin" },
  { pluginModule: "@vitest/eslint-plugin", ruleNamespace: "vitest", pluginExport: "default" },
  { pluginModule: "eslint-plugin-regexp", ruleNamespace: "regexp", pluginExport: "default" },
  { pluginModule: "eslint-plugin-simple-import-sort", ruleNamespace: "simple-import-sort", pluginExport: "default" },
];

function maxLinesRatchetById(id: string): MaxLinesRatchetPolicy {
  const ratchet = maxLinesPolicy.ratchets.find((entry) => entry.id === id);
  if (ratchet === undefined) {
    throw new Error(`maxLinesPolicy is missing ratchet ${id}`);
  }
  return ratchet;
}

const maxLinesCodeIntelRatchet = maxLinesRatchetById("ratchet/local-max-lines-code-intel");
const maxLinesCodemodsRatchet = maxLinesRatchetById("ratchet/local-max-lines-codemods");
const maxLinesDriftAiRatchet = maxLinesRatchetById("ratchet/local-max-lines-drift-ai");
const maxLinesGenerateHarnessControlsRatchet = maxLinesRatchetById(
  "ratchet/local-max-lines-generate-harness-controls",
);
const maxLinesLintCoverageMapRatchet = maxLinesRatchetById(
  "ratchet/local-max-lines-lint-coverage-map-check",
);
const maxLinesLogsAuditRatchet = maxLinesRatchetById("ratchet/local-max-lines-logs-audit");
const maxLinesRuntimeRatchet = maxLinesRatchetById("ratchet/local-max-lines-runtime");

// prettier-ignore
export const lintRatchets = [
  coreComplexityRatchet({
    id: "ratchet/core-complexity-codemods",
    parserProfile: "minimal-ts",
    files: ["scripts/codemods/**/*.ts"],
    ignores: [
      "scripts/codemods/**/*-codemod.test.ts",
      "scripts/codemods/**/*.test.ts",
      "scripts/codemods/fixtures/**",
    ],
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint intentionally ignores the codemod implementation tree; this ratchet keeps a zero complexity floor for maintained codemod sources",
    },
  }),
  coreComplexityRatchet({
    id: "ratchet/core-complexity-drift-ai",
    parserProfile: "minimal-ts",
    files: ["scripts/drift-ai.ts", "scripts/drift-ai/**/*.ts"],
    ignores: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/**/*.test.ts",
      "scripts/drift-ai/fixtures/**",
    ],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has mixed complexity coverage for drift-ai script entrypoints; this ratchet keeps one max-10 floor across the selected drift-ai implementation family",
    },
  }),
  coreComplexityRatchet({
    id: "ratchet/core-complexity-eslint-rules",
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.js"],
    ignores: ["eslint-rules/*.test.js"],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has per-rule implementation complexity exceptions; this ratchet preserves the max-10 floor across non-test eslint rule sources",
    },
  }),
  coreComplexityRatchet({
    id: "ratchet/core-complexity-lint-ratchet-runtime",
    parserProfile: "minimal-ts",
    files: [
      "scripts/lint-ratchet-baseline-compare.ts",
      "scripts/lint-ratchet-baseline-parse.ts",
      "scripts/lint-ratchet-baseline.ts",
      "scripts/lint-ratchet-check-registry.ts",
      "scripts/lint-ratchet-metrics.ts",
      "scripts/lint-ratchet-output.ts",
      "scripts/lint-ratchet-report.ts",
      "scripts/lint-ratchet-summary.ts",
      "scripts/lint-ratchet.ts",
      "scripts/lint-ratchet/**/*.ts",
      "scripts/ratchet-manifest-message.ts",
    ],
    ignores: ["scripts/*.test.ts"],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint only un-ignores selected lint-ratchet scripts; this ratchet also covers runtime helper modules under the same max-10 complexity floor",
    },
  }),
  coreComplexityRatchet({
    id: "ratchet/core-complexity-top-level-scripts",
    parserProfile: "type-aware-ts",
    files: [
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/lint-coverage-map-check.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint keeps script-specific complexity overrides; this ratchet preserves a zero-drift floor for the named top-level scripts",
    },
  }),
  coreNoMagicNumbersRatchet({
    id: "ratchet/core-no-magic-numbers-eslint-rules",
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.js"],
    ignores: ["eslint-rules/*.test.js"],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint only warns for no-magic-numbers on custom rule sources and has per-rule suppressions; this ratchet keeps the zero message-count floor for eslint rule implementations",
    },
  }),
  coreNoMagicNumbersRatchet({
    id: "ratchet/core-no-magic-numbers-top-level-scripts",
    parserProfile: "type-aware-ts",
    files: [
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/lint-coverage-map-check.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    ignores: ["scripts/sensor-blob-size.test.ts"],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint turns off no-magic-numbers for selected CLI scripts; this ratchet keeps the numeric-literal floor limited to the named top-level scripts",
    },
  }),
  { id: "ratchet/core-preserve-caught-error-top-level-scripts", ruleId: "preserve-caught-error", source: { kind: "core" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint has mixed preserve-caught-error coverage and default options for these scripts; this ratchet keeps the stricter caught-error floor over the named top-level scripts" } },
  localMaxLinesRatchet({
    id: maxLinesCodeIntelRatchet.id,
    files: maxLinesCodeIntelRatchet.files,
    ignores: maxLinesCodeIntelRatchet.ignores,
    zeroBaselineDisposition: maxLinesCodeIntelRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesCodemodsRatchet.id,
    files: maxLinesCodemodsRatchet.files,
    ignores: maxLinesCodemodsRatchet.ignores,
    zeroBaselineDisposition: maxLinesCodemodsRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesDriftAiRatchet.id,
    files: maxLinesDriftAiRatchet.files,
    ignores: maxLinesDriftAiRatchet.ignores,
    zeroBaselineDisposition: maxLinesDriftAiRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesGenerateHarnessControlsRatchet.id,
    files: maxLinesGenerateHarnessControlsRatchet.files,
    ignores: maxLinesGenerateHarnessControlsRatchet.ignores,
    zeroBaselineDisposition: maxLinesGenerateHarnessControlsRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesLintCoverageMapRatchet.id,
    files: maxLinesLintCoverageMapRatchet.files,
    ignores: maxLinesLintCoverageMapRatchet.ignores,
    zeroBaselineDisposition: maxLinesLintCoverageMapRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesLogsAuditRatchet.id,
    files: maxLinesLogsAuditRatchet.files,
    ignores: maxLinesLogsAuditRatchet.ignores,
    zeroBaselineDisposition: maxLinesLogsAuditRatchet.zeroBaselineDisposition,
  }),
  localMaxLinesRatchet({
    id: maxLinesRuntimeRatchet.id,
    files: maxLinesRuntimeRatchet.files,
    ignores: maxLinesRuntimeRatchet.ignores,
    zeroBaselineDisposition: maxLinesRuntimeRatchet.zeroBaselineDisposition,
  }),
  localTypeAssertionBoundaryRatchet({
    id: "ratchet/local-type-assertion-boundary",
    files: [
      "e2e/**/*.ts",
      "packages/**/*.{ts,tsx}",
      "scripts/**/*.ts",
    ],
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      // Codemod fixtures are snapshots of historical source patterns used as
      // before/after test inputs. They aren't live code (the global ESLint
      // config ignores `scripts/**/*` and only re-includes code-intel, drift,
      // and generate-lint-guidance), so the ratchet should match that policy
      // instead of demanding boundary labels on synthesized fixture casts.
      "scripts/codemods/fixtures/**",
    ],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint enforces local/type-assertion-boundary only on e2e and selected re-included scripts; this broader ratchet keeps a zero floor across packages, e2e, and script code",
    },
  }),
  { id: "ratchet/regexp-no-super-linear-backtracking-script-tests", ruleId: "regexp/no-super-linear-backtracking", source: { kind: "third-party", pluginModule: "eslint-plugin-regexp" }, parserProfile: "minimal-ts", files: ["scripts/lint-ratchet-baseline.test.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint explicitly turns off regexp/no-super-linear-backtracking for the lint-ratchet baseline test; this ratchet keeps the selected script-test zero floor" } },
  regexpNoUnusedCapturingGroupRatchet({
    id: "ratchet/regexp-no-unused-capturing-group-eslint-rules",
    files: ["eslint-rules/*.js"],
    ignores: ["eslint-rules/*.test.js"],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has per-rule regexp/no-unused-capturing-group suppressions for custom rule implementations; this ratchet preserves the zero floor across non-test eslint rule sources",
    },
  }),
  regexpNoUnusedCapturingGroupRatchet({
    id: "ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check",
    files: ["scripts/lint-coverage-map-check.ts"],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint explicitly turns off regexp/no-unused-capturing-group for the lint coverage map checker; this ratchet keeps a zero floor for that single script",
    },
  }),
  {
    id: "ratchet/regexp-no-useless-non-capturing-group-eslint-rules", ruleId: "regexp/no-useless-non-capturing-group", source: { kind: "third-party", pluginModule: "eslint-plugin-regexp" }, parserProfile: "minimal-ts", files: ["eslint-rules/*.js"], ignores: ["eslint-rules/*.test.js"], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual",
    zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint has per-rule regexp/no-useless-non-capturing-group suppressions for custom rule implementations; this ratchet preserves the zero floor across non-test eslint rule sources" },
  },
  {
    id: "ratchet/strict-boolean-expressions-shared",
    ruleId: "@typescript-eslint/strict-boolean-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: ["packages/shared/src/**/*.{ts,tsx}"],
    ignores: [
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
      "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
      "packages/shared/src/**/*.test-helper.{ts,tsx}",
      "packages/shared/src/test/**/*.{ts,tsx}",
    ],
    ruleOptions: [
      {
        allowAny: false,
        allowNullableBoolean: false,
        allowNullableEnum: false,
        allowNullableNumber: false,
        allowNullableObject: true,
        allowNullableString: false,
        allowNumber: false,
        allowString: false,
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this ratchet preserves a shared-package zero floor without forcing a package-wide rollout",
    },
  },
  { id: "ratchet/typescript-eslint-explicit-function-return-type-script-tests", ruleId: "@typescript-eslint/explicit-function-return-type", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/code-intel.test.ts", "scripts/lint-ratchet-baseline.test.ts"], ignores: [], ruleOptions: [{ allowExpressions: true, allowTypedFunctionExpressions: true, allowHigherOrderFunctions: true }], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint explicitly turns off explicit return types for these script-test singletons; this ratchet keeps the same-option zero floor over the selected files" } },
  {
    id: "ratchet/typescript-eslint-no-misused-promises-codemod-tests",
    ruleId: "@typescript-eslint/no-misused-promises",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: [
      "scripts/codemods/concurrency-guard.test.ts",
      "scripts/codemods/expand-barrel.test.ts",
      "scripts/codemods/structured-logging-fix.test.ts",
      "scripts/codemods/trpc-shared-schema-codemod.test.ts",
    ],
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint intentionally ignores codemod test files; this ratchet keeps the no-misused-promises zero floor for maintained codemod tests",
    },
  },
  { id: "ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts", ruleId: "@typescript-eslint/no-unsafe-argument", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint has mixed no-unsafe-argument coverage for the named top-level scripts; this ratchet keeps the selected script floor without broadening normal lint" } },
  { id: "ratchet/typescript-eslint-no-unsafe-assignment-script-tests", ruleId: "@typescript-eslint/no-unsafe-assignment", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/code-intel.test.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint explicitly turns off no-unsafe-assignment for scripts/code-intel.test.ts; this ratchet keeps the singleton script-test zero floor" } },
  {
    id: "ratchet/typescript-eslint-only-throw-error-codemod-tests",
    ruleId: "@typescript-eslint/only-throw-error",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: [
      "scripts/codemods/concurrency-guard.test.ts",
      "scripts/codemods/expand-barrel.test.ts",
      "scripts/codemods/structured-logging-fix.test.ts",
      "scripts/codemods/trpc-shared-schema-codemod.test.ts",
    ],
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint intentionally ignores codemod test files; this ratchet keeps the only-throw-error zero floor for maintained codemod tests",
    },
  },
  { id: "ratchet/typescript-eslint-require-await-script-singletons", ruleId: "@typescript-eslint/require-await", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/code-intel.test.ts", "scripts/lint-coverage-map-check.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint explicitly turns off require-await for these singleton script files; this ratchet keeps their zero floor without changing normal script lint policy" } },
  {
    id: "ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts",
    ruleId: "@typescript-eslint/restrict-template-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: [
      "scripts/code-intel.test.ts",
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    ignores: [],
    ruleOptions: [
      {
        allowAny: false,
        allowBoolean: false,
        allowNever: false,
        allowNullish: false,
        allowNumber: false,
        allowRegExp: false,
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has mixed coverage and allows numeric template expressions in CLI script overrides; this ratchet keeps a stricter allowNumber:false floor for the selected top-level scripts",
    },
  },
  { id: "ratchet/typescript-eslint-unbound-method-top-level-scripts", ruleId: "@typescript-eslint/unbound-method", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal ESLint has mixed unbound-method coverage for the named top-level scripts, including a harness emitter suppression; this ratchet keeps the selected script floor" } },
  {
    id: "ratchet/vitest-expect-expect-codemod-tests",
    ruleId: "vitest/expect-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: [
      "scripts/codemods/concurrency-guard.test.ts",
      "scripts/codemods/expand-barrel.test.ts",
      "scripts/codemods/structured-logging-fix.test.ts",
      "scripts/codemods/trpc-shared-schema-codemod.test.ts",
    ],
    ignores: [],
    ruleOptions: [
      {
        assertFunctionNames: [
          "expect",
          "assertNonPermissiveOutput",
          "expectClean",
          "expectHit",
          "expectOneFulfilledOneConflict",
          "expectParseFailure",
          "expectParseSuccess",
          "runFixture",
        ],
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint intentionally ignores codemod test files; this ratchet keeps the codemod-test expect-expect floor with the codemod helper allowlist",
    },
  },
  {
    id: "ratchet/vitest-expect-expect-drift-ai-tests",
    ruleId: "vitest/expect-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/comments.test.ts",
      "scripts/drift-ai/current-inventory.test.ts",
      "scripts/drift-ai/duplicates.test.ts",
      "scripts/drift-ai/ghost-files.test.ts",
      "scripts/drift-ai/harness-freshness.test.ts",
      "scripts/drift-ai/suppressions.test.ts",
    ],
    ignores: [],
    ruleOptions: [
      {
        assertFunctionNames: ["expect"],
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint uses resolved plugin defaults for expect-expect; this drift-ai ratchet narrows the assertFunctionNames allowlist to expect only",
    },
  },
  { id: "ratchet/vitest-expect-expect-script-tests", ruleId: "vitest/expect-expect", source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" }, parserProfile: "minimal-ts", files: ["scripts/code-intel.test.ts", "scripts/lint-coverage-map-check.test.ts", "scripts/lint-ratchet-baseline.test.ts"], ignores: [], ruleOptions: [{ assertFunctionNames: ["expect", "assertNonPermissiveOutput", "expectClean", "expectHit", "expectOneFulfilledOneConflict", "expectParseFailure", "expectParseSuccess"] }], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal Vitest lint resolves extra plugin-default expect-expect options; this ratchet pins the assertFunctionNames allowlist (expect plus the named script-test helpers) scoped to the selected script tests" } },
  {
    id: "ratchet/vitest-no-commented-out-tests-eslint-rules-tests",
    ruleId: "vitest/no-commented-out-tests",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.test.js"],
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has a RuleTester-specific commented-out-test suppression in the custom rule test family; this ratchet preserves the zero floor across eslint-rules tests",
    },
  },
  {
    id: "ratchet/vitest-no-conditional-expect-eslint-rules-tests",
    ruleId: "vitest/no-conditional-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.test.js"],
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint has a RuleTester-specific conditional-expect suppression in the custom rule test family; this ratchet preserves the zero floor across eslint-rules tests",
    },
  },
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-codemod-tests",
    files: [
      "scripts/codemods/concurrency-guard.test.ts",
      "scripts/codemods/expand-barrel.test.ts",
      "scripts/codemods/structured-logging-fix.test.ts",
      "scripts/codemods/trpc-shared-schema-codemod.test.ts",
    ],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint intentionally ignores codemod test files; this ratchet keeps the codemod-test valid-expect floor with the maxArgs:2 option",
    },
  }),
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-drift-ai-tests",
    files: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/comments.test.ts",
      "scripts/drift-ai/current-inventory.test.ts",
      "scripts/drift-ai/duplicates.test.ts",
      "scripts/drift-ai/ghost-files.test.ts",
      "scripts/drift-ai/harness-freshness.test.ts",
      "scripts/drift-ai/suppressions.test.ts",
    ],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this drift-ai ratchet keeps the selected test-family floor",
    },
  }),
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-script-tests",
    files: [
      "scripts/code-intel.test.ts",
      "scripts/lint-coverage-map-check.test.ts",
      "scripts/lint-ratchet-baseline.test.ts",
    ],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this ratchet keeps the selected script-test floor",
    },
  }),
] as const satisfies readonly LintRatchetConfig[];
