import { createStrykerConfig } from "../stryker.shared.mjs";

export default createStrykerConfig({
  tsconfigFile: "tools/lint-ratchet/tsconfig.json",
  // In-place (vs the default sandbox) matches the scripts lane: package tests
  // resolve the live workspace via `@musi/lint-ratchet/*` and `import.meta.url`,
  // which a copied sandbox breaks. An in-place run rewrites the whole tree, not
  // just the globs below — `disableTypeChecks` defaults to true, so every JS/TS
  // file gets `// @ts-nocheck` written into it — and a kill Stryker never
  // observes (SIGKILL, OOM) leaves all of it on disk. Stryker recovers by moving
  // `.stryker-tmp/backup-*` back on exit and on the signals it handles;
  // scripts/mutation-run.sh covers the rest with a clean-target preflight,
  // interrupted-run detection, and a backup-first recovery. Never delete
  // `.stryker-tmp` to get unstuck: it is the only complete copy of your pre-run
  // files. Run this lane through `bun run test:lint-ratchet:mutation`, not a
  // bare `stryker run`.
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
