import { defaultExclude, defineProject } from "vitest/config";

export default defineProject({
  cacheDir: "../node_modules/.cache/vitest-scripts",
  test: {
    name: "scripts",
    clearMocks: true,
    environment: "node",
    include: ["**/*.test.ts"],
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
