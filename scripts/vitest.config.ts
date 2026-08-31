import { defaultExclude, defineProject } from "vitest/config";

import { DEFAULT_VITEST_TEST_TIMEOUT_MS, NON_SERVER_TEST_MAX_WORKERS } from "../vitest.config.js";

export default defineProject({
  cacheDir: "../node_modules/.cache/vitest-scripts",
  test: {
    name: "scripts",
    clearMocks: true,
    testTimeout: DEFAULT_VITEST_TEST_TIMEOUT_MS,
    environment: "node",
    include: ["**/*.test.ts"],
    maxWorkers: NON_SERVER_TEST_MAX_WORKERS,
    exclude: [
      ...defaultExclude,
      "**/worktrees/**",
      "codemods/fixtures/**",
      "drift-ai/fixtures/**",
      "logs-audit/fixtures/**",
    ],
    coverage: {
      // Not the load-bearing copy: `bun run test:coverage` runs Vitest in
      // projects mode, where coverage resolves from the root `vitest.config.ts`
      // alone. This block applies only to a standalone
      // `vitest --config <this file>` run.
      include: [
        "codemods/**/*.ts",
        "drift-ai/**/*.ts",
        "harness/**/*.ts",
        "import-closure/**/*.ts",
        "lint-ratchet/**/*.ts",
        "logs-audit/**/*.ts",
        "path-policy/**/*.ts",
        "*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        // Colocated test scaffolding, executed by the suites importing it.
        "**/*.test-helper.*",
        "**/worktrees/**",
        "codemods/fixtures/**",
        "drift-ai/fixtures/**",
        "logs-audit/fixtures/**",
      ],
    },
  },
});
