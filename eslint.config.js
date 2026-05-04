// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";

import socketRegistryBroadcasts from "./eslint-rules/socket-registry-broadcasts.js";
import strictSharedSchemas from "./eslint-rules/strict-shared-schemas.js";
import strictTrpcInput from "./eslint-rules/strict-trpc-input.js";
import structuredLogging from "./eslint-rules/structured-logging.js";
import testFileLocation from "./eslint-rules/test-file-location.js";

const localPlugin = {
  rules: {
    "socket-registry-broadcasts": socketRegistryBroadcasts,
    "test-file-location": testFileLocation,
    "structured-logging": structuredLogging,
    "strict-trpc-input": strictTrpcInput,
    "strict-shared-schemas": strictSharedSchemas,
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "e2e-ux-screenshots/",
      "**/*.config.{js,ts}",
      "docs/",
      "**/generated/",
      "**/prisma/seed*.ts",
      "e2e/",
      "e2e-walkthrough/",
      ".claude/worktrees/",
      ".playwright-cli/",
      "tmp/",
      "scripts/",
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
      "max-lines": ["error", { max: 1000, skipBlankLines: true, skipComments: true }],
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
      "@typescript-eslint/no-explicit-any": "error",
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

      // Forbid the `@musi/shared/schemas` barrel; import from the source
      // file (e.g. `@musi/shared/schemas/spell.js`) so module boundaries stay
      // visible. See `AGENTS.md` ("No barrel files; import from source").
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
    files: ["packages/server/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-console": "warn",
      "local/structured-logging": "error",
    },
  },

  {
    files: ["packages/server/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/server/src/socket/broadcast-registry.ts"],
    rules: {
      "local/socket-registry-broadcasts": "error",
    },
  },

  {
    files: ["packages/server/src/routers/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "local/strict-trpc-input": "error",
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

  // Server scripts live outside `src/` and so aren't covered by the server
  // tsconfig's project service. Point them at a dedicated tsconfig and opt
  // them out of `no-console` (scripts are CLIs; stdout/stderr are their UI).
  {
    files: ["packages/server/scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./packages/server/tsconfig.scripts.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // Forcing function: `RawTxClient` bypasses the restricted-delegate type
  // shim in prisma-types.ts and must only be imported by the mutation
  // helpers that act as the single trust boundary for each race-sensitive
  // table. Adding a new importer is a reviewable decision, not a
  // convenience. See docs/CONCURRENCY.md and CLAUDE.md.
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
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-magic-numbers": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
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
      "max-lines-per-function": "off",
      "no-magic-numbers": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "local/test-file-location": "error",
    },
  },
);
