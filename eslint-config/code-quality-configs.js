// @ts-check

import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

import { maxLinesPolicy } from "./max-lines-policy.js";
import { restrictedImportsRule } from "./package-boundary-policy.js";
import { codeFiles, eslintConfigJsFiles } from "./path-glob-policy.js";
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

// Engine zone cap: the lint-ratchet engine (kernel codec + governance) is
// designed to consolidate at real seams — collect / compare / merge / git —
// so its files legitimately run larger than the repo-wide 300-line ratchet
// floor. That is deliberate zone policy, not tracked debt, so it lives in
// config (a scoped `local/max-lines` cap over the engine globs) rather than as
// a few dozen exceptions-baseline entries, which would manufacture false debt
// and keep the fragmentation pressure the cap exists to relieve. The engine has
// lived in `tools/lint-ratchet/**` (`@musi/lint-ratchet`) since the package seam
// landed on 2026-07-18; Musi's adapter and shared adapter support remain under
// `scripts/lint-ratchet/**` and `scripts/lib/baseline/**`, hence all three globs.
// Spread this AFTER createRepoCodeQualityConfigs (so it overrides the 300 floor)
// and BEFORE maxLinesExceptionConfigs (so genuine >500 outliers keep their
// per-file entry, which wins last). Ruling retained in the landed leaf-05 record:
// docs/agent_notes/backlog/lint-arch-review-2026-07/00-index.md.
// Globs are scoped to `.ts` (the engine is all TypeScript): a bare
// `scripts/lint-ratchet/**` would also match any JSON config placed there, and
// applying a `local/*` code rule to a JSON file linted by the JSON parser fails
// to resolve the `local` plugin. The per-file exception configs sidestep the
// same hazard by listing exact `.ts` paths.
export const maxLinesEngineZoneConfigs = [
  {
    files: [...maxLinesPolicy.engineZone.files],
    rules: {
      "local/max-lines": [
        "error",
        { max: maxLinesPolicy.engineZone.cap, ...maxLinesPolicy.counting },
      ],
    },
  },
];

// Generator-owned files carry no per-file cap — the size gate is turned off
// entirely (the generator is the reviewed surface, not its emitted table). The
// allowlist and its "must be generator-owned" guard live in max-lines-policy.js /
// scripts/max-lines-exceptions.ts; here it only wires the `off` override, which
// must be spread after the base `local/max-lines` rule to win.
export const maxLinesGeneratedExemptionConfigs = maxLinesPolicy.generatedExemptions.map(
  ({ path: filePath }) => ({
    files: [filePath],
    rules: {
      "local/max-lines": "off",
    },
  }),
);

export function createRepoCodeQualityConfigs(repoRoot, localPlugin) {
  return [
    {
      files: [...eslintConfigJsFiles, "eslint-rules/*.test.js"],
      plugins: { "eslint-comments": eslintComments },
      rules: eslintCommentsRules,
    },

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
        "@typescript-eslint": tseslint.plugin,
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

        "local/bad-comparison-sequence": "error",
        "local/bad-min-max-func": "error",
        "local/missing-throw": "error",
        "local/no-incorrect-sort": "error",
        "local/uninvoked-array-callback": "error",

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
        "local/no-swallowed-errors": [
          "error",
          {
            checkEmptyCatch: false,
            checkLoggedFallback: false,
          },
        ],
        "local/no-async-array-callbacks": "error",
        "local/no-barrel": "error",
        "local/no-retired-parse-success-import": "error",
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
        "@typescript-eslint/no-restricted-imports": restrictedImportsRule([]),
      },
    },
  ];
}
