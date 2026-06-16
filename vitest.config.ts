import { defineConfig } from "vitest/config";

export const DEFAULT_VITEST_TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    testTimeout: DEFAULT_VITEST_TEST_TIMEOUT_MS,
    projects: ["packages/shared", "packages/server", "packages/client", "eslint-rules", "scripts"],
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
      },
    },
  },
});
