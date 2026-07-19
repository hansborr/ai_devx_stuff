# Commit-queue blocking test flakes under parallel-lane load

Status: Done — 2026-07-19, implemented in this branch (two-marker ready/release handshake in the shared-queue test; wall-clock sleep and content poll removed).
Date: 2026-07-19
Source: recurring land-gate flake during 2026-07 parallel drains
(re-confirmed 2026-07-16 and 2026-07-18); currently handled by the
"land when lanes are quiet + solo rerun" workaround.
Size: S–M.

## Evidence

`assert_git_commit_quiet_shared_queue_blocks_other_worktrees` (ai-hooks
commit-queue suite) fails under parallel-lane load and passes solo. One
mechanism, two faces:

**The poll checks content, not lock liveness.** The wrapper truncate-writes
`PID=... CMD=...` into the queue-lock file AFTER acquiring, and nothing
clears it on release — so the test's `grep -qF "CMD=git commit --dry-run"`
poll proves "a holder wrote this at some point", not "the flock is held
right now". The residue that satisfies the poll is the fixture's OWN
holder after it exits (the lock path is already private under
`$TMP_ROOT`, so foreign queue traffic cannot reach it). Under load, the
holder's fixed `sleep 2` hold window burns down while the poll waits and
the second invocation dispatches; the holder releases, the stale content
still satisfies the poll, and the waiter sees an uncontended acquire.

Cost when it bites: the land runner stops at the first failing suite, so
each occurrence burns a full land attempt (~10–15 min) before the solo
rerun proves it was flake, and it erodes trust in real queue regressions.

## Fix

Two-marker handshake, replacing both the wall-clock `sleep 2` and the
content poll:

- The holder's command creates a `ready` marker (its position after
  `git commit --dry-run` in the CMD string means the wrapper has acquired
  the queue by then), then blocks until a `release` marker exists.
- The test waits boundedly for `ready`, runs the waiter invocation,
  asserts the block, touches `release`, then reaps the holder — with
  cleanup that touches `release` and waits on every failure path so a
  failed assertion can't leak a blocked holder.
- Keep asserting `decision=block` and the shared-queue reason text, but
  don't depend on CMD-substring residue from a finished holder.

Acceptable simplification if the handshake fights the fixture: drop the
background wrapper invocation and have the test hold the flock itself
(the `timeout_clamps_to_hook_margin` sibling already uses a raw-flock
holder), writing the holder line by hand. Trade-off: no longer exercises
the production wrapper's acquisition path, which is half this test's
point — prefer the handshake.

## Considered, not fixes

- **Nonce-stamping the lock content**: a nonce proves WHOSE content was
  written, not that the lock is still held — the fixture's own nonce
  residue survives release exactly like the current content does. It
  cannot create a contention window.
- **Private queue/lock directory**: already the status quo — the test
  sets `MUSI_COMMIT_QUEUE_LOCK` beneath the per-suite `$TMP_ROOT`.

## Non-goals

This is a test-determinism leaf. The production queue behavior (bounded
foreground wait, holder/waiter heartbeats) is believed correct — do not
change wrapper semantics to make the test pass.
