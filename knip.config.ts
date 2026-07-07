import type { KnipConfig } from "knip";

const config = {
  includeEntryExports: true,
  ignoreDependencies: [
    // Invoked by .husky/commit-msg via node_modules/.bin/commitlint, not as an
    // ES module import. Knip can't track hook bin invocations.
    "@commitlint/cli",
    // Used by generated Prisma client files under packages/server/src/generated/prisma,
    // which are gitignored and outside knip's project graph.
    "@prisma/client",
    // Invoked by scripts/drift-ai/duplicates.ts through node_modules/.bin/jscpd,
    // not imported as a module.
    "jscpd",
    // Pino transport target string in packages/server/src/app.ts, not an import.
    "pino-pretty",
  ],
  ignoreIssues: {
    // Shared = contract surface: schemas and rules intentionally expose
    // exported values and types as package API.
    "packages/shared/src/schemas/**": ["exports", "types"],
    "packages/shared/src/rules/**": ["exports", "types"],
    // Map layer schemas mirror the shared contract surface for VTT map data.
    "packages/shared/src/map/**": ["exports", "types"],
    // shadcn convention: ui components expose a reusable component surface,
    // including the *Props types each component file emits.
    "packages/client/src/components/ui/**": ["exports", "types"],
    // Homebrew entity field modules document FormData re-exports as public entry points.
    "packages/client/src/components/homebrew/*/*-form-fields.tsx": ["types"],
    // Reusable client SRD fixture builders are intentionally exported for tests.
    "packages/client/src/test/fixtures-srd.ts": ["exports"],
    // Reusable client encounter fixture builders are intentionally exported for tests.
    "packages/client/src/test/fixtures-encounter.ts": ["exports"],
    // Server fixture factories are intentionally exported for test setup.
    "packages/server/src/test/fixtures.ts": ["exports"],
    // E2E API/data helpers are intentionally exported for Playwright specs.
    "e2e/helpers/**": ["exports", "types"],
    // Compile-only negative type tests deliberately export `_tx*` markers and
    // declare local helper types for static analysis but are never imported at
    // runtime, so both their exports and types are intentional.
    "packages/server/src/utils/__type-tests__/**": ["exports", "types"],
  },
  workspaces: {
    ".": {
      entry: [
        "eslint-rules/*.js",
        "e2e/**/*.ts",
        "scripts/*.sh",
        "scripts/*.ts",
        // CLI entry points that live one directory down (e.g.
        // post-merge-baseline-preflight.ts, path-policy-query.ts); without these
        // globs they false-positive as orphan files.
        "scripts/lint-ratchet/*.ts",
        "scripts/path-policy/*.ts",
        "scripts/ai-hooks/*.sh",
        "scripts/codemods/*.ts",
        ".github/workflows/*.{yml,yaml}",
        ".husky/*",
      ],
      project: [
        "eslint-rules/**/*.{js,ts}",
        "e2e/**/*.ts",
        "scripts/**/*.ts",
        "!scripts/**/*.d.ts",
        "!scripts/codemods/fixtures/**",
        "!scripts/drift-ai/fixtures/**",
        "!scripts/logs-audit/fixtures/**",
      ],
      ignore: ["scripts/codemods/fixtures/**"],
      paths: {
        "@/*": ["packages/client/src/*"],
        "@musi/shared/constants": ["packages/shared/src/constants.ts"],
        "@musi/shared/schemas/*.js": ["packages/shared/src/schemas/*.ts"],
        "@musi/shared/rules/*.js": ["packages/shared/src/rules/*.ts"],
        "@musi/shared/dice/*.js": ["packages/shared/src/dice/*.ts"],
        "@musi/shared/map/*.js": ["packages/shared/src/map/*.ts"],
        "@musi/server/router-type": ["packages/server/src/routers/app-router.ts"],
      },
      bun: true,
      eslint: true,
      "github-actions": true,
      husky: true,
      playwright: true,
      prettier: true,
      stryker: true,
      typescript: true,
      vitest: {
        config: ["vitest.config.ts", "scripts/vitest.config.ts", "eslint-rules/vitest.config.ts"],
        entry: [
          "**/*.{bench,test,test-d,spec,spec-d}.?(c|m)[jt]s?(x)",
          "**/__mocks__/**/*.[jt]s?(x)",
        ],
      },
    },
    "packages/client": {
      entry: [],
      project: ["src/**/*.{ts,tsx}", "src/app.css"],
      vite: true,
      vitest: true,
      typescript: true,
      "tanstack-router": true,
      tailwind: true,
    },
    "packages/server": {
      entry: [
        "src/main.ts",
        "prisma/seed-template.ts",
        "scripts/pgexec.ts",
        // Compile-only negative type tests; deliberately not runtime imports.
        "src/utils/__type-tests__/*.ts",
        // Manual one-off SRD refresh scripts kept for future SRD regeneration.
        "src/seed/generate-*.ts",
      ],
      project: ["src/**/*.ts", "prisma/**/*.ts", "scripts/**/*.ts"],
      prisma: true,
      typescript: true,
      vitest: true,
    },
    "packages/shared": {
      entry: ["src/schemas/*.ts", "src/rules/*.ts", "src/dice/*.ts", "src/map/*.ts"],
      project: ["src/**/*.ts"],
      typescript: true,
      vitest: true,
    },
  },
} satisfies KnipConfig;

export default config;
