// @ts-check
import path from "node:path";

import js from "@eslint/js";
import json from "@eslint/json";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import playwright from "eslint-plugin-playwright";
import pluginReact from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import regexp from "eslint-plugin-regexp";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import pluginQuery from "@tanstack/eslint-plugin-query";
import vitestPlugin from "@vitest/eslint-plugin";

import maxLines from "./eslint-rules/max-lines.js";
import noAsyncArrayCallbacks from "./eslint-rules/no-async-array-callbacks.js";
import noBarrel from "./eslint-rules/no-barrel.js";
import noExplicitAny from "./eslint-rules/no-explicit-any.js";
import noLlmArtifacts from "./eslint-rules/no-llm-artifacts.js";
import noSwallowedErrors from "./eslint-rules/no-swallowed-errors.js";
import e2ePreferRoleSelectors from "./eslint-rules/e2e-prefer-role-selectors.js";
import concurrencyGuard from "./eslint-rules/concurrency-guard.js";
import noBroadcastInTransaction from "./eslint-rules/no-broadcast-in-transaction.js";
import strictSharedSchemas from "./eslint-rules/strict-shared-schemas.js";
import strictTrpcInput from "./eslint-rules/strict-trpc-input.js";
import trpcRequireOutputSchema from "./eslint-rules/trpc-require-output-schema.js";
import trpcSharedInputSchema from "./eslint-rules/trpc-shared-input-schema.js";
import trpcSharedOutputSchema from "./eslint-rules/trpc-shared-output-schema.js";
import socketRegistryBroadcasts from "./eslint-rules/socket-registry-broadcasts.js";
import structuredLogging from "./eslint-rules/structured-logging.js";
import testFileLocation from "./eslint-rules/test-file-location.js";

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

const localPlugin = {
  rules: {
    "concurrency-guard": concurrencyGuard,
    "max-lines": maxLines,
    "no-async-array-callbacks": noAsyncArrayCallbacks,
    "no-barrel": noBarrel,
    "no-explicit-any": noExplicitAny,
    "no-llm-artifacts": noLlmArtifacts,
    "no-swallowed-errors": noSwallowedErrors,
    "e2e-prefer-role-selectors": e2ePreferRoleSelectors,
    "no-broadcast-in-transaction": noBroadcastInTransaction,
    "test-file-location": testFileLocation,
    "socket-registry-broadcasts": socketRegistryBroadcasts,
    "structured-logging": structuredLogging,
    "strict-trpc-input": strictTrpcInput,
    "trpc-require-output-schema": trpcRequireOutputSchema,
    "trpc-shared-input-schema": trpcSharedInputSchema,
    "trpc-shared-output-schema": trpcSharedOutputSchema,
    "strict-shared-schemas": strictSharedSchemas,
  },
};

const codeFiles = ["**/*.{js,cjs,mjs,ts,tsx,mts,cts}"];
const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];

const repoRoot = import.meta.dirname;
const sharedDir = path.resolve(repoRoot, "packages/shared");
const serverDir = path.resolve(repoRoot, "packages/server");
const clientDir = path.resolve(repoRoot, "packages/client");
const serverSeedGeneratorGlob = path.resolve(
  repoRoot,
  "packages/server/src/seed/generate-srd-*.ts",
);

export default defineConfig(
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },

  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      ".auth/",
      ".playwright-mcp/",
      "e2e-ux-screenshots/",
      "**/*.config.{js,mjs,ts}",
      "docs/",
      "**/generated/",
      "e2e-walkthrough/",
      ".claude/worktrees/",
      ".playwright-cli/",
      "blob-report/",
      "playwright-report/",
      "playwright/.cache/",
      "test-results/",
      "tmp/",
      "scripts/**/*",
      "!scripts/code-intel/",
      "!scripts/code-intel/**/*.ts",
      "!scripts/drift/",
      "!scripts/drift/**/*.ts",
      "!scripts/generate-lint-guidance.ts",
      "worktrees/",
      "eslint-rules/",
    ],
  },

  {
    ...js.configs.recommended,
    files: codeFiles,
  },

  ...tseslint.configs.strictTypeChecked.map((config) =>
    config.files ? config : { ...config, files: typescriptFiles },
  ),

  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  eslintConfigPrettier,

  // packages/shared — strict tier: production-ish source
  {
    files: ["packages/shared/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
      "packages/shared/src/**/*.test-helper.{ts,tsx}",
      "packages/shared/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        { packageDir: [sharedDir] },
      ],
    },
  },

  // packages/shared — tests & helpers: root devDeps allowed
  {
    files: [
      "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
      "packages/shared/src/**/*.test-helper.{ts,tsx}",
      "packages/shared/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          packageDir: [sharedDir, repoRoot],
          devDependencies: true,
        },
      ],
    },
  },

  // packages/server — strict tier: production-ish source
  {
    files: ["packages/server/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/**/*.test-helper.{ts,tsx}",
      "packages/server/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          packageDir: [serverDir],
          devDependencies: [serverSeedGeneratorGlob],
        },
      ],
    },
  },

  // packages/server — tests & helpers: root devDeps allowed
  {
    files: [
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/**/*.test-helper.{ts,tsx}",
      "packages/server/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          packageDir: [serverDir, repoRoot],
          devDependencies: true,
        },
      ],
    },
  },

  // packages/client — strict tier: production-ish source
  {
    files: ["packages/client/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/client/src/**/*.{test,spec}.{ts,tsx}",
      "packages/client/src/**/*.test-helper.{ts,tsx}",
      "packages/client/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        { packageDir: [clientDir] },
      ],
    },
  },

  // packages/client — tests & helpers: root devDeps allowed
  {
    files: [
      "packages/client/src/**/*.{test,spec}.{ts,tsx}",
      "packages/client/src/**/*.test-helper.{ts,tsx}",
      "packages/client/src/test/**/*.{ts,tsx}",
    ],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          packageDir: [clientDir, repoRoot],
          devDependencies: true,
        },
      ],
    },
  },

  {
    files: codeFiles,
    plugins: { regexp },
    rules: {
      ...regexp.configs["flat/recommended"].rules,
      "regexp/confusing-quantifier": "error",
      "regexp/no-empty-alternative": "error",
      "regexp/no-lazy-ends": "error",
      "regexp/no-potentially-useless-backreference": "error",
      "regexp/no-useless-flag": "error",
      "regexp/optimal-lookaround-quantifier": "error",
      // Deferred to Pass 2b - needs careful semantic rewrites of seed/parser
      // regexes (24 sites across markdown parsers, spell blocks, glossary
      // entries, etc.). See inventory in
      // finished_work/lint-hardening-leaf-21-regexp-inventory.md.
      "regexp/no-super-linear-backtracking": "off",
      "regexp/no-misleading-capturing-group": "off",
      "regexp/no-contradiction-with-assertion": "off",
      // Style-only per Leaf 21 backlog; not part of v3 flat/recommended but
      // override explicitly so future plugin upgrades do not surprise us.
      "regexp/prefer-named-capture-group": "off",
    },
  },

  {
    files: codeFiles,
    plugins: {
      "eslint-comments": eslintComments,
      "simple-import-sort": simpleImportSort,
      local: localPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      complexity: ["error", { max: 10 }],
      "max-lines": "off",
      "local/max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 200, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", { max: 4 }],
      "no-nested-ternary": "error",
      "no-magic-numbers": [
        "warn",
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],

      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "local/no-explicit-any": "error",
      "local/no-llm-artifacts": "error",
      "local/no-swallowed-errors": "error",
      "local/no-async-array-callbacks": "error",
      "local/no-barrel": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
        {
          selector: "objectLiteralProperty",
          format: null,
        },
        {
          selector: "objectLiteralMethod",
          format: null,
        },
        {
          selector: "typeProperty",
          format: ["camelCase", "snake_case", "PascalCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: ["typeProperty", "typeMethod"],
          format: null,
          filter: { regex: "[:\\-_]", match: true },
        },
        {
          selector: "typeMethod",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "eslint-comments/require-description": ["error", { ignore: [] }],
      "eslint-comments/no-aggregating-enable": "error",
      "eslint-comments/no-duplicate-disable": "error",
      "eslint-comments/no-unlimited-disable": "error",
      "eslint-comments/no-unused-disable": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      "prefer-const": "error",
      "no-var": "error",
      "no-constant-binary-expression": "error",
      "no-param-reassign": "error",
      "radix": "error",
      "no-useless-assignment": "error",
      "preserve-caught-error": "error",
      "no-promise-executor-return": "error",
      "require-atomic-updates": "error",

      // Forbid the `@musi/shared/schemas` barrel; import from the source
      // file (e.g. `@musi/shared/schemas/spell.js`) so module boundaries stay
      // visible.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Exact match — `group` glob would also match
              // `@musi/shared/schemas/foo.js`, which is the path we want
              // people to use.
              regex: "^@musi/shared/schemas$",
              message:
                "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
            },
          ],
        },
      ],
    },
  },

  // Ban process.exit(...) outside named bootstrap/script entrypoints.
  // Prefer `process.exitCode = N` plus a clean return/throw so the
  // runtime can flush logs, close sockets, and run finally blocks.
  {
    files: codeFiles,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
          message:
            "Avoid process.exit(...) outside CLI/bootstrap entrypoints. Set process.exitCode and return/throw so finally blocks, log flushing, and socket teardown can run. If this IS a terminating entrypoint, add the file to the allowlist override in eslint.config.js.",
        },
      ],
    },
  },

  // Bootstrap/script entrypoints where process.exit(...) is the correct
  // termination path. This is the first no-restricted-syntax selector in the
  // config, so turning the whole rule off here only drops the process.exit
  // ban for these named files.
  {
    files: [
      "scripts/db-status.ts",
      "scripts/code-intel/daemon-server.ts",
      "packages/server/src/main.ts",
      "packages/server/prisma/seed.ts",
      "packages/server/prisma/seed-template.ts",
      "packages/server/scripts/pgexec.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["packages/client/**/*.tsx"],
    settings: {
      "jsx-a11y": {
        components: {
          Button: "button",
          Input: "input",
          Label: "label",
          SelectTrigger: "button",
          TabsTrigger: "button",
          Textarea: "textarea",
        },
        linkComponents: [{ name: "Link", linkAttribute: "to" }],
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/anchor-is-valid": [
        "error",
        {
          components: ["Link"],
          specialLink: ["to"],
          aspects: ["noHref", "invalidHref", "preferButton"],
        },
      ],
    },
  },

  {
    files: ["packages/client/**/*.tsx"],
    plugins: { react: pluginReact },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-key": "error",
      "react/no-unstable-nested-components": "error",
      "react/self-closing-comp": "error",
      "react/no-array-index-key": "error",
      "react/no-unused-prop-types": "error",
    },
  },

  {
    files: ["packages/client/**/*.{ts,tsx}"],
    plugins: { "@tanstack/query": pluginQuery },
    rules: {
      "@tanstack/query/exhaustive-deps": "error",
      "@tanstack/query/no-rest-destructuring": "warn",
      "@tanstack/query/stable-query-client": "error",
      "@tanstack/query/no-unstable-deps": "error",
      "@tanstack/query/infinite-query-property-order": "error",
      "@tanstack/query/no-void-query-fn": "error",
      "@tanstack/query/mutation-property-order": "error",
    },
  },

  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json", "**/.vscode/*.json"],
    plugins: { json },
    language: "json/json",
    rules: {
      "json/no-duplicate-keys": "error",
      "json/no-empty-keys": "error",
      "json/no-unnormalized-keys": "error",
      "json/no-unsafe-values": "error",
    },
  },

  {
    files: ["**/*.jsonc", "**/tsconfig*.json", "**/.vscode/*.json"],
    plugins: { json },
    language: "json/jsonc",
    languageOptions: { allowTrailingCommas: true },
    rules: {
      "json/no-duplicate-keys": "error",
      "json/no-empty-keys": "error",
      "json/no-unnormalized-keys": "error",
      "json/no-unsafe-values": "error",
    },
  },

  {
    // Compact rules modules are the default. This file is a rules-domain
    // calculator with several tightly-coupled D&D damage branches; keep the
    // temporary cap close to today's ESLint line count while a future rules
    // refactor decides where the branches should live.
    files: ["packages/shared/src/rules/attack-damage.ts"],
    rules: {
      "local/max-lines": ["error", { max: 440, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Router files should stay thin. Encounter routing is still the main
    // orchestration surface for combat and map workflows, so cap it explicitly
    // until those flows are split behind smaller services.
    files: ["packages/server/src/routers/encounter.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 470, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Homebrew routing carries several entry-type workflows in one tRPC
    // surface. Keep the larger file visible while shared entry helpers are
    // factored out.
    files: ["packages/server/src/routers/homebrew.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 470, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // SRD routing is mostly read-side mapping and import/export glue. The
    // explicit cap keeps routine endpoint edits moving without allowing the
    // router to grow unbounded.
    files: ["packages/server/src/routers/srd.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 490, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Rest behavior has tightly related state transitions and persistence
    // checks. Leave it together for now, with a cap close enough to force a
    // service split when more rest mechanics arrive.
    files: ["packages/server/src/services/rest-service.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 340, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // The homebrew entry dialog owns the shared editor chrome for several
    // entry kinds. Keep it capped while the repeated form sections settle.
    files: ["packages/client/src/components/homebrew/entries/entry-dialog.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 350, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Magic item form fields are a dense schema-aligned form surface. The
    // larger cap is temporary pressure to extract field groups only when the
    // next edit makes the split obvious.
    files: ["packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 330, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Monster form fields mirror a large SRD/homebrew shape. Keep the current
    // grouped form intact, but force a revisit before adding another full
    // section here.
    files: ["packages/client/src/components/homebrew/monster/monster-form-fields.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 470, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Monster form data centralizes defaults and parse/serialize helpers used
    // by the form fields. The cap keeps those transformations together without
    // making this a dumping ground for UI logic.
    files: ["packages/client/src/components/homebrew/monster/monster-form-data.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // The stats-tab roll panel is one compact VTT surface with adjacent roll
    // affordances. Keep the cap low so the next added roll mode becomes a
    // deliberate component extraction.
    files: ["packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 320, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Add-participant combines search, selection, and encounter mutation glue.
    // It can stay together at its current size, but further workflow growth
    // should split into focused hooks/components.
    files: ["packages/client/src/components/campaign/encounters/add-participant-dialog.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 330, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Encounter detail is the page-level coordinator for combat, map, and
    // participant panels. Keep one coordinator for now, with a cap that will
    // fire before more orchestration accumulates here.
    files: ["packages/client/src/components/campaign/encounters/encounter-detail-view.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 390, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Notes panel owns the note list, editor state, and campaign mutation
    // calls. Leave the workflow in one file until a future edit has a clear
    // split between list and editor concerns.
    files: ["packages/client/src/components/campaign/notes/notes-panel.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 340, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Monster tab is the NPC-side view over monster reference data and related
    // actions. Keep the cap near the current size so more actions require a
    // helper or child component.
    files: ["packages/client/src/components/campaign/npcs/monster-tab.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 370, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // NPC panel coordinates the NPC list and selected-detail state. The file
    // can stay slightly above the default, but another workflow should split
    // selection/list helpers out.
    files: ["packages/client/src/components/campaign/npcs/npc-panel.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 320, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Settings is a page-level account/preferences surface. Keep the current
    // sections together, but force extraction when another settings area is
    // added.
    files: ["packages/client/src/pages/settings-page.tsx"],
    rules: {
      "local/max-lines": ["warn", { max: 340, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Encounter fixtures intentionally keep related test data in one place so
    // client tests share canonical scenario shapes. Cap it just above today's
    // size so new fixture families need their own module.
    files: ["packages/client/src/test/fixtures-encounter.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 410, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // SRD fixtures are cross-cutting reference data for client tests. Keep
    // shared fixtures discoverable here, but split when another SRD fixture
    // family appears.
    files: ["packages/client/src/test/fixtures-srd.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 380, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // The tRPC mock is the shared client test harness. A single module keeps
    // provider setup and mock procedure plumbing aligned, but new feature
    // surfaces should move into narrower test helpers.
    files: ["packages/client/src/test/mock-trpc.tsx"],
    rules: {
      "local/max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    // Map canvas state is intentionally centralized around one store boundary.
    // Keep actions and selectors together for now, with this cap forcing the
    // next substantial map workflow into a helper slice.
    files: ["packages/client/src/stores/map-canvas-store.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 530, skipBlankLines: true, skipComments: true }],
    },
  },

  {
    files: ["packages/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/socket-registry-broadcasts": "error",
    },
  },

  {
    files: ["packages/server/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/concurrency-guard": "error",
      "local/no-broadcast-in-transaction": "error",
    },
  },

  {
    files: ["packages/server/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-console": "warn",
      "local/structured-logging": "error",
    },
  },

  {
    files: ["packages/server/src/utils/script-logger.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/strict-trpc-input": "error",
      "local/trpc-require-output-schema": "error",
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/trpc-shared-input-schema": "error",
      "local/trpc-shared-output-schema": "error",
    },
  },

  {
    // The rule itself filters by name (only *InputSchema fires) so it's safe
    // to scope broadly. Output/result schemas (which back tRPC `.output(...)`
    // validation) need to stay permissive so Prisma's extra fields get
    // stripped at the boundary, not rejected.
    files: ["packages/shared/src/schemas/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/strict-shared-schemas": "error",
    },
  },

  {
    files: ["packages/shared/src/**/*.{ts,tsx}"],
    rules: {
      // Flat config replaces (not merges) rule entries by key, so the global
      // schemas-barrel restriction must be repeated here alongside shared-only
      // dependency restrictions.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@musi/shared/schemas$",
              message:
                "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
            },
            {
              group: ["@musi/server", "@musi/server/*", "@musi/client", "@musi/client/*"],
              message:
                "packages/shared is the cross-package contract layer and must not depend on client or server modules.",
            },
            {
              group: [
                "react",
                "react-dom",
                "socket.io-client",
                "@tanstack/*",
                "@trpc/client",
                "@trpc/server",
              ],
              message:
                "packages/shared must stay runtime-neutral. Put browser/server adapters in packages/client or packages/server.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "window",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "document",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "localStorage",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
        {
          name: "sessionStorage",
          message:
            "packages/shared must stay runtime-neutral; move browser code to packages/client.",
        },
      ],
    },
  },

  // Linted scripts/ modules and selected entrypoints live outside package
  // tsconfigs, so point ESLint at the scripts project.
  {
    files: [
      "scripts/code-intel/**/*.ts",
      "scripts/drift/**/*.ts",
      "scripts/generate-lint-guidance.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.scripts.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Server scripts live outside `src/` and so aren't covered by the server
  // tsconfig's project service. Point them at a dedicated tsconfig.
  {
    files: ["packages/server/scripts/**/*.ts", "packages/server/prisma/seed*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./packages/server/tsconfig.scripts.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Test files — vitest mocks, react-query option mocks, and test-only
  // promise fakes legitimately return promises from non-async callbacks
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/promise-function-async": "off",
    },
  },

  // Client tRPC mock factories — model tRPC's promise-returning contract,
  // not production promise boundaries
  {
    files: ["packages/client/src/test/mock-trpc*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/promise-function-async": "off",
    },
  },

  // Dynamic-import loader callbacks — framework loaders (TanStack Router,
  // React.lazy wrappers) intentionally return import() promises
  {
    files: [
      "packages/client/src/routes/**/*-route.ts",
      "packages/client/src/pages/character-sheet/sheet-dialogs.tsx",
    ],
    rules: {
      "@typescript-eslint/promise-function-async": "off",
    },
  },

  // E2E tests live outside package tsconfigs. Keep them lint-visible with
  // their own Playwright/Node project before adding Playwright-specific rules.
  {
    files: ["e2e/**/*.{ts,tsx}"],
    ...playwright.configs["flat/recommended"],
    languageOptions: {
      ...playwright.configs["flat/recommended"].languageOptions,
      parserOptions: {
        projectService: false,
        project: "./tsconfig.e2e.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "playwright/prefer-web-first-assertions": "error",
      "playwright/missing-playwright-await": "error",
      "playwright/no-wait-for-timeout": "error",
      "playwright/no-focused-test": "error",
      "playwright/no-skipped-test": "error",
      "playwright/no-page-pause": "error",
      "playwright/no-networkidle": "error",
      "playwright/expect-expect": [
        "error",
        {
          assertFunctionPatterns: [
            "^expect",
            "^castSingleTargetSpell$",
            "^performShortRest$",
            "^prepareSpell$",
          ],
        },
      ],
      "playwright/no-conditional-in-test": "error",
      // Stage 4 adds the Musi-specific selector rule, so leave plugin selector rules quiet.
      "playwright/no-raw-locators": "off",
      "playwright/prefer-native-locators": "off",
      "local/e2e-prefer-role-selectors": "error",
      // Existing page objects use first()/last() heavily; migrating selectors is Stage 4 scope.
      "playwright/no-nth-methods": "off",
    },
  },

  {
    // Legacy allowlist for local/e2e-prefer-role-selectors — files migrate
    // off this list opportunistically (Plan Step 3c).
    files: e2ePreferRoleSelectorAllowlist,
    rules: { "local/e2e-prefer-role-selectors": "off" },
  },

  // Forcing function: `RawTxClient` bypasses the restricted-delegate type
  // shim in prisma-types.ts and must only be imported by the mutation
  // helpers that act as the single trust boundary for each race-sensitive
  // table. Adding a new importer is a reviewable decision, not a
  // convenience. See docs/CONCURRENCY.md.
  {
    files: ["packages/server/src/**/*.ts"],
    ignores: [
      "packages/server/src/utils/prisma-types.ts",
      "packages/server/src/utils/*-mutations.ts",
    ],
    rules: {
      // Flat config replaces (not merges) rule entries by key, so the global
      // schemas-barrel restriction must be repeated here alongside the
      // server-only RawTxClient restriction.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Exact match — `group` glob would also match
              // `@musi/shared/schemas/foo.js`, which is the path we want
              // people to use.
              regex: "^@musi/shared/schemas$",
              message:
                "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
            },
            {
              group: ["**/prisma-types.js"],
              importNames: ["RawTxClient"],
              message:
                "RawTxClient may only be imported by utils/*-mutations.ts files. Go through a locked helper (see docs/CONCURRENCY.md).",
            },
          ],
        },
      ],
    },
  },

  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["packages/client/**/*.{ts,tsx}"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "react-hooks/set-state-in-effect": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },

  {
    files: ["packages/client/src/**/*.{ts,tsx}"],
    ignores: ["packages/client/src/hooks/socket-context.tsx", "**/*.test.{ts,tsx}"],
    rules: {
      // Keep the Socket.io client lifecycle centralized in SocketProvider.
      // Repeat the schemas-barrel restriction because flat-config rule entries
      // replace by key.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@musi/shared/schemas$",
              message:
                "Import from the specific schema source file, e.g. `@musi/shared/schemas/spell.js`. The barrel was removed; see DX4.1 in docs/roadmap/developer-experience.md.",
            },
            {
              group: ["socket.io-client"],
              message:
                "Use the app SocketProvider/useSocket hooks instead of constructing another Socket.io client.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["packages/client/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-console": "warn",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.ts"],
    rules: {
      "max-lines": "off",
      "local/max-lines": "off",
      "max-lines-per-function": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.ts"],
    ignores: ["e2e/**/*", "**/e2e/**/*"],
    rules: {
      "local/test-file-location": "error",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.ts"],
    ignores: ["e2e/**/*", "**/e2e/**/*"],
    plugins: { vitest: vitestPlugin },
    rules: {
      "vitest/expect-expect": [
        "error",
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
      "vitest/no-commented-out-tests": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      "vitest/no-identical-title": "error",
      "vitest/no-import-node-test": "error",
      "vitest/no-interpolation-in-snapshots": "error",
      "vitest/no-mocks-import": "error",
      "vitest/no-standalone-expect": "error",
      "vitest/no-unneeded-async-expect-function": "error",
      "vitest/prefer-called-exactly-once-with": "error",
      "vitest/prefer-comparison-matcher": "error",
      "vitest/prefer-equality-matcher": "error",
      "vitest/prefer-to-contain": "error",
      "vitest/require-local-test-context-for-concurrent-snapshots": "error",
      "vitest/valid-describe-callback": "error",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/valid-expect-in-promise": "error",
      "vitest/valid-title": "error",
    },
  },
);
