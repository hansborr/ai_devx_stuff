# Mutation Testing With Stryker

Status: parked plan
Date: 2026-05-08

## Goal

Add mutation testing as a test-quality audit lane for Musi. The first version
should expose weak or assertion-light tests without making normal development
slower or noisier.

This is especially useful because much of the current suite was AI-written.
Line coverage can prove code executed; mutation testing asks whether tests
would notice meaningful behavior changes.

## Current Repo Shape

- Vitest owns unit/integration tests through root project config:
  `shared`, `server`, `client`, `eslint-rules`, and `scripts`.
- Server tests already isolate Vitest workers with per-worker cloned
  PostgreSQL databases derived from `VITEST_POOL_ID`.
- Slow tests live in `*.slow.test.{ts,tsx}` and are excluded from normal
  `bun run test` / `verify:changed`.
- Verification is already budgeted and cached; mutation testing should stay
  outside `verify`, pre-commit, and the default agent loop.

## Tool Choice

Use StrykerJS with the official Vitest runner:

- `@stryker-mutator/core`
- `@stryker-mutator/vitest-runner`
- `@stryker-mutator/typescript-checker`

Docs to re-check before implementation:

- https://stryker-mutator.io/docs/stryker-js/getting-started/
- https://stryker-mutator.io/docs/stryker-js/vitest-runner/
- https://stryker-mutator.io/docs/stryker-js/typescript-checker/
- https://stryker-mutator.io/docs/stryker-js/parallel-workers/
- https://stryker-mutator.io/docs/stryker-js/incremental/
- https://stryker-mutator.io/docs/stryker-js/configuration/

## Non-Goals

- Do not add mutation testing to `verify`, `verify:changed`, pre-commit, or
  required local hooks in the first pass.
- Do not chase 100% mutation score. Equivalent or low-value mutants are normal.
- Do not start with whole-repo mutation testing.
- Do not make Stryker workers use separate git worktrees. Stryker mutates code
  in its own sandbox; resource isolation should be handled through env-driven
  DB/port selection or by running serially.

## Phase 1: Shared Pure Logic Pilot

**No database involved.** This phase scopes to pure TypeScript logic with no I/O,
so there are zero database isolation concerns. Run this to completion first to
prove the setup works end-to-end.

Add a root `stryker.config.mjs` and package script:

```json
"test:mutation": "stryker run"
```

The shared pilot config is:

```js
export default {
  // Bun's hoisted node_modules layout can break Stryker's default plugin
  // auto-discovery, so load the official runner/checker explicitly.
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
  mutate: ["packages/shared/src/rules/**/*.ts", "!**/*.test.ts", "!**/*.slow.test.ts"],
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
```

Add `reports/mutation/` and `.stryker-tmp/` to `.gitignore` if not already
present.

### Baseline Capture

Before fixing any tests, run the pilot to completion and capture baseline
scores:

```bash
bun run test:mutation
```

Observed first clean runtime for the shared pilot was about **6 minutes**
serially; unchanged incremental reruns can complete in seconds by reusing the
prior report. This creates the HTML, JSON, and incremental reports under
`reports/mutation/`. Record the baseline score; subsequent test improvements
should show measurable progress rather than starting from zero.

Acceptance:

- `bun run test:mutation` completes on the shared pilot scope.
- Reports are written to `reports/mutation/` and Stryker temp files stay ignored.
- `thresholds.break` remains `null`; the command reports quality but does not
  fail a build solely on score.
- Baseline mutation score is captured for comparison.
- First triage records a short summary: useful survivor examples, noisy
  equivalent-mutant examples, and recommended next scope.

## Phase 2: Triage Workflow

Create a new section `## Mutation Testing` in `docs/ai-harness.md` explaining
how to read a report and what actions to take:

### Report Status Types

- `Killed`: a test caught the mutation.
- `Survived`: a test ran but did not catch the behavior change.
- `NoCoverage`: no relevant test covered the mutant.
- `CompileError`: the TypeScript checker rejected the mutant.
- Timeout/runtime errors need manual review; they may be real infinite loops or
  test harness issues.

### Triage Rules

- **Useful Survivor (fix the test):** A real bug hiding in weak assertions.
  Example: `if (x > 0)` mutated to `if (x >= 0)` with no boundary test. Add a
  case where `x === 0` should behave differently.
- **Noise/Equivalent Mutant (mark & exclude):** The mutation doesn't change
  behavior. Example: `!x` → `!!x` in a pure logic module. Safe to mark as
  reviewed and documented as excluded in future runs.
- Add behavior-focused tests only for meaningful missed behavior, not to match
  the implementation line-by-line.
- Prefer scenario tables and domain examples over assertions that mirror
  implementation details.
- Mark or exclude only reviewed equivalent cases. Avoid broad mutator
  exclusions until repeated triage justifies them.
- Keep survivor fixes out of the mutation setup PR; setup and test-quality
  remediation are easier to review separately.

## Phase 3: Server Service Scope

**Database isolation required.** Unlike Phase 1 (pure logic), this phase touches
stateful services and requires a test database. Do not start Phase 3 until
Phase 1 triage is complete and the team agrees on the next scope.

After the shared pilot is useful, add a separate server config or script, such
as `test:mutation:server`, scoped to selected service modules:

- `packages/server/src/services/level-up/**/*.ts`
- `packages/server/src/services/spell-casting/**/*.ts`
- `packages/server/src/services/combat-actions/**/*.ts`
- other pure or mostly pure services with meaningful domain invariants

Start with `concurrency: 1` (serial execution).

### Database Isolation Challenge

Stryker spawns its own worker processes and exposes `STRYKER_MUTATOR_WORKER` for
resource partitioning. However, Musi's current server test DB isolation in
`packages/server/src/test/test-database-url.ts` keys only off `VITEST_POOL_ID`.
Parallel Stryker workers can collide on the same derived test databases unless
the key derivation includes both ids.

**Two options:**

1. **Fix DB isolation** (enables parallelism): Update `test-database-url.ts` to
   derive worker DB keys from both `STRYKER_MUTATOR_WORKER` and `VITEST_POOL_ID`.
   Keep Postgres identifier limits in mind: `musi_wt_<slug>_w<key>` must fit
   under the 63-byte identifier limit, so use short suffixes.

2. **Document serial-only** (simpler, acceptable): Keep `concurrency: 1` and
   document the tradeoff. Phase 1 proves mutation testing value; serial Phase 3
   is reasonable while the focus is triage, not speed.

Decide which after Phase 1 is stable.

## Phase 4: Client Scope

Add client mutation testing only after shared and server patterns are stable and
a triage workflow is proven. Start with hooks and pure libraries before
component-heavy pages:

- `packages/client/src/lib/**/*.ts`
- `packages/client/src/hooks/**/*.ts`
- focused feature hooks where tests already use stable harnesses

**Caution:** jsdom-heavy component tests produce slower, noisier reports.
Prefer narrow `mutate` globs and manual runs over broad client-wide jobs. This
phase is lower priority; focus on shared and server value first.

## CI And Scheduling

Recommended order:

1. Manual local command only.
2. Optional async/nightly job that uploads HTML/JSON reports.
3. Optional scoped CI job for changed files or critical packages.
4. Score gate only after the team has triaged noise and agreed on a baseline.

Stage 2 landed 2026-07-19: the weekly slow-drift lane
(`.github/workflows/slow-drift.yml` → `scripts/slow-drift-audit.sh`) runs a
scoped shared-rules mutation pass behind `MUSI_SLOW_DRIFT_MUTATION=1` and
summarizes survivors with `bun run mutation:survivors` into the uploaded
fused artifacts. Report-only: `thresholds.break` stays null and mutation
failures never fail the lane.

Do not block normal PRs on mutation score during the rollout. A later gate, if
added, should be scoped and low-surprise, such as "critical shared rules must
not regress below the agreed baseline".

## Implementation Checklist

- [x] Add Stryker dependencies with Bun and commit the lockfile change.
- [x] Add `stryker.config.mjs` for the shared pilot.
- [x] Add `test:mutation` to `package.json`.
- [x] Ensure generated reports and incremental state are ignored or placed in
  already ignored report directories.
- [x] Run `bun run test:mutation` and record runtime plus report location.
- [x] Add a short docs entry describing when to run mutation testing and how to
  triage survivors.
- [x] Decide whether server mutation tests stay serial or get
  `STRYKER_MUTATOR_WORKER`-aware DB isolation. Decided 2026-06-17: stay serial
  (`concurrency: 1`). One mutant under test at a time keeps Vitest's own
  `VITEST_POOL_ID` worker DBs collision-free without touching the shared
  isolation helper. Revisit only if server runtime becomes the bottleneck.
- [x] Re-run `bun run verify:changed` after config/package changes.

## Phase 1 Attempt Notes

2026-05-08: Initial `bun run test:mutation` attempt failed before producing a
baseline score or reports. Runtime before failure was 0m2.129s. Stryker found
16 shared rules files and instrumented 1,438 mutants, then exited with
`Cannot find Checker plugin "typescript". In fact, no Checker plugins were
loaded. Did you forget to install it?`. It also warned that `vitest` was an
unknown config option.

Diagnosis: the packages were installed and version-aligned at 9.6.1, but Bun's
layout put the runner/checker plugins outside the internal `node_modules` tree
that Stryker's default `@stryker-mutator/*` auto-discovery scans from
`@stryker-mutator/core`. Explicit `plugins` loading fixed both the missing
checker and the `vitest` option warning. The TypeScript checker then needed
`packages/shared/tsconfig.json`; the root `tsconfig.json` checks all project
references and hit unrelated client declaration errors before mutation testing.

2026-05-08 baseline: `bun run test:mutation` completed with the shared rules
pilot scope unchanged at 16 files / 1,438 mutants and `thresholds.break: null`.
Runtime was 5m59s per Stryker, 360.759s wall time. Mutation score was 70.25%
total / 70.88% covered. Counts: 628 killed, 258 survived, 8 no coverage, 0
timeouts, 544 compile errors. Reports:
`reports/mutation/index.html`, `reports/mutation/mutation.json`, and
`reports/mutation/stryker-incremental.json`.

## Scope Expansion (2026-06-17)

Broadened past the original rules-only pilot:

- **Shared**: `test:mutation` now mutates all of `packages/shared/src/**`
  (dice, map, schemas, rules), not just `rules/**`. Still pure logic, no DB.
- **Server (Phase 3 landed)**: added `stryker.config.server.mjs` +
  `test:server:mutation`, scoped to `packages/server/src/services/**`. Runs
  serial + `inPlace` with a dedicated `packages/server/vitest.mutation.config.ts`
  (Stryker resolves Vitest's root to the repo root, breaking the base config's
  relative `globalSetup`/`setupFiles`; the wrapper pins `root` and uses absolute
  setup paths). The dry run is scoped to service tests so env-fragile app/router
  tests (e.g. `app.test.ts`'s `CORS_ORIGIN` assertion, which a provisioned
  worktree overrides) can't abort it.
- `.stryker-tmp/` is now ESLint-ignored so in-place backups / crashed-run
  sandboxes never break `lint:changed`.

Baselines for the expanded scopes are being captured via an overnight run
(`reports/mutation-overnight/`); triage of survivors stays a separate effort
from this setup work, per the Phase 2 rule.

Phase 4 (client) remains unstarted and lower priority.

## Open Questions

- Should the first pilot target all `packages/shared/src/rules/**/*.ts`, or a
  smaller rules module with known high business value?
- Should mutation reports live under `reports/mutation/`, `coverage/mutation/`,
  or another repo-standard artifact directory?
- Is nightly CI wanted soon, or should this remain a human-run audit command
  until the first survivor triage is complete?
