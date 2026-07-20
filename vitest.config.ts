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
    ],
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "json", "text"],
      reportsDirectory: "./coverage",
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
      },
    },
  },
});
