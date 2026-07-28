import { createStrykerConfig } from "../stryker.shared.mjs";

export default createStrykerConfig({
  tsconfigFile: "tools/lint-ratchet/tsconfig.json",
  // In-place (vs the default sandbox) matches the scripts lane: package tests
  // resolve the live workspace via `@musi/lint-ratchet/*` and `import.meta.url`,
  // which a copied sandbox breaks. A hard kill mid-run can leave mutated sources
  // on disk; Stryker restores them from `.stryker-tmp/backup` on a clean exit.
  inPlace: true,
  reportDir: "reports/mutation-lint-ratchet",
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
});
