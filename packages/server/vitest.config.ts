import { defaultExclude, defineProject } from "vitest/config";

import { SERVER_TEST_MAX_WORKERS, SERVER_TEST_POOL_MAX } from "./src/test/test-database-url.js";

const testDbUrl =
  process.env["TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"]?.replace(/\/[^/]+$/, "/musi_test") ??
  "";
const testJwtSecret =
  process.env["JWT_SECRET"] ?? "test-only-jwt-secret-with-enough-entropy-for-vitest";

export default defineProject({
  test: {
    name: "server",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...defaultExclude, "**/*.slow.test.*"],
    setupFiles: ["src/test/setup.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    maxWorkers: SERVER_TEST_MAX_WORKERS,
    sequence: {
      groupOrder: 1,
    },
    env: {
      DATABASE_URL: testDbUrl,
      DATABASE_POOL_MAX: String(SERVER_TEST_POOL_MAX),
      JWT_SECRET: testJwtSecret,
    },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/generated/**", "src/seed/**"],
    },
  },
});
