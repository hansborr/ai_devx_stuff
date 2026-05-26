# Cache-Budget Follow-ups

Status: Parked, conditional follow-ups
Last triaged: 2026-05-08
Source: `../finished_work/cache-budget-verification-plan.md`

The cache-budget implementation is landed: timing metadata, explicit slow-test
tier, 240s interactive budgets, short Stop hooks, detached async verification,
and async Stop-reporter hardening are in place.

## Remaining Work

- Optimize typecheck only if serial measurements show it regularly exceeds the
  210s warm warning budget or 240s cold hard budget. Start with `tsc -b
  --verbose`, `tsconfig.tsbuildinfo` placement/reuse, composite/noEmit
  settings, generated/seed-heavy path exclusions, and whether a changed-file
  typecheck mode is feasible without weakening pre-commit.
- Add per-test slow helpers only if the whole-file `*.slow.test.{ts,tsx}` tier
  proves too coarse. A test should not require both `RUN_TIMING_TESTS=1` and
  `MUSI_RUN_SLOW_TESTS=1`.
- Add an async e2e command only with an explicit environment and failure-mode
  design. `verify:async:slow` intentionally excludes e2e.
- Any future Stop-hook reporter must have a kill switch, skip-success or
  skip-non-actionable behavior, and a per-state dedup counter.

## Current Gate

No cache-budget follow-up is justified unless new timing data shows a recurring
budget problem or a concrete hook/dashboard consumer appears.

2026-05-25 update: the user explicitly requested a new autonomous optimization
entry for commands agents run and commands hooks run, covering `verify`,
`verify:changed`, `verify:parallel`, pre-commit latency, and the subcommands
those wrappers invoke. Include possible `AGENTS.md` and commit-hook changes
when measurement shows they reduce wait time or duplicate work. Treat that as a
human-promoted reason to start with measurement and one bottleneck at a time;
the gathered entry lives in `autonomous-agent-iteration-candidates.md`.
