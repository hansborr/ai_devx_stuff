# 10. Single verify engine under verify.sh and pre-commit

Status: Pending
Size: M-L · Severity: high (the two highest-churn hand-written files) · Risk:
high — this is the correctness core
Source: 00-report.md T1 / A1

## Problem

The verify slot *table* is generated and validated, but the two *runners*
above it — `scripts/verify.sh` (376 lines) and `.husky/pre-commit` (458
lines) — carry near-identical hand-written blocks that drift independently:
watchdog (`verify.sh:185-197` vs `pre-commit:319-335`), timeout-budget
reporting (`verify.sh:215-220` vs `pre-commit:367-372`), signal-wrapper meta +
traps (`verify.sh:221-233` vs `pre-commit:380-392`), and the failure-summary
loop including the same lint/format hint `case` statements
(`verify.sh:334-357` vs `pre-commit:410-436`). These are the #2 and #4 churn
files in the system. (Line numbers from the 2026-07-06 survey; re-verify.)

## Scope

- Extract the duplicated watchdog / lock / trap / marker / failure-summary
  machinery into one `scripts/lib/verify-engine.sh` (or grow
  `scripts/verify/steps-lib.sh`) parameterized by consumer (manual verify,
  pre-commit, land).
- **Mechanical extraction, not a redesign** — locks, watchdog signals, and
  `verify-metadata.sh` markers are load-bearing (the land.sh provenance
  re-stamp and the pre-push freshness window both read them).

## Done criteria

- Each duplicated block exists once; both runners consume the shared engine.
- Behavior unchanged: same markers, same signals, same failure summaries.

## Verification

- `bash scripts/tests/test-verify.sh` and `bash scripts/tests/test-pre-push.sh`
  green; a real `bun run verify:changed` and a real pre-commit run observed
  working; `bun run harness:check` green.
