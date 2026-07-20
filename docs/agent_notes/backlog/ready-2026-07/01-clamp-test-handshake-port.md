# Port ready/release handshake to the timeout-clamp commit-queue test

Status: Done — landed 2026-07-19 (wave-1 ready-2026-07 drain; mechanical port of the proven e4f54b1f/3ccefe73 handshake).
Date: 2026-07-19
Source: live load reproduction while draining the commit-queue-test-load-flake
note (fixed in fix/commit-queue-test-flake, e4f54b1f + 3ccefe73; note removed
2026-07-19 — git history).
Size: S.

## Evidence

`assert_git_commit_quiet_timeout_clamps_to_hook_margin` (ai-hooks suite,
scripts/ai-hooks/test.sh:2315) still uses the wall-clock holder pattern
its shared-queue sibling was just cured of: a raw-flock holder subshell
(`flock -n 8 || exit 1`, then `sleep 2`) with a fixed `sleep 0.2`
startup grace and NO acquisition handshake — nothing proves the holder
owns the flock before the waiter dispatches.

Live reproduction, 2026-07-19: with 12 leaked CPU busy-loops pegging the
16-core box (load ~25), two consecutive solo full-suite runs failed at
this test's `shared commit queue lock` assertion (test.sh:2345). The
waiter's reason was the wrapper's OWN failure path from
`$FEATURE_BRANCH_REPO` ("Commit failed (exit 1). On branch feat/policy …
Initial commit … nothing to commit") — i.e. the waiter acquired the
queue uncontended because the holder lost the 0.2s startup race. The
handshake-fixed sibling (`…shared_queue_blocks_other_worktrees`) passed
in both of those load-25 runs, isolating the remaining hazard to this
test.

Cost when it bites: same as the sibling's old flake — the land runner
stops at the first failing suite, burning a full land attempt before a
solo rerun proves flake.

## Fix

Port the two-marker handshake, fixture-side only:

- Holder subshell: after `flock -n 8` succeeds and the holder line is
  written, `touch` a `ready` marker, then block until a `release`
  marker exists. Bound the release wait INSIDE the holder loop (e.g.
  ~30s of short sleeps): unlike the sibling, this holder is a raw
  subshell with no wrapper watchdog behind it, so an unbounded loop
  could leak forever.
- Test: wait boundedly for `ready` (release+reap+fail on expiry), run
  the waiter, then touch `release` and reap BEFORE any assertion or
  parse step. The suite runs under `set -euo pipefail`, so guard the
  fallible substitutions (`jq -r` on hook output, the `( cd … ) ||
  fail` fixture block) exactly as 3ccefe73 did for the sibling —
  cleanup must be unreachable-to-skip on implicit errexit paths too.
- Keep the existing assertions: `decision=block`, the shared-queue
  reason text, and both clamp stderr lines for the canonical
  `MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT` value and generated hook ceiling.
  The shell test intentionally pins those values as exact output strings.

## Non-goals

Test-determinism only. The wrapper's clamp math, queue wait, and
heartbeat behavior are believed correct — do not change
git-commit-quiet.sh to make the test pass.
