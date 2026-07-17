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
      include: [
        "codemods/**/*.ts",
        "drift-ai/**/*.ts",
        "harness/**/*.ts",
        "lint-ratchet/**/*.ts",
        "logs-audit/**/*.ts",
        "path-policy/**/*.ts",
        "*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/worktrees/**",
        "codemods/fixtures/**",
        "drift-ai/fixtures/**",
        "logs-audit/fixtures/**",
      ],
    },
  },
});
