import {
  clientSourceFiles,
  clientTestAndHelperSourceFiles,
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
  // Single source of truth for the harness-controls doc "Principle" line. The
  // generated harness-controls.md re-projects this from the registry (the same
  // way lint-rule principles flow from meta.docs); ratchet entries in
  // harness.controls.json must NOT restate it. Distinct from
  // zeroBaselineDisposition.reason, which answers a different question (why this
  // disposition when the ratchet reaches zero findings).
  readonly principle: string;
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
  { pluginModule: "eslint-plugin-react-hooks", ruleNamespace: "react-hooks", pluginExport: "default" },
  { pluginModule: "eslint-plugin-playwright", ruleNamespace: "playwright", pluginExport: "default" },
  { pluginModule: "eslint-plugin-regexp", ruleNamespace: "regexp", pluginExport: "default" },
  { pluginModule: "eslint-plugin-simple-import-sort", ruleNamespace: "simple-import-sort", pluginExport: "default" },
  { pluginModule: "eslint-plugin-testing-library", ruleNamespace: "testing-library", pluginExport: "default" },
];

// testing-library implementation-detail debt floors (leaf 06). Normal lint
// enables the clean testing-library/flat-react rules at error on client
// component tests; these three carry existing debt, so they are held as
// message-count floors here and turned off in normal lint until drained.
const testingLibraryClientTestFiles = ["packages/client/src/**/*.test.tsx"] as const;
const testingLibraryRatchetIgnores = [
  "**/dist/**",
  "**/generated/**",
  "**/node_modules/**",
] as const;
const testingLibraryDrainExitPath = "docs/agent_notes/finished_work/lint-followups-2026-06.md";

const driftAiVitestTestFiles = [
  "scripts/drift-ai.test.ts",
  "scripts/drift-ai/**/*.test.ts",
] as const;
const driftAiVitestTestIgnores = ["scripts/drift-ai/fixtures/**"] as const;
const designTokenLintExitPath =
  "docs/agent_notes/backlog/harness-research-followups-2026-06/02-design-token-lint.md";

// prettier-ignore
export const lintRatchets = [
  {
    id: "ratchet/local-no-arbitrary-tailwind-value-client",
    ruleId: "local/no-arbitrary-tailwind-value",
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Freeze the accepted client arbitrary Tailwind bracket-value inventory so new one-off class values fail while the design-token cleanup drains incrementally.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "client class strings should use DESIGN.md and packages/client/src/app.css @theme tokens; once the existing arbitrary-value inventory drains, normal lint should enforce the rule directly",
      exitPath: designTokenLintExitPath,
    },
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
    principle: "Prevent the known type-assertion debt pool from growing while cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint enforces local/type-assertion-boundary on e2e and maintained script TypeScript; this ratchet keeps the package TypeScript zero floor without pulling script fixtures or script config files into the runtime-script policy",
    },
  }),
  {
    id: "ratchet/react-hooks-set-state-in-effect-client",
    ruleId: "react-hooks/set-state-in-effect",
    source: { kind: "third-party", pluginModule: "eslint-plugin-react-hooks" },
    parserProfile: "minimal-ts",
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Freeze the accepted set-state-in-effect floor so finding #25 fails at commit time while cleanup proceeds opportunistically.",
  },
  {
    id: "ratchet/strict-boolean-expressions-server-encounter-combat",
    ruleId: "@typescript-eslint/strict-boolean-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: ["packages/server/src/services/encounter-combat/**/*.{ts,tsx}"],
    ignores: [
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
      "packages/server/src/**/*-test-helper.{ts,tsx}",
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/test/**/*.{ts,tsx}",
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
    principle: "Hold a strict-boolean-expressions zero floor over the packages/server/src/services/encounter-combat slice while package-wide server cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this ratchet extends the zero floor to the server encounter-combat slice without forcing a package-wide rollout",
    },
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
    principle: "Prevent strict-boolean-expressions debt from growing in packages/shared/src production code while cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this ratchet preserves a shared-package zero floor without forcing a package-wide rollout",
    },
  },
  {
    id: "ratchet/testing-library-no-container-client-tests",
    ruleId: "testing-library/no-container",
    source: { kind: "third-party", pluginModule: "eslint-plugin-testing-library" },
    parserProfile: "minimal-ts",
    files: testingLibraryClientTestFiles,
    ignores: testingLibraryRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Prevent render-result container querying (testing-library/no-container) in client component tests from growing past the leaf 06 inventory while the debt drains toward normal-lint promotion.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "querying through the render() container in client component tests bypasses Testing Library queries; floored at the leaf 06 inventory and promoted to normal-lint error once the debt drains to zero",
      exitPath: testingLibraryDrainExitPath,
    },
  },
  {
    id: "ratchet/testing-library-no-node-access-client-tests",
    ruleId: "testing-library/no-node-access",
    source: { kind: "third-party", pluginModule: "eslint-plugin-testing-library" },
    parserProfile: "minimal-ts",
    files: testingLibraryClientTestFiles,
    ignores: testingLibraryRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Prevent direct DOM-node access (testing-library/no-node-access) in client component tests from growing past the leaf 06 inventory while the debt drains toward normal-lint promotion.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "direct DOM-node access in client component tests bypasses Testing Library queries; floored at the leaf 06 inventory and promoted to normal-lint error once the debt drains to zero",
      exitPath: testingLibraryDrainExitPath,
    },
  },
  {
    id: "ratchet/testing-library-prefer-screen-queries-client-tests",
    ruleId: "testing-library/prefer-screen-queries",
    source: { kind: "third-party", pluginModule: "eslint-plugin-testing-library" },
    parserProfile: "minimal-ts",
    files: testingLibraryClientTestFiles,
    ignores: testingLibraryRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: "Prevent destructured render() queries (testing-library/prefer-screen-queries) in client component tests from growing past the leaf 06 inventory while the debt drains toward normal-lint promotion.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "queries destructured from render() instead of screen in client component tests; floored at the leaf 06 inventory and promoted to normal-lint error once the debt drains to zero",
      exitPath: testingLibraryDrainExitPath,
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
    principle: "Keep the drift-ai test expect-expect floor pinned to assertFunctionNames [\"expect\"] only, stricter than the resolved plugin defaults normal lint applies (keep verdict, lint-review-2026-06 leaf 03e).",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint uses resolved plugin defaults for expect-expect; this drift-ai ratchet narrows the assertFunctionNames allowlist to expect only",
    },
  },
  { id: "ratchet/vitest-expect-expect-script-tests", ruleId: "vitest/expect-expect", source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" }, parserProfile: "minimal-ts", files: ["scripts/code-intel.test.ts", "scripts/lint-coverage-map-check.test.ts", "scripts/lint-ratchet/lint-ratchet-baseline.test.ts"], ignores: [], ruleOptions: [{ assertFunctionNames: scriptTestAssertFunctionNames }], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual", principle: "Prevent singleton script tests without recognized assertions from growing now that the final Leaf 41g test rows are linted.", zeroBaselineDisposition: { kind: "narrow-floor", reason: "normal Vitest lint resolves extra plugin-default expect-expect options; this ratchet pins the assertFunctionNames allowlist (expect plus the named script-test helpers) scoped to the selected script tests" } },
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-drift-ai-tests",
    files: driftAiVitestTestFiles,
    ignores: driftAiVitestTestIgnores,
    principle: "Keep the drift-ai test valid-expect floor pinned to maxArgs 2, stricter than the resolved plugin defaults normal lint applies (keep verdict, lint-review-2026-06 leaf 03e).",
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
    principle: "Prevent malformed Vitest expect calls in the newly linted singleton script tests while Leaf 41 drain work proceeds.",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this ratchet keeps the selected script-test floor",
    },
  }),
] as const satisfies readonly LintRatchetConfig[];
