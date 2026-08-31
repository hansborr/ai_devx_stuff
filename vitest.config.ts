import { defineConfig } from "vitest/config";

import {
  clearTranslatedNativeWorkerOverride,
  maxWorkersFromEnv,
  workerEnvWithTranslatedNativeOverride,
} from "./scripts/vitest-worker-count.js";

export const DEFAULT_VITEST_TEST_TIMEOUT_MS = 30_000;
export const DEFAULT_NON_SERVER_TEST_MAX_WORKERS = 6;
export const MAX_NON_SERVER_TEST_MAX_WORKERS = 8;
// Vitest requires projects in the same sequence group to share maxWorkers.
// Server runs separately in group 1; every other project shares this group-0 cap.
export const NON_SERVER_TEST_MAX_WORKERS = maxWorkersFromEnv(
  ["NON_SERVER_TEST_MAX_WORKERS", "VITEST_MAX_WORKERS"],
  DEFAULT_NON_SERVER_TEST_MAX_WORKERS,
  MAX_NON_SERVER_TEST_MAX_WORKERS,
  workerEnvWithTranslatedNativeOverride(process.env),
);
// The wrapper's translated native env makes CLI effective for workspace
// projects. Remove the synthetic global override after the initial group-0
// capture; the marker lets later project-config module evaluation reconstruct
// that value, while Vitest itself sees no native override for server.
clearTranslatedNativeWorkerOverride(process.env);

export default defineConfig({
  test: {
    testTimeout: DEFAULT_VITEST_TEST_TIMEOUT_MS,
    projects: [
      "packages/shared",
      "packages/server",
      // DB-free server seed/parser tests; see packages/server/vitest.unit.config.ts.
      "packages/server/vitest.unit.config.ts",
      "packages/client",
      "eslint-rules",
      "scripts",
      "tools/lint-ratchet",
      "tools/harness-diagnostics",
    ],
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "json", "text"],
      reportsDirectory: "./coverage",
      // In projects mode Vitest resolves coverage from this root config only
      // (the per-project `coverage` blocks apply solely to standalone
      // `vitest --config packages/<pkg>/vitest.config.ts` runs), so the
      // scaffolding excludes have to live here to take effect. Test-support
      // modules are executed by the suites that import them, so counting them
      // pads the denominator with easily covered lines and makes the
      // thresholds below harder to interpret. Matches stryker's
      // `!packages/shared/src/test/**` classification (`stryker.config.mjs`).
      // The repo spells scaffolding four ways and all four are listed: a
      // `test-helper` sibling of the module it serves (`.test-helper.` when it
      // follows the file it helps, `-test-helper.` when it names a directory
      // family), a per-package `src/test/` directory, and `tools/lint-ratchet`'s
      // top-level `test/` tree. The three `eslint-rules` modules below are named
      // one by one instead: they carry production-looking filenames with no
      // convention to glob, and are identifiable only by import topology (each
      // is imported solely by `*.test.js` suites in that directory). Vitest 4
      // appends its own non-overridable excludes (test files, setup files,
      // config files, `node_modules`) after this list, so this key only has to
      // name the scaffolding patterns.
      exclude: [
        "**/*.test-helper.*",
        "**/*-test-helper.*",
        "packages/*/src/test/**",
        "tools/lint-ratchet/test/**",
        "eslint-rules/rule-tester.js",
        "eslint-rules/repo-config-harness.js",
        "eslint-rules/eslint-config-resolution-timeout.js",
      ],
      // `@musi/shared/test/*.js` resolves through the package's `dist/`
      // build, so a client or server suite records coverage against
      // `packages/shared/dist/test/*.js` and only the source map turns it back
      // into `src/test/`. Re-apply the excludes after that remap, or
      // scaffolding re-enters the denominator by the dist route.
      excludeAfterRemap: true,
      // Floors, not targets. Re-derived 2026-08-30 from a full
      // `bun run test:coverage` against the production-only denominator above
      // (1343 files reported), as lines/statements/functions/branches:
      // shared 99.85/99.70/91.91/98.55, server 94.90/94.09/95.25/87.71,
      // client 88.42/86.76/82.51/82.22, scripts 90.85/88.45/94.14/80.43,
      // global 89.99/88.08/90.01/79.81, harness-diagnostics 100/100/100/90.90.
      // Those groups sit under their measured figures and are unchanged.
      // `eslint-rules/**` (70.57/67.22/68.58/53.43, below on all four) and
      // `tools/lint-ratchet/src/**` (lines 87.51, statements 85.99, branches
      // 78.69 — its 93.50 functions figure clears the 90 floor) sit above
      // theirs and fail the run today. That shortfall predates the scaffolding
      // exclude: the exclude removes nothing from `tools/lint-ratchet/src/**`,
      // and the three named `eslint-rules` test-support modules it does remove
      // are 17 fully covered lines, worth 0.1-0.7pp of that gap (the group
      // measured 70.84/67.49/69.19/53.52 with them counted).
      thresholds: {
        lines: 87,
        statements: 85,
        functions: 82,
        branches: 77,
        "packages/shared/src/**": {
          lines: 99,
          statements: 98,
          functions: 88,
          branches: 89,
        },
        "packages/server/src/**": {
          lines: 93,
          statements: 92,
          functions: 94,
          branches: 86,
        },
        "packages/client/src/**": {
          lines: 82,
          statements: 81,
          functions: 76,
          branches: 75,
        },
        "scripts/**": {
          lines: 87,
          statements: 82,
          functions: 93,
          branches: 73,
        },
        "eslint-rules/**": {
          lines: 79,
          statements: 74,
          functions: 74,
          branches: 69,
        },
        "tools/lint-ratchet/src/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
        "tools/harness-diagnostics/src/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 80,
        },
      },
    },
  },
});
