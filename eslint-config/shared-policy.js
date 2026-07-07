// @ts-check

import {
  configSurfaceEntries,
  eslintRulesConfigReincludePatterns,
  extraConfigFileReincludePatterns,
  rootAndPackageTsConfigFiles,
  rootJsConfigFiles,
  scriptProjectConfigIgnores,
  tsConfigFiles,
} from "./config-surfaces.js";

export const codeFiles = ["**/*.{js,cjs,mjs,ts,tsx,mts,cts}"];
export const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];

export { configSurfaceEntries };
export { eslintRulesConfigReincludePatterns };
export { rootAndPackageTsConfigFiles };
export { rootJsConfigFiles };
export { tsConfigFiles };

export const eslintConfigSupportFiles = ["eslint-config/*.js"];
export const eslintConfigJsFiles = [...rootJsConfigFiles, ...eslintConfigSupportFiles];

export const rootConfigReincludePatterns = [
  ...rootJsConfigFiles.map((file) => `!${file}`),
  ...rootAndPackageTsConfigFiles.map((file) => `!${file}`),
];

export const configFileReincludePatterns = [
  ...rootConfigReincludePatterns,
  ...extraConfigFileReincludePatterns,
];

export const scriptTypeScriptFiles = ["scripts/**/*.ts"];

export const scriptFixtureIgnores = [
  "scripts/codemods/fixtures/**",
  "scripts/drift-ai/fixtures/**",
  "scripts/fixtures/**",
  "scripts/harness-audit/fixtures/**",
  "scripts/logs-audit/fixtures/**",
];

export const scriptProjectIgnores = [...scriptFixtureIgnores, ...scriptProjectConfigIgnores];

export const codemodSourceFiles = [
  "scripts/codemods/concurrency-guard.ts",
  "scripts/codemods/concurrency-guard/**/*.ts",
  "scripts/codemods/expand-barrel.ts",
  "scripts/codemods/expand-barrel/**/*.ts",
  "scripts/codemods/lib/**/*.ts",
  "scripts/codemods/structured-logging-fix-ast.ts",
  "scripts/codemods/structured-logging-fix-transforms.ts",
  "scripts/codemods/structured-logging-fix.ts",
  "scripts/codemods/trpc-shared-input-candidates.ts",
  "scripts/codemods/trpc-shared-input.ts",
  "scripts/codemods/trpc-shared-output-candidates.ts",
  "scripts/codemods/trpc-shared-output.ts",
];

export const codemodTestFiles = [
  "scripts/codemods/concurrency-guard.test.ts",
  "scripts/codemods/expand-barrel.test.ts",
  "scripts/codemods/structured-logging-fix.test.ts",
  "scripts/codemods/trpc-shared-schema-codemod.test.ts",
];

export const scriptTestAssertFunctionNames = [
  "expect",
  "assertNonPermissiveOutput",
  "expectClean",
  "expectHit",
  "expectOneFulfilledOneConflict",
  "expectParseFailure",
  "expectParseSuccess",
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

const maxLinesCountingOptions = { skipBlankLines: true, skipComments: true };

export const maxLinesPolicy = {
  counting: maxLinesCountingOptions,
  ratchetFloor: { cap: 300 },
  exceptions: [
    {
      path: "scripts/lint-ratchet/lint-ratchet-config.ts",
      cap: 600,
      severity: "error",
      reason:
        "The ratchet registry grows as new ratchets land; the floor protects against accidental drift, not registry growth.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "scripts/harness-check.ts",
      cap: 330,
      severity: "error",
      reason:
        "Single validator entrypoint covering every harness surface (lint rules, ratchets, hook wiring, verify steps, lint guidance, restricted-disable rules, config surfaces, smoke subjects); the 2026-07 lint deep-dive extended several of these families at once.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "scripts/audit-dependency-licenses.ts",
      cap: 310,
      severity: "error",
      reason:
        "Dependency license audit remains one CLI while the pointer-only review remedy is added; split collection and reporting once more license policy behavior lands.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/shared/src/rules/attack-damage.ts",
      cap: 440,
      severity: "error",
      reason:
        "Rules-domain calculator has several tightly-coupled D&D damage branches pending a future rules refactor.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/encounter.ts",
      cap: 480,
      severity: "warn",
      reason:
        "Encounter routing is still the main orchestration surface for combat and map workflows until split behind services.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/homebrew.ts",
      cap: 470,
      severity: "warn",
      reason:
        "Homebrew routing carries several entry-type workflows while shared entry helpers are factored out.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/routers/srd.ts",
      cap: 495,
      severity: "warn",
      reason:
        "SRD routing is mostly read-side mapping and import/export glue, capped so routine endpoint edits stay bounded; +1 for the narrowDamageTypeName import wiring the tightened subspecies damageType enum at the Prisma read seam, +4 for the normalizeWeaponDataDamageType import and equipment weaponData read-seam canonicalization (legacy title-case damageType).",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/server/src/services/rest-service.ts",
      cap: 365,
      severity: "warn",
      reason:
        "Rest behavior has tightly related state transitions and persistence checks pending a future service split; the ux-audit P0-3 encounter HP-attribution wiring (short + long rest) adds the in-tx capture and post-commit broadcast inline until that split lands.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/entries/entry-dialog.tsx",
      cap: 350,
      severity: "warn",
      reason:
        "The homebrew entry dialog owns shared editor chrome for several entry kinds while repeated form sections settle.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx",
      cap: 330,
      severity: "warn",
      reason:
        "Magic item form fields are a dense schema-aligned surface pending obvious field-group extraction.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/monster/monster-form-fields.tsx",
      cap: 470,
      severity: "warn",
      reason:
        "Monster form fields mirror a large SRD/homebrew shape while the grouped form remains intact.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/homebrew/monster/monster-form-data.ts",
      cap: 400,
      severity: "warn",
      reason:
        "Monster form data centralizes defaults and parse/serialize helpers without absorbing UI logic.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx",
      cap: 320,
      severity: "warn",
      reason:
        "The stats-tab roll panel is one compact VTT surface, with further roll modes expected to extract components.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/encounters/add-participant-dialog.tsx",
      cap: 330,
      severity: "warn",
      reason:
        "Add-participant combines search, selection, and encounter mutation glue until workflow growth justifies a split.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/encounters/encounter-detail-view.tsx",
      cap: 390,
      severity: "warn",
      reason:
        "Encounter detail coordinates combat, map, and participant panels while capped before more orchestration accumulates.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/notes/notes-panel.tsx",
      cap: 340,
      severity: "warn",
      reason:
        "Notes panel owns the note list, editor state, and campaign mutations until list/editor concerns split clearly.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/npcs/monster-tab.tsx",
      cap: 370,
      severity: "warn",
      reason: "Monster tab is the NPC-side view over monster reference data and related actions.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/components/campaign/npcs/npc-panel.tsx",
      cap: 320,
      severity: "warn",
      reason:
        "NPC panel coordinates list and selected-detail state while future workflows split list helpers out.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/pages/settings-page.tsx",
      cap: 340,
      severity: "warn",
      reason:
        "Settings is a page-level account/preferences surface capped until another settings area is added.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/fixtures-encounter.ts",
      cap: 410,
      severity: "warn",
      reason:
        "Encounter fixtures keep related test data in one canonical scenario module for client tests.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "scripts/path-policy/path-policy-smoke-subjects-data.ts",
      cap: 535,
      severity: "error",
      reason:
        "Generated side-effect-free smoke-subject lookup table keyed by test name; it grows with smoke tests, not logic, and the fs-backed discovery lives in the sibling module under the floor.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "scripts/harness/hook-wiring-schema.ts",
      cap: 370,
      severity: "error",
      reason:
        "Hook wiring schema centralizes platform event, matcher, and output-capability contracts while the generator still consumes one schema module.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/fixtures-srd.ts",
      cap: 380,
      severity: "warn",
      reason:
        "SRD fixtures are cross-cutting reference data for client tests until another fixture family appears.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/test/mock-trpc.tsx",
      cap: 600,
      severity: "error",
      reason:
        "The tRPC mock is the shared client test harness for provider setup and mock procedure plumbing.",
      lifecycle: "permanent",
      ratchetExcluded: true,
    },
    {
      path: "packages/client/src/stores/map-canvas-store.ts",
      cap: 530,
      severity: "warn",
      reason:
        "Map canvas state is centralized around one store boundary while future map workflows move to helper slices.",
      lifecycle: "candidate-for-split",
      ratchetExcluded: true,
    },
  ],
  ratchets: [],
};
