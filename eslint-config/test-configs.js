// @ts-check

import vitestPlugin from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";

import {
  codemodTestFiles,
  e2eNoNthMethodsDebtFiles,
  e2ePreferNativeLocatorDebtFiles,
  e2ePreferRoleSelectorDebtFiles,
  nonE2eTestIgnores,
  scriptTestAssertFunctionNames,
  unitTestFiles,
} from "./shared-policy.js";

export function createTestAndE2eConfigs(repoRoot) {
  return [
    // Test files - vitest mocks, react-query option mocks, and test-only
    // promise fakes legitimately return promises from non-async callbacks
    {
      files: ["**/*.{test,spec}.{ts,tsx}"],
      rules: {
        "@typescript-eslint/promise-function-async": "off",
      },
    },

    // Client tRPC mock factories - model tRPC's promise-returning contract,
    // not production promise boundaries
    {
      files: ["packages/client/src/test/mock-trpc*.{ts,tsx}"],
      rules: {
        "@typescript-eslint/promise-function-async": "off",
      },
    },

    // Dynamic-import loader callbacks - framework loaders (TanStack Router,
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
          tsconfigRootDir: repoRoot,
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
        "playwright/prefer-native-locators": "error",
        "local/e2e-prefer-role-selectors": "error",
        "playwright/no-nth-methods": "error",
      },
    },

    {
      files: ["e2e/**/*.ts"],
      rules: {
        "local/type-assertion-boundary": "error",
      },
    },

    {
      // Existing selector debt is held by ratchet floors; clean e2e files keep
      // the matching rule at error through the base e2e block above.
      files: e2ePreferRoleSelectorDebtFiles,
      rules: { "local/e2e-prefer-role-selectors": "off" },
    },

    {
      files: e2eNoNthMethodsDebtFiles,
      rules: { "playwright/no-nth-methods": "off" },
    },

    {
      files: e2ePreferNativeLocatorDebtFiles,
      rules: { "playwright/prefer-native-locators": "off" },
    },
  ];
}

export const unitTestConfigs = [
  {
    files: unitTestFiles,
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
    files: unitTestFiles,
    ignores: nonE2eTestIgnores,
    rules: {
      "local/test-file-location": "error",
    },
  },

  {
    files: unitTestFiles,
    ignores: nonE2eTestIgnores,
    plugins: { vitest: vitestPlugin },
    rules: {
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: scriptTestAssertFunctionNames,
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

  {
    files: codemodTestFiles,
    rules: {
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [...scriptTestAssertFunctionNames, "runFixture"],
        },
      ],
    },
  },
];
