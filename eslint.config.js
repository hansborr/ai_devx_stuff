// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";

import maxLines from "./eslint-rules/max-lines.js";
import noAsyncArrayCallbacks from "./eslint-rules/no-async-array-callbacks.js";
import noBarrel from "./eslint-rules/no-barrel.js";
import noExplicitAny from "./eslint-rules/no-explicit-any.js";
import noLlmArtifacts from "./eslint-rules/no-llm-artifacts.js";
import noSwallowedErrors from "./eslint-rules/no-swallowed-errors.js";
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

const localPlugin = {
  rules: {
    "concurrency-guard": concurrencyGuard,
    "max-lines": maxLines,
    "no-async-array-callbacks": noAsyncArrayCallbacks,
    "no-barrel": noBarrel,
    "no-explicit-any": noExplicitAny,
    "no-llm-artifacts": noLlmArtifacts,
    "no-swallowed-errors": noSwallowedErrors,
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

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "e2e-ux-screenshots/",
      "**/*.config.{js,mjs,ts}",
      "docs/",
      "**/generated/",
      "e2e/",
      "e2e-walkthrough/",
      ".claude/worktrees/",
      ".playwright-cli/",
      "tmp/",
      "scripts/**/*",
      "!scripts/code-intel/",
      "!scripts/code-intel/**/*.ts",
      "worktrees/",
      "eslint-rules/",
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.strictTypeChecked,

  eslintConfigPrettier,

  {
    plugins: {
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

  {
    // Compact rules modules are the default. This file is a rules-domain
    // calculator with several tightly-coupled D&D damage branches; keep the
    // temporary cap close to today's ESLint line count while a future rules
    // refactor decides where the branches should live.
    files: ["packages/shared/src/rules/attack-damage.ts"],
    rules: {
      "local/max-lines": ["warn", { max: 430, skipBlankLines: true, skipComments: true }],
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
      "local/max-lines": ["warn", { max: 580, skipBlankLines: true, skipComments: true }],
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

  // Code-intel internals are the first linted scripts/ modules. They live
  // outside package tsconfigs, so point ESLint at the scripts project.
  {
    files: ["scripts/code-intel/**/*.ts"],
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
    files: ["packages/client/**/*.{ts,tsx}"],
    plugins: {
      // eslint-plugin-react-hooks@7's `configs.flat` shape doesn't satisfy
      // ESLint core's `Plugin` type. Runtime works fine — cast at the boundary.
      "react-hooks": /** @type {import("eslint").ESLint.Plugin} */ (reactHooks),
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
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
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "max-lines": "off",
      "local/max-lines": "off",
      "max-lines-per-function": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "local/test-file-location": "error",
    },
  },
);
