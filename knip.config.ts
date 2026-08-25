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
    // The portable diagnostics schema is an exported harness contract, so its
    // schema values and inferred types remain intentionally public API.
    "tools/harness-diagnostics/src/**": ["exports", "types"],
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
    "packages/server/src/socket/__type-tests__/**": ["exports", "types"],
    // Stryker loads this configuration module by path, so Knip cannot see its required default export.
    "scripts/stryker-scripts.mjs": ["exports"],
    // The package Git rail imports these adapter exports from configured module
    // paths at runtime; no static import can make them visible to Knip.
    "scripts/lint-ratchet/engine-binding.ts": ["exports"],
    "examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts": ["exports"],
    // Playwright loads this by the `globalSetup` path string in playwright.config.ts,
    // not as an ES import, so Knip cannot see its required default export.
    "e2e/global-setup.ts": ["exports"],
  },
  workspaces: {
    ".": {
      entry: [
        "eslint-rules/*.js",
        "e2e/**/*.ts",
        "scripts/*.sh",
        "scripts/*.ts",
        // CLI and adapter entry points that live one directory down (e.g.
        // cli.ts, engine-binding.ts, path-policy-query.ts); without these globs
        // they false-positive as orphan files.
        "scripts/lint-ratchet/*.ts",
        "scripts/path-policy/*.ts",
        "scripts/ai-hooks/*.sh",
        "scripts/ci/*.sh",
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
        "!scripts/fixtures/**",
        "!scripts/logs-audit/fixtures/**",
      ],
      ignore: ["scripts/codemods/fixtures/**"],
      paths: {
        "@/*": ["packages/client/src/*"],
        "@musi/shared/constants": ["packages/shared/src/constants.ts"],
        "@musi/shared/logging-policy": ["packages/shared/src/logging-policy.ts"],
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
        "src/socket/__type-tests__/*.ts",
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
    "tools/lint-ratchet": {
      // Exported engine surface (per the package.json subpath exports) plus the
      // package-owned tests (co-located under src/ and the boundary tests under
      // test/) are the reachability roots.
      entry: [
        "src/kernel/*.ts",
        "src/git-rail/*.ts",
        "src/governance/*.ts",
        "src/**/*.test.ts",
        "test/**/*.test.ts",
      ],
      project: ["src/**/*.ts", "test/**/*.ts"],
      typescript: true,
      vitest: true,
      // eslint + typescript-eslint are runtime dependencies the engine resolves
      // dynamically (createRequire for ESLint's bin, node_modules version reads
      // for rule-source hashing) and emits into generated config text, never as a
      // static import knip can trace — so declare them for portability but keep
      // them off knip's unused-dependency scan.
      ignoreDependencies: ["eslint", "typescript-eslint"],
    },
    "tools/harness-diagnostics": {
      // The source-mapped schema export and co-located schema tests are the
      // portable package's reachability roots.
      entry: ["src/*.ts", "src/**/*.test.ts"],
      project: ["src/**/*.ts"],
      typescript: true,
      vitest: true,
    },
    "examples/lint-ratchet-demo": {
      // The adapter entry (the CLI) and ESLint config are the reachability roots;
      // the adapter module and eslint-rules are reached from them.
      entry: ["scripts/lint-ratchet.ts", "eslint.config.js"],
      project: ["scripts/**/*.ts", "src/**/*.ts", "eslint-rules/*.js", "eslint.config.js"],
      typescript: true,
      // Same as the engine package: eslint + typescript-eslint are resolved
      // dynamically from the demo repo root (the engine spawns ESLint's bin and
      // reads both package versions for the rule-source hash), never as a static
      // import, so declare them for a real adopter but keep them off the unused
      // scan. zod is the engine's own dependency, resolved from the package, so
      // the demo does not declare it.
      ignoreDependencies: ["eslint", "typescript-eslint"],
    },
  },
} satisfies KnipConfig;

export default config;
