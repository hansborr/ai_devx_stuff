import { createStrykerConfig } from "../stryker.shared.mjs";

export default createStrykerConfig({
  tsconfigFile: "tsconfig.scripts.json",
  // In-place (vs the default sandbox) is load-bearing here: several script
  // tests resolve the live repo via `import.meta.url` and `git` (e.g. the lint
  // ratchet registry check, module-doc-paths), which a copied sandbox breaks
  // because it is not a git checkout. Tradeoff: an in-place run rewrites the
  // whole tree, not just the globs below — `disableTypeChecks` defaults to true,
  // so every JS/TS file gets `// @ts-nocheck` written into it — and a kill
  // Stryker never observes (SIGKILL, OOM) leaves all of it on disk. Stryker
  // recovers by moving `.stryker-tmp/backup-*` back on exit and on the signals
  // it handles; scripts/mutation-run.sh covers the rest with a clean-target
  // preflight, interrupted-run detection, and a backup-first recovery. Never
  // delete `.stryker-tmp` to get unstuck: it is the only complete copy of your
  // pre-run files. Run this lane through `bun run test:scripts:mutation`, not a
  // bare `stryker run`. Do not switch to sandbox without re-checking those tests.
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
