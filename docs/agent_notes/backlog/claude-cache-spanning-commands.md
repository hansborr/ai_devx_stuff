# Claude Cache-Spanning Commands

Status: Parked, design needed
Filed: 2026-05-21
Related: `cache-budget-followups.md`, `.husky/pre-commit` watchdog,
`.claude/hooks/git-commit-quiet.sh`

## Problem

Foreground Bash calls longer than ~5 minutes blow Claude's session prompt
cache (TTL ~5 min). The next response pays a full cache-miss read of the
conversation — slower and more expensive. Today's mitigation is the 240s
pre-commit watchdog (`MUSI_VERIFY_TIMEOUT` / `MUSI_INTERACTIVE_TIMEOUT`),
which fails the commit cleanly rather than letting it drift past the cache
window.

When legitimately slow work needs to happen at commit time (e.g. a heavy
`test:scripts:changed` smoke), the current escape hatch is
`MUSI_VERIFY_TIMEOUT=900 git commit ...`. This works but pays the full
cache miss and tells future Claude sessions nothing about when to expect
slowness.

The obvious alternative — `run_in_background=true` on the git commit —
has produced bad behavior in practice: Claude polls in tight loops with
no sense of elapsed time, starts incompatible parallel work, or trips
test/resource collisions. Per user instruction, do NOT recommend this
pattern until the polling/parallel-work issues are solved.

## Acceptance Criteria

A solution that satisfies all of:

1. Commands expected to take slightly longer than 5 minutes can complete
   without forcing Claude to pay a cache-miss read on the next turn.
2. Claude does NOT attempt parallel work that could conflict with the
   in-flight slow command (no concurrent tests, no concurrent commits, no
   touching staged files).
3. Claude's wake-up cadence stays close to ~4 minutes — not shorter
   (wasted tokens from over-polling) and not longer (wasted tokens from
   cache expiration).
4. The mechanism degrades gracefully when invoked by a human shell rather
   than Claude — pre-commit must still feel synchronous from a human's
   point of view.
5. The mechanism does not silently let an unverified commit land. If the
   inner gate fails, the commit must still be rejected (or rolled back
   in a way that prevents push).

## Sketches (not decisions)

- **Wrapper-mediated reattach:** `.claude/hooks/git-commit-quiet.sh`
  runs the inner `git commit` in foreground; near the cache window, it
  flips to a watched-background mode and returns an exit code Claude
  recognizes as "monitor, don't restart." Requires a Claude-visible
  status surface so the monitor wake-up is bounded.
- **Pre-commit split:** keep a fast must-pass gate at commit time; let a
  slower verification continue post-commit but block `git push` until it
  completes. This requires a robust pending-verification marker and a
  pre-push hook that consults it.
- **Cache-aware scheduling primitive:** a harness-side helper that wakes
  Claude every ~240s while a tracked command is running. Solves the
  cadence requirement but needs harness work, not script work.

Each sketch has tradeoffs around criterion 2 (parallel work prevention)
that need designing before implementation.

## Current Gate

Defer until pre-commit perf work lands and we see how often slow commits
actually persist. If the wall time stays under 240s typical with the
parallelization work, this may not need solving.
