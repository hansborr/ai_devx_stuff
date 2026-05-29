// @ts-check

export const codeFiles = ["**/*.{js,cjs,mjs,ts,tsx,mts,cts}"];
export const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];

export const rootJsConfigFiles = ["eslint.config.js", "commitlint.config.js", "stryker.config.mjs"];
export const eslintConfigSupportFiles = ["eslint-config/*.js"];
export const eslintConfigJsFiles = [...rootJsConfigFiles, ...eslintConfigSupportFiles];

export const rootAndPackageTsConfigFiles = [
  "knip.config.ts",
  "playwright.config.ts",
  "vitest.config.ts",
  "vitest.slow.config.ts",
  "packages/client/vite.config.ts",
  "packages/client/vitest.config.ts",
  "packages/server/prisma.config.ts",
  "packages/server/vitest.config.ts",
  "packages/shared/vitest.config.ts",
];

export const tsConfigFiles = [
  ...rootAndPackageTsConfigFiles,
  "scripts/vitest.config.ts",
  "eslint-rules/vitest.config.ts",
];

export const rootConfigReincludePatterns = [
  ...rootJsConfigFiles.map((file) => `!${file}`),
  ...rootAndPackageTsConfigFiles.map((file) => `!${file}`),
];

export const lintedScriptFiles = [
  "scripts/code-intel/**/*.ts",
  "scripts/code-intel-server.ts",
  "scripts/code-intel.test.ts",
  "scripts/db-status.ts",
  "scripts/drift/**/*.ts",
  "scripts/drift-ai/**/*.ts",
  "scripts/drift-ai.test.ts",
  "scripts/drift-ai.ts",
  "scripts/eslint-config-shared-policy.d.ts",
  "scripts/generate-harness-controls.ts",
  "scripts/generate-lint-guidance.ts",
  "scripts/harness-check.ts",
  "scripts/harness-emit-envelope.ts",
  "scripts/harness-wrapper-slot*.ts",
  "scripts/lint-agent.ts",
  "scripts/lint-coverage-map-check-eslint-reach.ts",
  "scripts/lint-coverage-map-check.test.ts",
  "scripts/lint-coverage-map-check.ts",
  "scripts/lint-ratchet*.ts",
  "scripts/lint-rule-docs.ts",
  "scripts/logs-audit.test.ts",
  "scripts/logs-audit.ts",
  "scripts/path-policy*.ts",
  "scripts/sensor-blob-size.test.ts",
  "scripts/sensor-blob-size.ts",
];

const globstarSegment = "/**/";

/** @param {string} scriptFilePattern */
function flatConfigDirectoryReincludePatterns(scriptFilePattern) {
  const globstarIndex = scriptFilePattern.indexOf(globstarSegment);
  if (globstarIndex === -1) return [];

  // Global ignores prune ignored directories, so recursive script globs need
  // both the root directory and any descendant directories re-opened.
  const directoryPattern = scriptFilePattern.slice(0, globstarIndex);
  return [`!${directoryPattern}/`, `!${directoryPattern}/**/*/`];
}

/** @param {readonly string[]} scriptFilePatterns */
export function deriveLintedScriptReincludePatterns(scriptFilePatterns) {
  return scriptFilePatterns.flatMap((scriptFilePattern) => [
    ...flatConfigDirectoryReincludePatterns(scriptFilePattern),
    `!${scriptFilePattern}`,
  ]);
}

const nonScriptReincludePatterns = [
  // This is a TS config file, not a linted runtime script. It is re-included
  // from the scripts ignore so the config-file policy can lint it.
  "!scripts/vitest.config.ts",
];

export const lintedScriptReincludePatterns = [
  ...deriveLintedScriptReincludePatterns(lintedScriptFiles),
  ...nonScriptReincludePatterns,
];

export const testAndHelperFiles = [
  "**/*.{test,spec}.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/*test-helper*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "**/test/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
  "e2e/**/*.{js,cjs,mjs,ts,tsx,mts,cts}",
];

export const unitTestFiles = ["**/*.test.{ts,tsx}", "**/*.spec.ts"];
export const nonE2eTestIgnores = ["e2e/**/*", "**/e2e/**/*"];

export const sharedSourceFiles = ["packages/shared/src/**/*.{ts,tsx}"];
export const sharedTestAndHelperSourceFiles = [
  "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
  "packages/shared/src/**/*.test-helper.{ts,tsx}",
  "packages/shared/src/test/**/*.{ts,tsx}",
];

export const serverSourceFiles = ["packages/server/src/**/*.{ts,tsx}"];
export const serverTestAndHelperSourceFiles = [
  "packages/server/src/**/*.{test,spec}.{ts,tsx}",
  "packages/server/src/**/*.test-helper.{ts,tsx}",
  "packages/server/src/test/**/*.{ts,tsx}",
];

export const clientSourceFiles = ["packages/client/src/**/*.{ts,tsx}"];
export const clientTestAndHelperSourceFiles = [
  "packages/client/src/**/*.{test,spec}.{ts,tsx}",
  "packages/client/src/**/*.test-helper.{ts,tsx}",
  "packages/client/src/test/**/*.{ts,tsx}",
];

export const sharedSchemasBarrelRestrictedImportPattern = {
  regex: "^@musi/shared/schemas$",
  message:
    "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
};

export const processExitRestrictedSyntax = {
  selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
  message:
    "Avoid process.exit(...) outside CLI/bootstrap entrypoints. Set process.exitCode and return/throw so finally blocks, log flushing, and socket teardown can run. If this IS a terminating entrypoint, add the file to the allowlist override in eslint.config.js.",
};

export const processEnvRestrictedSyntax = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "Avoid reading process.env outside config/env.ts. Use serverEnv from packages/server/src/config/env.ts (or add the key there). For child-process spawn `env:` pass-through and the db-status admin tool, add the file to the allowlist override below.",
};

export const e2ePreferRoleSelectorAllowlist = [
  "e2e/helpers/auth.setup.ts",
  "e2e/homebrew-sharing.spec.ts",
  "e2e/navigation-errors.spec.ts",
  "e2e/page-objects/campaign-chat.po.ts",
  "e2e/page-objects/campaign-detail.po.ts",
  "e2e/page-objects/campaign-notes.po.ts",
  "e2e/page-objects/campaign-npcs.po.ts",
  "e2e/page-objects/campaign-settings.po.ts",
  "e2e/page-objects/campaigns.po.ts",
  "e2e/page-objects/character-sheet.po.ts",
  "e2e/page-objects/character-wizard.po.ts",
  "e2e/page-objects/encounter.po.ts",
  "e2e/page-objects/join.po.ts",
  "e2e/page-objects/login.po.ts",
  "e2e/page-objects/notification.po.ts",
  "e2e/page-objects/register.po.ts",
  "e2e/page-objects/spells-panel.po.ts",
  "e2e/page-objects/vtt-drawer.ts",
  "e2e/storage.setup.ts",
];

const maxLinesCountingOptions = { skipBlankLines: true, skipComments: true };

export const maxLinesPolicy = {
  counting: maxLinesCountingOptions,
  ratchetFloor: { cap: 300 },
  exceptions: [
    {
      path: "scripts/drift-ai.ts",
      cap: 1110,
      severity: "warn",
      reason:
        "Drift-AI entrypoint is still covered by the max-300 ratchet floor while its CLI orchestration is split.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/drift-ai/config.ts",
      cap: 470,
      severity: "warn",
      reason:
        "Drift-AI config parsing stays capped while the max-300 ratchet floor prevents renewed growth.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/drift-ai/duplicates.ts",
      cap: 440,
      severity: "warn",
      reason:
        "Drift-AI duplicate detection remains under a higher normal-lint cap while the ratchet floor tracks the split.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/drift-ai/ghost-files.ts",
      cap: 610,
      severity: "warn",
      reason:
        "Drift-AI ghost-file analysis remains under a higher normal-lint cap while the ratchet floor tracks the split.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/drift-ai/harness-freshness.ts",
      cap: 340,
      severity: "warn",
      reason:
        "Drift-AI harness freshness logic stays near the default cap while the ratchet floor prevents growth.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/drift-ai/suppressions.ts",
      cap: 470,
      severity: "warn",
      reason:
        "Drift-AI suppression parsing remains under a higher normal-lint cap while the ratchet floor tracks the split.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/generate-harness-controls.ts",
      cap: 390,
      severity: "warn",
      reason:
        "Harness-control generation is only partly re-included in normal lint, so the ratchet keeps the max-300 floor.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/harness-check.ts",
      cap: 450,
      severity: "warn",
      reason:
        "Harness-check runtime orchestration keeps a higher normal-lint cap while the runtime ratchet holds the floor.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/lint-ratchet-baseline.ts",
      cap: 730,
      severity: "warn",
      reason:
        "Lint-ratchet baseline handling keeps a higher normal-lint cap while the runtime ratchet holds the floor.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/lint-ratchet.ts",
      cap: 840,
      severity: "warn",
      reason:
        "Lint-ratchet CLI orchestration keeps a higher normal-lint cap while the runtime ratchet holds the floor.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/logs-audit.ts",
      cap: 690,
      severity: "warn",
      reason:
        "Logs-audit entrypoint is only partly re-included in normal lint, so the ratchet keeps the max-300 floor.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/lint-ratchet-config.ts",
      cap: 600,
      severity: "error",
      reason:
        "The ratchet registry grows as new ratchets land; the floor protects against accidental drift, not registry growth.",
      ratchetExcluded: true,
    },
    {
      path: "packages/shared/src/rules/attack-damage.ts",
      cap: 440,
      severity: "error",
      reason:
        "Rules-domain calculator has several tightly-coupled D&D damage branches pending a future rules refactor.",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/encounter.ts",
      cap: 480,
      severity: "warn",
      reason:
        "Encounter routing is still the main orchestration surface for combat and map workflows until split behind services.",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/homebrew.ts",
      cap: 470,
      severity: "warn",
      reason:
        "Homebrew routing carries several entry-type workflows while shared entry helpers are factored out.",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/srd.ts",
      cap: 490,
      severity: "warn",
      reason:
        "SRD routing is mostly read-side mapping and import/export glue, capped so routine endpoint edits stay bounded.",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/services/rest-service.ts",
      cap: 340,
      severity: "warn",
      reason:
        "Rest behavior has tightly related state transitions and persistence checks pending a future service split.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/entries/entry-dialog.tsx",
      cap: 350,
      severity: "warn",
      reason:
        "The homebrew entry dialog owns shared editor chrome for several entry kinds while repeated form sections settle.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx",
      cap: 330,
      severity: "warn",
      reason:
        "Magic item form fields are a dense schema-aligned surface pending obvious field-group extraction.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/monster/monster-form-fields.tsx",
      cap: 470,
      severity: "warn",
      reason:
        "Monster form fields mirror a large SRD/homebrew shape while the grouped form remains intact.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/monster/monster-form-data.ts",
      cap: 400,
      severity: "warn",
      reason:
        "Monster form data centralizes defaults and parse/serialize helpers without absorbing UI logic.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx",
      cap: 320,
      severity: "warn",
      reason:
        "The stats-tab roll panel is one compact VTT surface, with further roll modes expected to extract components.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/encounters/add-participant-dialog.tsx",
      cap: 330,
      severity: "warn",
      reason:
        "Add-participant combines search, selection, and encounter mutation glue until workflow growth justifies a split.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/encounters/encounter-detail-view.tsx",
      cap: 390,
      severity: "warn",
      reason:
        "Encounter detail coordinates combat, map, and participant panels while capped before more orchestration accumulates.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/notes/notes-panel.tsx",
      cap: 340,
      severity: "warn",
      reason:
        "Notes panel owns the note list, editor state, and campaign mutations until list/editor concerns split clearly.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/npcs/monster-tab.tsx",
      cap: 370,
      severity: "warn",
      reason: "Monster tab is the NPC-side view over monster reference data and related actions.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/npcs/npc-panel.tsx",
      cap: 320,
      severity: "warn",
      reason:
        "NPC panel coordinates list and selected-detail state while future workflows split list helpers out.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/pages/settings-page.tsx",
      cap: 340,
      severity: "warn",
      reason:
        "Settings is a page-level account/preferences surface capped until another settings area is added.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/fixtures-encounter.ts",
      cap: 410,
      severity: "warn",
      reason:
        "Encounter fixtures keep related test data in one canonical scenario module for client tests.",
      ratchetExcluded: true,
    },
    {
      path: "scripts/lint-coverage-map-check.ts",
      cap: 360,
      severity: "warn",
      reason:
        "Coverage-map checker still owns table parsing and ESLint reachability checks while a dedicated ratchet tracks the current over-300 split target.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/lint-ratchet-baseline-parse.ts",
      cap: 310,
      severity: "warn",
      reason:
        "Baseline parsing is just over the normal cap after formatter expansion; the runtime ratchet tracks the current over-300 split target.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/lint-ratchet-metrics.ts",
      cap: 390,
      severity: "warn",
      reason:
        "Ratchet metrics aggregation is still one parser/metric boundary while the runtime ratchet tracks the current over-300 split target.",
      ratchetExcluded: false,
    },
    {
      path: "scripts/path-policy-smoke-subjects.ts",
      cap: 385,
      severity: "warn",
      reason:
        "Smoke subject data is one flat lookup table keyed by test name and grows with smoke tests, not logic.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/fixtures-srd.ts",
      cap: 380,
      severity: "warn",
      reason:
        "SRD fixtures are cross-cutting reference data for client tests until another fixture family appears.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/mock-trpc.tsx",
      cap: 600,
      severity: "error",
      reason:
        "The tRPC mock is the shared client test harness for provider setup and mock procedure plumbing.",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/stores/map-canvas-store.ts",
      cap: 530,
      severity: "warn",
      reason:
        "Map canvas state is centralized around one store boundary while future map workflows move to helper slices.",
      ratchetExcluded: true,
    },
  ],
  ratchets: [
    {
      id: "ratchet/local-max-lines-code-intel",
      files: ["scripts/code-intel.ts"],
      ignores: [],
      zeroBaselineDisposition: {
        kind: "intentional-ratchet-only",
        reason:
          "normal ESLint intentionally does not re-include scripts/code-intel.ts; this ratchet keeps its max-300 effective-line floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
    {
      id: "ratchet/local-max-lines-codemods",
      files: ["scripts/codemods/**/*.ts"],
      ignores: [
        "scripts/codemods/**/*-codemod.test.ts",
        "scripts/codemods/**/*.test.ts",
        "scripts/codemods/fixtures/**",
      ],
      zeroBaselineDisposition: {
        kind: "intentional-ratchet-only",
        reason:
          "normal ESLint intentionally ignores codemod implementation files; this ratchet keeps the codemod max-300 effective-line floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
    {
      id: "ratchet/local-max-lines-drift-ai",
      files: ["scripts/drift-ai.ts", "scripts/drift-ai/**/*.ts"],
      ignores: [
        "scripts/drift-ai.test.ts",
        "scripts/drift-ai/**/*.test.ts",
        "scripts/drift-ai/fixtures/**",
      ],
      zeroBaselineDisposition: {
        kind: "narrow-floor",
        reason:
          "normal ESLint has mixed drift-ai script coverage and per-file warn caps above 300; this ratchet keeps one max-300 floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
    {
      id: "ratchet/local-max-lines-generate-harness-controls",
      files: [
        "scripts/generate-harness-controls-validation.ts",
        "scripts/generate-harness-controls.ts",
      ],
      ignores: [],
      zeroBaselineDisposition: {
        kind: "narrow-floor",
        reason:
          "normal ESLint only re-includes part of this harness-control family and uses a higher warn cap for the main generator; this ratchet keeps the max-300 floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
    {
      id: "ratchet/local-max-lines-lint-coverage-map-check",
      files: ["scripts/lint-coverage-map-check.ts"],
      ignores: [],
      zeroBaselineDisposition: {
        kind: "narrow-floor",
        reason:
          "normal ESLint uses a higher warn cap for the coverage-map checker; this ratchet keeps the max-300 split target visible while coverage-map parsing is still consolidated",
      },
    },
    {
      id: "ratchet/local-max-lines-logs-audit",
      files: ["scripts/logs-audit-*.ts", "scripts/logs-audit.ts"],
      ignores: [],
      zeroBaselineDisposition: {
        kind: "narrow-floor",
        reason:
          "normal ESLint only re-includes part of the logs-audit script family and uses a higher warn cap for the entrypoint; this ratchet keeps the max-300 floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
    {
      id: "ratchet/local-max-lines-runtime",
      files: [
        "scripts/harness-check-validation.ts",
        "scripts/harness-check.ts",
        "scripts/harness-wrapper-slot-parity.ts",
        "scripts/harness-wrapper-slot-parser.ts",
        "scripts/lint-agent.ts",
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
        reason:
          "normal ESLint has mixed runtime helper coverage and per-file warn caps above 300; this ratchet keeps one max-300 floor while docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md centralizes large-file policy metadata",
      },
    },
  ],
};
