// @ts-check

import simpleImportSort from "eslint-plugin-simple-import-sort";

import {
  codeFiles,
  eslintConfigJsFiles,
  maxLinesPolicy,
  sharedSchemasBarrelRestrictedImportPattern,
} from "./shared-policy.js";
import {
  eslintComments,
  eslintCommentsRules,
  maintainabilityRules,
  regexp,
  regexpRules,
} from "./rule-groups.js";

export const maxLinesExceptionConfigs = maxLinesPolicy.exceptions.map(
  ({ path: filePath, cap, severity }) => ({
    files: [filePath],
    rules: {
      "local/max-lines": [severity, { max: cap, ...maxLinesPolicy.counting }],
    },
  }),
);

export function createRepoCodeQualityConfigs(repoRoot, localPlugin) {
  return [
    {
      files: codeFiles,
      ignores: ["eslint-rules/*.js", ...eslintConfigJsFiles],
      plugins: { regexp },
      rules: regexpRules,
    },

    {
      files: codeFiles,
      ignores: ["eslint-rules/*.js", ...eslintConfigJsFiles],
      plugins: {
        "eslint-comments": eslintComments,
        "simple-import-sort": simpleImportSort,
        local: localPlugin,
      },
      languageOptions: {
        parserOptions: {
          // The lint-ratchet `type-aware-ts` parser profile mirrors these
          // project-service knobs; update docs/guides/lint-ratchet.md if this
          // changes.
          projectService: true,
          tsconfigRootDir: repoRoot,
        },
      },
      rules: {
        ...maintainabilityRules,

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
        ...eslintCommentsRules,

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
        radix: "error",
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
            patterns: [sharedSchemasBarrelRestrictedImportPattern],
          },
        ],
      },
    },
  ];
}
