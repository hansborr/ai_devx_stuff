import { defaultExclude, defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "scripts",
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [
      ...defaultExclude,
      "codemods/fixtures/**",
      "drift-ai/fixtures/**",
      "logs-audit/fixtures/**",
    ],
    coverage: {
      include: ["codemods/**/*.ts", "drift-ai/**/*.ts", "logs-audit/**/*.ts", "*.ts"],
      exclude: [
        "**/*.test.ts",
        "codemods/fixtures/**",
        "drift-ai/fixtures/**",
        "logs-audit/fixtures/**",
      ],
    },
  },
});
