// @ts-check

import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

import {
  codeFiles,
  eslintConfigJsFiles,
  lintedScriptReincludePatterns,
  rootConfigReincludePatterns,
  typescriptFiles,
} from "./shared-policy.js";

export function createBaseConfigs() {
  return [
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
        ...rootConfigReincludePatterns,
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
        ...lintedScriptReincludePatterns,
        "worktrees/",
        "eslint-rules/*",
        "!eslint-rules/*.js",
        "!eslint-rules/vitest.config.ts",
      ],
    },

    {
      ...js.configs.recommended,
      files: codeFiles,
      ignores: eslintConfigJsFiles,
    },

    {
      files: eslintConfigJsFiles,
      rules: {
        ...js.configs.recommended.rules,
        "no-unused-vars": "error",
      },
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
  ];
}
