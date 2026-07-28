# Parallel Script-Smoke Output Decision

Status: Deferred after adversarial review — below P3
Date: 2026-07-21

## Finding

The full 52-smoke parallel run emits roughly 105 wrapper lines: starts,
per-smoke OK lines, and a final list of every passing name. A measured transcript
was about 5.7 KB. Per-smoke logs already retain child output.

## Decision

Do not add liveness timers, signal summaries, or exact
selected/started/passed/failed/not-started state to solve this output polish.
Quiet hooks already hide the transcript, changed mode usually selects a subset,
and current signal cleanup is tested.

If direct full-suite output becomes a measured context or log-storage problem,
add a simple quiet non-TTY mode:

- one start line with count/concurrency/log directory;
- one bounded green count/duration summary;
- existing failed names, paths, and tails on red;
- existing sequential streaming or an explicit verbose mode for debugging.

Reopen only after direct full runs are common enough that this noise costs more
than the added output-mode branch.
