import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/shared", "packages/server", "packages/client", "eslint-rules", "scripts"],
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "json", "text"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 81,
        statements: 79,
        functions: 71,
        branches: 72,
      },
    },
  },
});
