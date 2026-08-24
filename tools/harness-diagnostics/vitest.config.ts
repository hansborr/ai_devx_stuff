import { defaultExclude, defineProject } from "vitest/config";

import {
  DEFAULT_VITEST_TEST_TIMEOUT_MS,
  NON_SERVER_TEST_MAX_WORKERS,
} from "../../vitest.config.js";

export default defineProject({
  cacheDir: "../../node_modules/.cache/vitest-harness-diagnostics",
  test: {
    name: "harness-diagnostics",
    clearMocks: true,
    testTimeout: DEFAULT_VITEST_TEST_TIMEOUT_MS,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...defaultExclude, "**/worktrees/**"],
    maxWorkers: NON_SERVER_TEST_MAX_WORKERS,
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
