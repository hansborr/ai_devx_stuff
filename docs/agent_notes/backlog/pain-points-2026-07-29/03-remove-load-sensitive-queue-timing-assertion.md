# Remove the Load-Sensitive Queue Timing Assertion

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `gate-timeouts-and-load.md` — “Resolved-config and memory timing
assertions”; `test-fixtures-races-and-environment.md` — “Synthetic load must
clean itself up”

## Problem

The pre-commit fixture for memory-admission timeout measures whole-process wall
time with one-second-resolution timestamps and requires it to finish in under
five seconds (`scripts/tests/test-dependency-freshness.sh:762-787`). The same
fixture already performs the stronger correctness checks: it requires a
nonzero hook result and the configured one-second timeout diagnostic, then
acquires the commit queue with nonblocking `flock`
(`scripts/tests/test-dependency-freshness.sh:785-794`).

The archive records the assertion as the only failure of an otherwise-green
39-minute verify after the fixture took six seconds, and a second six-second
recurrence that passed unchanged on retry
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:685-700`
and
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:722-730`).
A busy sibling lane therefore changes this lane's verify verdict even though
the resource deadline and lock-release invariants both hold.

This is load-induced test flake, not shared-log or result-attribution
corruption. It is also not a request to remove the intentional Git-common-dir
commit queue (`scripts/lib/verify-metadata.sh:265-269`) or the pre-commit
memory-wait cap (`.husky/pre-commit:299-310`).

## Correction — 2026-07-30

The sibling-lane cause stated above is retained as the incident's original
inference but is retracted. The forensic archive later found 36 orphaned
synthetic-load spinners holding the host at load ~37 for 10.4 hours, explicitly
identified this fixture as one of the poisoned runs, and retracted the earlier
“~15 co-tenant worktrees” attribution
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:732-750`).
The second recurrence showed that the wall-clock assertion was unsound, but did
not establish sibling-lane contention as its cause.

The durable classification is a performance observation embedded in a
correctness fixture: the implementation remains correct because it removed
that assertion while retaining the behavioral contract. This incident is not
evidence for CPU arbitration or load-adaptive deadlines.

## Scope

- In `scripts/tests/test-dependency-freshness.sh`, delete `start_seconds`,
  `elapsed_seconds`, and the `<5s` assertion from the memory-timeout fixture at
  lines 762-794.
- In that same fixture, retain `MUSI_VERIFY_MEMORY_WAIT_TIMEOUT=1`, require a
  nonzero hook exit, assert the exact `memory wait timed out after 1s`
  diagnostic, and retain the immediate nonblocking `flock` probe.
- Strengthen the same fixture to assert that the hook's terminal summary names
  every slot left pending by admission timeout, without pinning whether the
  slot is labeled `Failed` or `Not run`; leaf 12 owns that classification. Do
  not replace this with another whole-process elapsed-time threshold.
- Update the hand-maintained `docs/generated/observed_flaky_tests.md` in the
  same implementation change. No current entry records this memory-admission
  queue fixture (entry #2 is the unrelated, already-closed verify-log
  marker-age incident), so add a closed entry naming the removed coarse `<5s`
  wall-clock check and the retained exit, timeout-diagnostic, terminal-summary,
  and nonblocking-queue invariants.
- No production file changes are in scope.

## Acceptance

- `bash scripts/tests/test-dependency-freshness.sh` passes without any
  assertion on total process duration.
- The fixture fails if the hook succeeds, omits `memory wait timed out after
  1s`, omits a pending slot from its terminal summary, or leaves
  `MUSI_COMMIT_QUEUE_LOCK` locked.
- `.husky/pre-commit` and `scripts/lib/verify-metadata.sh` are unchanged, so
  the production 30-second memory cap and Git-common-dir queue policy remain
  intact.
- The flaky-test registry contains a new closed entry for this exact fixture
  and does not rewrite or relabel entry #2.

## Resolved decisions

- Remove the end-to-end elapsed-time assertion entirely. The archive has two
  identical false failures, while the hook exit, timeout diagnostic, pending
  slot summary, and nonblocking lock probe test the actual contract.
- Keep the one-second configured deadline. It makes the timeout path cheap and
  deterministic without treating shell startup and teardown time as product
  behavior.

## Open questions

None.
