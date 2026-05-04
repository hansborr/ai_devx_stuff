import path from "node:path";
import { defaultExclude, defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    name: "client",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [...defaultExclude, "**/*.slow.test.*"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
    },
  },
});
