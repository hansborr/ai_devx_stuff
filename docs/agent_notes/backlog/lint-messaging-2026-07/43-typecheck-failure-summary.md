# 43. typecheck.sh failure-summary parity with other slots

Status: Done — implemented 2026-07-05; typecheck failures now end with per-lane TypeScript error counts and bounded diagnostic excerpts.
Lens: gates · Area: consistency · Severity: med · Size: S · Confidence: med
Theme: crisp-failure-summary · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Every other verify slot ends a failure with a crisp captured-log excerpt
(the 30-line `ai_filtered_task_log_excerpt` pattern; the scripts slot even
names each failed smoke test with its exact repro command). `typecheck.sh`
is the outlier: on failure it prints only which of its two `tsc`
invocations exited nonzero (`typecheck: tsc -b failed with exit N`),
leaving the agent to scan interleaved `[tsc -b]` / `[tsc -p
tsconfig.scripts.json]` streamed lines for the actual diagnostics.

## Evidence
- `scripts/typecheck.sh:126-131` — exit-code-only failure lines.
- `.husky/pre-commit:524-541` — the Passed/Failed + per-task excerpt
  pattern the other slots get.

## Proposed direction
Capture each `tsc` invocation's output to a per-invocation log (as the
parallel runner does for slots) and on failure print an error-count
summary plus the first/last N diagnostic lines for the failing invocation,
in the same excerpt style. Keep the live streamed output for watchers;
the addition is the failure summary at the end.

## Scope / caveats
- Don't double-print: if the pre-commit layer already excerpts the
  typecheck slot log, the fix may belong in what typecheck.sh writes to
  that log (structure it so the excerpt is useful) rather than a second
  summary. Check how the `typecheck` slot's log flows through
  `parallel-runner.sh` first.
