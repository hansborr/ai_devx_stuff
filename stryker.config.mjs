export default {
  // Explicit plugin list: Bun's hoisted node_modules layout breaks Stryker's
  // default auto-discovery (it scans from @stryker-mutator/core's own tree).
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "packages/shared/tsconfig.json",
  concurrency: 1,
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  vitest: {
    configFile: "packages/shared/vitest.config.ts",
    dir: "packages/shared",
    related: true,
  },
  // Broadened from the rules-only pilot to all of shared's pure logic
  // (dice, map, schemas, rules). Still zero I/O, so no DB isolation concerns.
  mutate: [
    "packages/shared/src/**/*.ts",
    "!**/*.test.ts",
    "!**/*.slow.test.ts",
    // Test-only scaffolding under src/test/ has no behavior worth mutating.
    "!packages/shared/src/test/**",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};
