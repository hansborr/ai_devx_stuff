import { defaultExclude, defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...defaultExclude, "**/*.slow.test.*"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
