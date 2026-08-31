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
      // Not the load-bearing copy: `bun run test:coverage` runs Vitest in
      // projects mode, where coverage resolves from the root `vitest.config.ts`
      // alone. This block applies only to a standalone
      // `vitest --config <this file>` run.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
