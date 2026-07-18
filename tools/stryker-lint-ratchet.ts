export default {
  // Explicit plugin list: Bun's hoisted node_modules layout breaks Stryker's
  // default auto-discovery (it scans from @stryker-mutator/core's own tree).
  // Mirrors scripts/stryker-scripts.ts.
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tools/lint-ratchet/tsconfig.json",
  concurrency: 1,
  // In-place (vs the default sandbox) matches the scripts lane: package tests
  // resolve the live workspace via `@musi/lint-ratchet/*` and `import.meta.url`,
  // which a copied sandbox breaks. A hard kill mid-run can leave mutated sources
  // on disk; Stryker restores them from `.stryker-tmp/backup` on a clean exit.
  inPlace: true,
  incremental: true,
  incrementalFile: "reports/mutation-lint-ratchet/stryker-incremental.json",
  vitest: {
    configFile: "tools/lint-ratchet/vitest.config.ts",
    dir: "tools/lint-ratchet",
    related: true,
  },
  mutate: [
    "tools/lint-ratchet/src/**/*.ts",
    "!tools/lint-ratchet/src/**/*.test.ts",
    "!tools/lint-ratchet/**/fixtures/**",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation-lint-ratchet/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation-lint-ratchet/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};
