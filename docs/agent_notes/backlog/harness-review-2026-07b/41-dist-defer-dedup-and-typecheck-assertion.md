# 41. Dist-defer dispatch logic is duplicated in pre-commit and verify.sh, with a silent no-typecheck fallback

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: verify-pipeline · Area: verify-exec · Severity: med · Size: M · Confidence: high
Theme: single-source-of-truth · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
The "defer lint/ratchet behind typecheck when required dist/ outputs are
missing" parallel-dispatch logic exists twice, near-verbatim: in
`.husky/pre-commit` and in `scripts/verify.sh`'s `run_steps_parallel`.
Fixes must be applied in both places with nothing enforcing sync. Within
that logic, `DIST_READY` defaults to ready and is only cleared when a
typecheck slot exists and fails — if a future manifest edit removed
typecheck from a consumer's slot list, lint/ratchet would silently run
undeferred instead of failing loudly.

## Evidence
- `.husky/pre-commit:370-489` and `scripts/verify.sh:290-401` — duplicated
  blocks (Codex: CONFIRMED at `:370`/`:290`).
- `DIST_READY` default-ready fallback: `.husky/pre-commit:452-464`,
  `scripts/verify.sh:341-354`.

## Proposed direction
Extract the dispatch block into a shared function in
`scripts/verify/steps-lib.sh` (or `scripts/lib/parallel-step.sh`, which
both callers already source), parameterized by consumer. Add an explicit
assertion that a `typecheck` slot exists whenever any slot declares a
dist dependency, failing loudly instead of silently not deferring. The
existing `scripts/tests/test-verify.sh` coverage should pin behavior
across the extraction.

## Scope / caveats
Refactor with tests, no intended behavior change. Verify both callers'
env/output plumbing really is identical before extracting — small
divergences may be load-bearing. One commit, or two (extract, then
assert) if the diff gets large.
