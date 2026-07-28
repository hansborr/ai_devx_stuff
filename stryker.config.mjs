import { createStrykerConfig } from "./stryker.shared.mjs";

export default createStrykerConfig({
  tsconfigFile: "packages/shared/tsconfig.json",
  // Operator-managed tool caches are gitignored and not part of this lane.
  // Excluding them also avoids sandbox-copy failures on virtualenv symlinks.
  ignorePatterns: [".tools"],
  reportDir: "reports/mutation",
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
});
