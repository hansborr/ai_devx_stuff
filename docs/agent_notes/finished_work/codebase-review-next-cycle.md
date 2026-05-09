# Codebase Review Next Cycle

Status: Closed.
Validated: 2026-04-29 against the current checkout.
Sources consolidated from the codebase-review backlog and architecture-review
handoff.

Single task list for the next codebase-review cycle. Items below were kept only
when accurate, real, and worth solving. Pick the highest-priority unchecked leaf
unless a human reprioritizes.

## Tasks

## Closed leaves

CR1-CR15 landed. The closure commit for each leaf tags the CR number and
names the pinning test in its message — recover detail with
`git log --grep='CR<n>'`. (CR15 spans `e72d0d1` plus follow-ups
`107015f`/`9312178`/`bf93d6d`/`5aac97b`, none of which carry the `CR15` tag;
search `worker test database` instead.)

## Open leaves

### P2 CR17 Restore SLUG_MAX_LEN and fix GC's worker-DB recognition

CR15 dropped `SLUG_MAX_LEN` from 49 to 42 in `scripts/worktree-db.sh` so that
`musi_wt_<slug>_test_w<key>` fits Postgres' 63-byte identifier limit.
`compute_slug` reserves `SLUG_HASH_LEN + 1` bytes for the trailing `_<6-hex>`,
so the normalized-basename truncation budget went from 42 (49-6-1) to 35
(42-6-1). Any worktree whose normalized basename is **longer than 35 chars**
gets a different slug after upgrade — both the 36-42 range (untruncated under
old, truncated under new) and the >42 range (truncated to a different length
under each). Side effects: `worktree:init` allocates new
`musi_wt_<newslug>{,_test,_e2e}` DBs; `worktree:drop` only drops DBs matching
`newslug`; `cmd_gc` reclaims old DBs by path-derived slug eventually but local
allocation/tombstone/fingerprint state for the old slug stays orphaned until
the last matching DB is gone.

A second CR15 regression compounds it: `cmd_gc`'s post-drop cleanup at
`scripts/worktree-db.sh:1801` matches dead-slug DBs with
`^musi_wt_${slug}\(_test\|_e2e\)\?$`, which excludes `_test_w<key>`. If the
only remaining DB for a tombstoned slug is a worker DB, GC clears its
tombstone, fingerprint, and allocation while the DB persists, resetting the
grace clock on subsequent runs.

- [x] Pick a worker-DB naming scheme that does not consume slug budget and
      restore `SLUG_MAX_LEN` to 49. A hash-only name like
      `musi_wt_w<12-hex>_<key>` is *not* `slug_from_dbname`-reversible; if
      that direction is taken, replace the per-DB slug lookup with computing
      expected worker hashes from live/current slugs at the call sites
      (`cmd_drop`, `cmd_gc`, `list_worktree_dbs` consumers). The simpler
      alternative is to keep the slug visible but tighten the worker key
      budget — e.g. `musi_wt_<slug≤49>_w<1-2 chars>` with `_test_` dropped —
      and adjust `slug_from_dbname` accordingly.
- [x] Update `slug_from_dbname`, `validate_wt_db_name`, and
      `isWorkerDatabaseForBase` (server side) to recognize the chosen shape.
- [x] Update `deriveWorkerTestDatabaseUrl`
      (`packages/server/src/test/test-database-url.ts:41-48`) — the actual
      generator of worker DB URLs — to emit the chosen shape, and refresh the
      `deriveWorkerTestDatabaseUrl` / `getWorkerTestDatabaseUrl` /
      `isWorkerTestDatabaseNameForBase` test cases in
      `test-database-url.test.ts` accordingly.
- [x] Update `TEST_DB_NAME_PATTERN` at
      `packages/server/src/test/prepare-test-db.ts:24-25` to accept the new
      worker DB shape; otherwise `assertSafeTestDbUrl` rejects every worker
      DB and `prepareTestDb()` refuses to run.
- [x] Extend `cmd_gc`'s post-drop cleanup pattern at `worktree-db.sh:1801`
      to recognize worker DBs for the slug, so a leftover worker DB blocks
      tombstone/allocation/fingerprint clearing the same way a leftover
      `_test`/`_e2e` does today.
- [x] Extend `scripts/test-worktree-db.sh` to pin: a `_w` worker DB under the
      new shape is accepted by `validate_wt_db_name`; the slug is recoverable
      (or computable) at the `cmd_drop`/`cmd_gc` call sites; the worst-case
      identifier is `<= 63` bytes; a leftover worker DB blocks GC's local
      state cleanup.
- [x] Confirm `dropStaleWorkerTestDatabases` and the registry filter in
      `worker-test-database.ts` still match.

Previously validated: CR15 had `SLUG_MAX_LEN=42` at
`scripts/worktree-db.sh:75`, and the regex at `scripts/worktree-db.sh:1801`
did not include the `_test_w<key>` suffix added by CR15.

Closed: worktree worker DBs now use `musi_wt_<slug>_w<key>` with a two-character
worker-key cap, restoring `SLUG_MAX_LEN=49` without exceeding Postgres'
63-byte identifier limit. Shell and server cleanup paths recognize the compact
shape, and the server registry/stale-worker filter also accepts CR15-era
`_test_w<key>` names for cleanup. Pinned by `bash scripts/test-worktree-db.sh`
and `bun run vitest run packages/server/src/test/test-database-url.test.ts`.

### P2 CR18 Stop swallowing `list_worktree_dbs` failures in `cmd_drop`

`cmd_drop` at `scripts/worktree-db.sh:945` runs
`dbs="$(list_worktree_dbs || true)"`. On admin DB outage the query exits
non-zero, `|| true` masks it, the drop loop iterates zero rows, and
`forget_worktree_fingerprint` / `tombstone_forget` / `allocation_forget` still
clear local registry state for the slug. `cmd_gc` can still discover orphaned
DBs from `list_worktree_dbs` on a later run — it does not need the per-slug
metadata to reclaim — so the practical harm is allocation/fingerprint/
tombstone drift (port and Redis index freed prematurely; drift baseline lost;
grace clock restarted) plus orphaned DBs sitting around until the next GC
sweep. The `|| true` on the same call inside `cmd_gc` (lines 1755 and 1797)
is intentional (GC is opportunistic); only `cmd_drop` should fail loud.

- [x] Drop the `|| true` in `cmd_drop` so admin-DB failure aborts before
      registry cleanup runs.
- [x] Confirm the no-DBs-yet path still succeeds (empty `SELECT` returns
      success, not failure).
- [x] Add a smoke assertion in `scripts/test-worktree-db.sh` that simulates
      `list_worktree_dbs` failure (e.g., with a stub) and verifies `cmd_drop`
      exits non-zero before any `*_forget` call runs.

Validated: `set -euo pipefail` is in effect (line 63); `run_admin` →
`pg_exec` → `bun pgexec.ts` propagates non-zero on connection failure.

Closed: `cmd_drop` now runs `dbs="$(list_worktree_dbs)"` without the `|| true`
mask, so an admin-DB outage aborts via `set -e` before
`forget_worktree_fingerprint`/`tombstone_forget`/`allocation_forget` can clear
local registry state. `cmd_gc`'s two `|| true` callers are intentional (GC is
opportunistic) and stay as-is. Pinned by `bash scripts/test-worktree-db.sh`,
which stubs `list_worktree_dbs` to (1) return non-zero and asserts `cmd_drop`
propagates the failure with no `*_forget` side effect, and (2) return success
with empty stdout and asserts `cmd_drop` still completes the
fingerprint/tombstone/allocation cleanup without invoking `drop_db`.

### P3 CR19 Document worker test database lifecycle internals

Several deliberate-but-non-obvious choices in CR15's worker DB code lack
inline rationale. Each is a small comment, but together they protect future
readers from "fixing" the design back into bugs.

- [x] `packages/server/src/test/worker-test-database.ts:60-65`: rationale
      comment that `client.connection.stream` is private pg API; the
      `isUnrefable` guard means an upstream rename will silently leave the
      lock-holding socket ref'd, manifesting as hung tests. (No bare `TODO`;
      AGENTS.md:118 forbids unlinked TODOs. If pg later exposes a public
      unref hook, replace via a new leaf rather than a comment marker.)
- [x] `packages/server/src/test/setup.ts:23-30`: explain why the lifecycle
      `release()` is intentionally not called from `afterAll` (was, in
      107015f; replaced with socket `unref` + process-exit advisory-lock
      release in 5aac97b) and why `dropStaleWorkerTestDatabases` is the safety
      net.
- [x] `scripts/worktree-db.sh:73-75`: call out that the 63-byte budget is now
      *exact* with `SLUG_MAX_LEN=42` + `_test_w` + 6-char key, so a future
      suffix change must reduce slug or worker key budget in lockstep. (Drop
      this leaf if CR17 lands first and restores cushion.)
- [x] `packages/server/src/test/test-database-url.ts` near
      `WORKER_KEY_MAX_LENGTH = 6`: tie the cap to `SERVER_TEST_MAX_WORKERS`
      so a future bump past ~10⁶ workers has a visible breadcrumb instead of
      a cryptic "Invalid Vitest worker database key" throw.

Validated: each line referenced above currently lacks the explanatory
comment, even though the prior commit history makes the rationale clear.

Closed: worker DB lifecycle comments now explain the private pg stream unref,
why normal `afterAll` does not call `release()`, and that the worker-key cap is
tied to `SERVER_TEST_MAX_WORKERS`. The old exact-budget script comment item was
made obsolete by CR17, which restored `SLUG_MAX_LEN=49`; the existing
`worktree-db.sh` comment now names that worker DBs do not shrink the slug
budget. Pinned by `bun run verify:changed`.

### P3 CR20 Tighten the `getVitestWorkerKey` "outside a Vitest worker" test

`packages/server/src/test/test-database-url.test.ts:47-49` passes
`{ VITEST_WORKER_ID: "9" }` as the input for the
"does not derive a worker key outside a Vitest worker" assertion. The
function only reads `VITEST_POOL_ID` (107015f), so the test passes by
accident: it really proves `VITEST_POOL_ID` is missing, not that
`VITEST_WORKER_ID` is ignored.

- [x] Replace the input with `{}` (or rename the test to "ignores
      `VITEST_WORKER_ID` when `VITEST_POOL_ID` is missing" and keep the input
      to pin that the function does not fall back to it).

Validated: the test currently passes against the current `getVitestWorkerKey`
implementation, but fails to communicate the intended invariant.

Closed: the "outside a Vitest worker" assertion now uses `{}` so it pins what
its name claims, and a separate `ignores VITEST_WORKER_ID when VITEST_POOL_ID is
missing` case keeps the non-fallback invariant explicit. Pinned by `bun run
vitest run packages/server/src/test/test-database-url.test.ts` (11 tests).

### P3 CR21 Serialize cold-start concurrent worker DB cloning

`prepareLockedWorkerTestDatabase` locks per-worker-DB before
`CREATE DATABASE … WITH TEMPLATE musi_test`. With multiple workers cold-cloning
the same template concurrently, each calls
`terminateDatabaseConnections(musi_test)` and then `CREATE DATABASE`; Postgres
serializes via the template lock, but the race window can surface as a
first-run flake ("source database is being accessed by other users"). Steady
state (worker DBs already exist) is unaffected.

- [x] Wrap the existence-check + create block in a per-base advisory lock
      keyed by the actual base DB name (e.g.
      `pg_advisory_lock(hashtext('clone:' || baseDatabaseName))`), not a
      fixed string. With per-worktree test bases (`musi_wt_<slug>_test`) and
      the primary `musi_test`, a hardcoded key would needlessly serialize
      unrelated test bases.
- [x] Confirm the new lock is released before returning the per-DB lifecycle
      lock so workers don't queue behind each other for the rest of the run.

Validated: the current code path takes only the per-worker-DB advisory lock;
the template-DB protection relies on Postgres' internal serialization, which
is correct but produces racy errors on contention.

Closed: `prepareLockedWorkerTestDatabase` now wraps only the worker-existence
check and `CREATE DATABASE ... WITH TEMPLATE` block in a short-lived
`clone:<baseDatabaseName>` advisory lock, leaving the existing per-worker DB
lifecycle lock as the only lock held after setup returns. Pinned by
`bun run vitest run packages/server/src/test/test-database-url.test.ts`,
including success and failure release-order coverage.

### P3 CR16 Audit broad client `act(...)` warning suppression

- [x] Inventory the tests that still emit act warnings when suppression is
      narrowed locally.
- [x] Keep suppressions that are proven framework noise.
- [x] Replace or narrow suppressions that could hide real async state-update
      regressions.

Closed: a temporary audit run with the broad patterns suppressed-but-recorded
showed the `not wrapped in act(...)` pattern was suppressing nothing
(0 offender files), and `The current testing environment is not configured
to support act(...)` only fired in two files
(`packages/client/src/components/vtt/vtt-surface.test.tsx` and
`packages/client/src/components/vtt/in-vtt-drawer.test.tsx`) — both because
they imported `act` directly from `react`. RTL v16 only flips
`globalThis.IS_REACT_ACT_ENVIRONMENT` inside its own wrapped `act`, so the
unwrapped React `act` warned on every state update. Both files now import
`act` from `@testing-library/react` and `packages/client/src/test/setup.ts`
drops both broad act-warning regexes, leaving only the targeted Radix
`DialogContent` description suppression. The full client suite (236 files,
2907 tests) runs clean with no act warnings.

## Deferred Or Rejected

- Homebrew queryable projections: real future product work, but not a current
  bug. Do not start until there is a concrete search/filter requirement.
- Broad router/service orchestration cleanup: directionally healthy, but too
  broad as a leaf task. Move orchestration opportunistically when touching a
  specific workflow for correctness or testability.
- Casting/drawer flow consolidation: the current code is complex, but a
  `useCastFlow` hook already exists and no specific bug was verified. Reopen
  when cast placement or drawer state changes again.
- Multi-client browser coverage: valuable for VTT flows, but should be attached
  to concrete realtime changes such as CR6 or CR14.
- Encounter participant conditions and `concentrationSpellId` race claims:
  rejected by both source notes. Current production paths use the locked helper
  pattern where strict consistency is required.
- `character.list` broad include claim: rejected. The current list path uses a
  narrow `{ classes: true }` include.

## Closure Protocol

When a leaf lands:

1. Tick every checkbox under that `### CRn` heading.
2. Add a short closure paragraph naming the durable change and the test that
   pins it.
3. Update `NEXT.md` to promote exactly one next unchecked leaf, then stop.
4. Update `STATUS.md` only if the active snapshot changed.
