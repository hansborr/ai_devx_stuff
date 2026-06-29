// @ts-check

import testingLibraryPlugin from "eslint-plugin-testing-library";
import vitestPlugin from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";

import {
  codemodTestFiles,
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
              "^addSpell$",
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
  ];
}

export const unitTestConfigs = [
  {
    files: unitTestFiles,
    rules: {
      "max-lines": "off",
      "local/max-lines": "off",
      "max-lines-per-function": "off",
      // Off (not a raised cap) to match the sibling size rules above: tests
      // legitimately fan out optional-chains and dispatch in assertion-heavy
      // callbacks/fakes, and there is no complexity ratchet underneath (every
      // ratchet is message-count), so nothing is undercut. agent-friction E1.
      complexity: "off",
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

  // Locks in the client test-isolation fast lane: a byte-identical per-file
  // vi.mock of a module setup.ts already centralises is pure redundancy that
  // silently re-pins the file to the slow isolated lane. The split runner is
  // self-healing without this, so the rule's value is signal, not correctness.
  {
    files: ["packages/client/src/**/*.test.{ts,tsx}", "packages/client/src/**/*.spec.ts"],
    rules: {
      "local/no-redundant-central-mock": "error",
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

  // testing-library recommended-for-React rules, scoped to client component
  // tests (leaf 06 evaluation). jest-dom is intentionally not adopted: its
  // latest release (5.5.0) predates ESLint 10 and crashes on the removed
  // context.getSourceCode API in 7 of 11 rules. See the lint-followups summary
  // at docs/agent_notes/finished_work/lint-followups-2026-06.md; the original
  // Leaf 06 verdict register now lives only in git history.
  {
    files: ["packages/client/src/**/*.test.tsx"],
    plugins: { "testing-library": testingLibraryPlugin },
    rules: {
      ...testingLibraryPlugin.configs["flat/react"].rules,
      // Recommended ships no-debugging-utils at "warn"; promote it so the
      // adopted floor is uniformly error (matches --max-warnings=0 anyway).
      "testing-library/no-debugging-utils": "error",
      // Implementation-detail debt deferred to lint:ratchet message-count
      // floors (ratchet/testing-library-*), promote-to-normal-lint after the
      // drain follow-up. Off here so normal lint stays green on existing debt.
      "testing-library/no-node-access": "off",
      "testing-library/no-container": "off",
      "testing-library/prefer-screen-queries": "off",
      // Rejected: pure render-result naming style that clashes with the
      // established varied local naming (handlers/props/result, 46 findings);
      // none of the bug classes this evaluation targeted.
      "testing-library/render-result-naming-convention": "off",
    },
  },
];
