export default {
  // Explicit plugin list: Bun's hoisted node_modules layout breaks Stryker's
  // default auto-discovery (it scans from @stryker-mutator/core's own tree).
  plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
  testRunner: "vitest",
  checkers: ["typescript"],
  // Package tsconfig, not the root: the root checks all project references and
  // trips on unrelated client declaration errors (see the shared pilot notes).
  tsconfigFile: "packages/server/tsconfig.json",
  // Serial at the Stryker level: exactly one mutant under test at a time. This
  // sidesteps the DB-isolation gap in test-database-url.ts (it keys worker DBs
  // off VITEST_POOL_ID only, not STRYKER_MUTATOR_WORKER), so parallel Stryker
  // workers would collide on the same per-worker test databases. Within a single
  // Stryker worker, Vitest's own pool ids stay collision-free. Slow but correct;
  // this scope is meant for overnight runs where wall time is not the constraint.
  concurrency: 1,
  // In-place (vs the default sandbox), matching scripts/stryker-scripts.ts. The
  // server vitest config resolves globalSetup/setupFiles ("src/test/*.ts") and
  // the per-worktree test DB relative to the live worktree root; Stryker's copied
  // sandbox breaks that path resolution (global-setup is looked up at
  // <sandbox>/src/test instead of <sandbox>/packages/server/src/test) and the
  // dry run fails. Tradeoff: a hard kill mid-run can leave mutated sources on
  // disk — Stryker restores them from .stryker-tmp/backup on a clean exit.
  inPlace: true,
  incremental: true,
  incrementalFile: "reports/mutation-server/stryker-incremental.json",
  vitest: {
    configFile: "packages/server/vitest.mutation.config.ts",
    dir: "packages/server",
    related: true,
  },
  // Service layer only: the domain logic worth auditing. Excludes routers,
  // generated Prisma client, and seed data, which carry little behavior to
  // mutate and would only bloat the run.
  mutate: ["packages/server/src/services/**/*.ts", "!**/*.test.ts", "!**/*.slow.test.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation-server/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation-server/mutation.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};
