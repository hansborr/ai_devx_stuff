import {
  scriptFixtureIgnores,
  scriptTestAssertFunctionNames,
} from "../../eslint-config/shared-policy.js";
import {
  localTypeAssertionBoundaryRatchet,
  vitestValidExpectRatchet,
} from "./lint-ratchet-registry-builders.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

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
  { pluginModule: "eslint-plugin-playwright", ruleNamespace: "playwright", pluginExport: "default" },
  { pluginModule: "eslint-plugin-regexp", ruleNamespace: "regexp", pluginExport: "default" },
  { pluginModule: "eslint-plugin-simple-import-sort", ruleNamespace: "simple-import-sort", pluginExport: "default" },
];

const e2eTypeScriptFiles = ["e2e/**/*.ts"] as const;
const driftAiVitestTestFiles = [
  "scripts/drift-ai.test.ts",
  "scripts/drift-ai/**/*.test.ts",
] as const;
const driftAiVitestTestIgnores = ["scripts/drift-ai/fixtures/**"] as const;

// prettier-ignore
export const lintRatchets = [
  {
    id: "ratchet/local-e2e-prefer-role-selectors",
    ruleId: "local/e2e-prefer-role-selectors",
    files: e2eTypeScriptFiles,
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
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
      ...scriptFixtureIgnores,
      "scripts/vitest.config.ts",
    ],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint enforces local/type-assertion-boundary on e2e and maintained script TypeScript; this ratchet keeps the package TypeScript zero floor without pulling script fixtures or script config files into the runtime-script policy",
    },
  }),
  {
    id: "ratchet/playwright-no-nth-methods-e2e",
    ruleId: "playwright/no-nth-methods",
    source: { kind: "third-party", pluginModule: "eslint-plugin-playwright" },
    parserProfile: "minimal-ts",
    files: e2eTypeScriptFiles,
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/playwright-prefer-native-locators-e2e",
    ruleId: "playwright/prefer-native-locators",
    source: { kind: "third-party", pluginModule: "eslint-plugin-playwright" },
    parserProfile: "minimal-ts",
    files: e2eTypeScriptFiles,
    ignores: [],
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
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
  {
    id: "ratchet/vitest-expect-expect-drift-ai-tests",
    ruleId: "vitest/expect-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: driftAiVitestTestFiles,
    ignores: driftAiVitestTestIgnores,
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
  { id: "ratchet/vitest-expect-expect-script-tests", ruleId: "vitest/expect-expect", source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" }, parserProfile: "minimal-ts", files: ["scripts/code-intel.test.ts", "scripts/lint-coverage-map-check.test.ts", "scripts/lint-ratchet/lint-ratchet-baseline.test.ts"], ignores: [], ruleOptions: [{ assertFunctionNames: scriptTestAssertFunctionNames }], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal Vitest lint resolves extra plugin-default expect-expect options; this ratchet pins the assertFunctionNames allowlist (expect plus the named script-test helpers) scoped to the selected script tests" } },
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-drift-ai-tests",
    files: driftAiVitestTestFiles,
    ignores: driftAiVitestTestIgnores,
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
      "scripts/lint-ratchet/lint-ratchet-baseline.test.ts",
    ],
    ignores: [],
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this ratchet keeps the selected script-test floor",
    },
  }),
] as const satisfies readonly LintRatchetConfig[];
