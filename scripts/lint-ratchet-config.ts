type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";
export type LintRatchetMetric = "effective-line-count" | "message-count";
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

export type LintRatchetRuleSource = LintRatchetLocalSource | LintRatchetThirdPartySource | LintRatchetCoreSource;

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

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] = [
  { pluginModule: "typescript-eslint", ruleNamespace: "@typescript-eslint", pluginExport: "plugin" },
  { pluginModule: "@vitest/eslint-plugin", ruleNamespace: "vitest", pluginExport: "default" },
  { pluginModule: "eslint-plugin-regexp", ruleNamespace: "regexp", pluginExport: "default" },
  { pluginModule: "eslint-plugin-simple-import-sort", ruleNamespace: "simple-import-sort", pluginExport: "default" },
];

export const lintRatchets = [
  {
    id: "ratchet/core-complexity-codemods",
    ruleId: "complexity",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["scripts/codemods/**/*.ts"],
    ignores: [
      "scripts/codemods/**/*-codemod.test.ts",
      "scripts/codemods/**/*.test.ts",
      "scripts/codemods/fixtures/**",
    ],
    ruleOptions: [{ max: 10 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/core-complexity-drift-ai",
    ruleId: "complexity",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["scripts/drift-ai.ts", "scripts/drift-ai/**/*.ts"],
    ignores: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/**/*.test.ts",
      "scripts/drift-ai/fixtures/**",
    ],
    ruleOptions: [{ max: 10 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/core-complexity-eslint-rules",
    ruleId: "complexity",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.js"],
    ignores: ["eslint-rules/*.test.js"],
    ruleOptions: [{ max: 10 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/core-complexity-top-level-scripts",
    ruleId: "complexity",
    source: { kind: "core" },
    parserProfile: "type-aware-ts",
    files: [
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    ignores: [],
    ruleOptions: [{ max: 10 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/core-no-magic-numbers-eslint-rules",
    ruleId: "no-magic-numbers",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["eslint-rules/*.js"],
    ignores: ["eslint-rules/*.test.js"],
    ruleOptions: [
      {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true,
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/core-no-magic-numbers-top-level-scripts",
    ruleId: "no-magic-numbers",
    source: { kind: "core" },
    parserProfile: "type-aware-ts",
    files: [
      "scripts/db-status.ts",
      "scripts/harness-emit-envelope.ts",
      "scripts/sensor-blob-size.test.ts",
      "scripts/sensor-blob-size.ts",
    ],
    ignores: ["scripts/sensor-blob-size.test.ts"],
    ruleOptions: [
      {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true,
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  { id: "ratchet/core-preserve-caught-error-top-level-scripts", ruleId: "preserve-caught-error", source: { kind: "core" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual" },
  {
    id: "ratchet/local-max-lines",
    ruleId: "local/max-lines",
    files: [
      "e2e/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
      "packages/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
      "scripts/code-intel/**/*.ts",
      "scripts/drift/**/*.ts",
      "scripts/generate-lint-guidance.ts",
    ],
    ignores: [
      "**/*.config.{js,mjs,ts}",
      "**/*.spec.ts",
      "**/*.test.{ts,tsx}",
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
      // These exact paths mirror the higher-cap `local/max-lines` overrides
      // in eslint.config.js. When renaming a file in this list, update the
      // matching entry in eslint.config.js. See docs/guides/lint-ratchet.md.
      "packages/client/src/components/campaign/encounters/add-participant-dialog.tsx",
      "packages/client/src/components/campaign/encounters/encounter-detail-view.tsx",
      "packages/client/src/components/campaign/notes/notes-panel.tsx",
      "packages/client/src/components/campaign/npcs/monster-tab.tsx",
      "packages/client/src/components/campaign/npcs/npc-panel.tsx",
      "packages/client/src/components/homebrew/entries/entry-dialog.tsx",
      "packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx",
      "packages/client/src/components/homebrew/monster/monster-form-data.ts",
      "packages/client/src/components/homebrew/monster/monster-form-fields.tsx",
      "packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx",
      "packages/client/src/pages/settings-page.tsx",
      "packages/client/src/stores/map-canvas-store.ts",
      "packages/client/src/test/fixtures-encounter.ts",
      "packages/client/src/test/fixtures-srd.ts",
      "packages/client/src/test/mock-trpc.tsx",
      "packages/server/src/routers/encounter.ts",
      "packages/server/src/routers/homebrew.ts",
      "packages/server/src/routers/srd.ts",
      "packages/server/src/services/rest-service.ts",
      "packages/shared/src/rules/attack-damage.ts",
    ],
    ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
  },
  { id: "ratchet/local-max-lines-code-intel", ruleId: "local/max-lines", files: ["scripts/code-intel.ts"], ignores: [], ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }], mode: "no-new", target: 0, metric: "effective-line-count", repairKind: "manual" },
  {
    id: "ratchet/local-max-lines-codemods",
    ruleId: "local/max-lines",
    files: ["scripts/codemods/**/*.ts"],
    ignores: [
      "scripts/codemods/**/*-codemod.test.ts",
      "scripts/codemods/**/*.test.ts",
      "scripts/codemods/fixtures/**",
    ],
    ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/local-max-lines-drift-ai",
    ruleId: "local/max-lines",
    files: ["scripts/drift-ai.ts", "scripts/drift-ai/**/*.ts"],
    ignores: [
      "scripts/drift-ai.test.ts",
      "scripts/drift-ai/**/*.test.ts",
      "scripts/drift-ai/fixtures/**",
    ],
    ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
  },
  { id: "ratchet/local-max-lines-generate-harness-controls", ruleId: "local/max-lines", files: ["scripts/generate-harness-controls.ts"], ignores: [], ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }], mode: "no-new", target: 0, metric: "effective-line-count", repairKind: "manual" },
  { id: "ratchet/local-max-lines-logs-audit", ruleId: "local/max-lines", files: ["scripts/logs-audit.ts"], ignores: [], ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }], mode: "no-new", target: 0, metric: "effective-line-count", repairKind: "manual" },
  {
    id: "ratchet/local-max-lines-runtime",
    ruleId: "local/max-lines",
    files: [
      "scripts/harness-check.ts",
      "scripts/lint-agent.ts",
      "scripts/lint-ratchet-baseline.ts",
      "scripts/lint-ratchet.ts",
    ],
    ignores: ["scripts/*.test.ts"],
    ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/local-type-assertion-boundary",
    ruleId: "local/type-assertion-boundary",
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
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/regexp-no-unused-capturing-group-eslint-rules", ruleId: "regexp/no-unused-capturing-group", source: { kind: "third-party", pluginModule: "eslint-plugin-regexp" }, parserProfile: "minimal-ts", files: ["eslint-rules/*.js"], ignores: ["eslint-rules/*.test.js"], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual",
  },
  {
    id: "ratchet/regexp-no-useless-non-capturing-group-eslint-rules", ruleId: "regexp/no-useless-non-capturing-group", source: { kind: "third-party", pluginModule: "eslint-plugin-regexp" }, parserProfile: "minimal-ts", files: ["eslint-rules/*.js"], ignores: ["eslint-rules/*.test.js"], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual",
  },
  { id: "ratchet/simple-import-sort-imports-top-level-scripts", ruleId: "simple-import-sort/imports", source: { kind: "third-party", pluginModule: "eslint-plugin-simple-import-sort" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual" },
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
  },
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
  },
  {
    id: "ratchet/typescript-eslint-no-misused-promises-drift-ai-tests",
    ruleId: "@typescript-eslint/no-misused-promises",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
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
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  { id: "ratchet/typescript-eslint-no-unsafe-argument-top-level-scripts", ruleId: "@typescript-eslint/no-unsafe-argument", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual" },
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
  },
  {
    id: "ratchet/typescript-eslint-only-throw-error-drift-ai-tests",
    ruleId: "@typescript-eslint/only-throw-error",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
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
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/typescript-eslint-restrict-template-expressions-top-level-scripts",
    ruleId: "@typescript-eslint/restrict-template-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: [
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
  },
  { id: "ratchet/typescript-eslint-unbound-method-top-level-scripts", ruleId: "@typescript-eslint/unbound-method", source: { kind: "third-party", pluginModule: "typescript-eslint" }, parserProfile: "type-aware-ts", files: ["scripts/db-status.ts", "scripts/harness-emit-envelope.ts", "scripts/sensor-blob-size.test.ts", "scripts/sensor-blob-size.ts"], ignores: [], ruleOptions: [], mode: "no-new", target: 0, metric: "message-count", repairKind: "manual" },
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
        ],
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
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
  },
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
  },
  {
    id: "ratchet/vitest-valid-expect-codemod-tests",
    ruleId: "vitest/valid-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: [
      "scripts/codemods/concurrency-guard.test.ts",
      "scripts/codemods/expand-barrel.test.ts",
      "scripts/codemods/structured-logging-fix.test.ts",
      "scripts/codemods/trpc-shared-schema-codemod.test.ts",
    ],
    ignores: [],
    ruleOptions: [{ maxArgs: 2 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
  {
    id: "ratchet/vitest-valid-expect-drift-ai-tests",
    ruleId: "vitest/valid-expect",
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
    ruleOptions: [{ maxArgs: 2 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
  },
] as const satisfies readonly LintRatchetConfig[];
