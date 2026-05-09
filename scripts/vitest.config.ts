import { defaultExclude, defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "scripts",
    environment: "node",
    include: ["codemods/**/*.test.ts", "*.test.ts"],
    exclude: [...defaultExclude, "codemods/fixtures/**"],
    coverage: {
      include: ["codemods/**/*.ts", "*.ts"],
      exclude: ["codemods/**/*.test.ts", "*.test.ts", "codemods/fixtures/**"],
    },
  },
});
