import { createStrykerConfig } from "../stryker.shared.mjs";

export default createStrykerConfig({
  tsconfigFile: "tsconfig.scripts.json",
  // In-place (vs the default sandbox) is load-bearing here: several script
  // tests resolve the live repo via `import.meta.url` and `git` (e.g. the lint
  // ratchet registry check, module-doc-paths), which a copied sandbox breaks
  // because it is not a git checkout. Tradeoff: a hard kill mid-run can leave
  // mutated sources on disk — Stryker restores them from `.stryker-tmp/backup`
  // on a clean exit. Do not switch to sandbox without re-checking those tests.
  inPlace: true,
  reportDir: "reports/mutation-scripts",
  vitest: {
    configFile: "scripts/vitest.config.ts",
    dir: "scripts",
    related: true,
  },
  mutate: [
    "scripts/**/*.ts",
    // codemods are excluded until the trpc-shared-input fixture test is made
    // instrumentation-robust: that test's exact transformed-output comparison
    // fails under Stryker's instrumentation during the dry run, before mutation
    // testing can start. The failure is not isolated to the trpc-shared-*
    // sources (excluding them does not fix it), so it needs a test fix rather
    // than a glob tweak before re-inclusion.
    "!scripts/codemods/**",
    "!scripts/**/*.test.ts",
    "!scripts/**/fixtures/**",
    "!scripts/vitest.config.ts",
  ],
});
