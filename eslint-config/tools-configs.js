// @ts-check

// Reach + boundary policy for the portable `tools/lint-ratchet` package.
//
// The package sources live outside the root package tsconfigs and outside
// tsconfig.scripts.json, so — exactly like maintained `scripts/` TypeScript —
// ESLint's type-aware rules need to be pointed at the package's own tsconfig.
// Spread AFTER createRepoCodeQualityConfigs so `projectService: false` + the
// explicit project override the default project service for these files
// (mirrors createScriptProjectConfigs).
export function createToolsProjectConfigs(repoRoot) {
  return [
    {
      files: ["tools/lint-ratchet/**/*.ts"],
      // The package's own `*.config.ts` (its Vitest project config) is a
      // registered config surface parsed by the tsconfig.configs.json project
      // service (createTsConfigFileConfigs); it is not part of the package's
      // own tsconfig include, so leave it out of this reach block.
      ignores: ["tools/lint-ratchet/**/*.config.ts"],
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: "./tools/lint-ratchet/tsconfig.json",
          tsconfigRootDir: repoRoot,
        },
      },
    },

    // Coarse, fast secondary signal for the package boundary (slice plan §2.1):
    // forbid the obvious outward reach targets so a leak is caught in the
    // edit/lint loop. The resolver-aware, fail-closed proof is the committed
    // boundary test under tools/lint-ratchet/test/boundary; this guard is not it.
    // The package's own name is intentionally NOT restricted — the sources and
    // tests self-import via `@musi/lint-ratchet/*`.
    {
      files: ["tools/lint-ratchet/**/*.ts"],
      ignores: ["tools/lint-ratchet/**/*.config.ts"],
      rules: {
        "@typescript-eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "@musi/shared",
                  "@musi/shared/**",
                  "@musi/server",
                  "@musi/server/**",
                  "@musi/client",
                  "@musi/client/**",
                  "**/packages/**",
                  "**/scripts/**",
                  "**/eslint-config/**",
                  "**/eslint-rules/**",
                ],
                message:
                  "tools/lint-ratchet is a portable package: import only in-package paths, node:/bun: built-ins, or one of its declared dependencies. See tools/lint-ratchet/test/boundary.",
              },
            ],
          },
        ],
      },
    },
  ];
}
