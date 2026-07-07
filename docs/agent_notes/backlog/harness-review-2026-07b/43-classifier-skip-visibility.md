# 43. Pre-commit's classifier-uncertainty scripts-slot skip is silent, unlike the fast-commit skip

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: verify-pipeline · Area: verify-exec · Severity: low · Size: S · Confidence: high
Theme: state-visibility · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
When the staged-script classifier cannot decide (rc=2), the `pre_commit`
consumer skips the `scripts` slot entirely (`MUSI_VERIFY_SLOT_SKIP_RC`)
— intentionally, with CI's unconditional `test:scripts` as backstop. But
the skip is silent, while the fast-commit skip prints a notice. An agent
or human reading pre-commit output cannot tell a passed scripts slot from
a skipped one, and the stop-policy's cached-verify messages inherit the
same blind spot.

## Evidence
- `scripts/verify/steps-lib.sh:71-111` — classifier resolution; silent
  skip at `:97-101` (Codex: CONFIRMED at `:97`); fast-commit skip prints
  at `:141-144`.

## Proposed direction
Print a one-line `SKIP scripts (classifier uncertain — CI runs the full
suite)` in the same style as the fast-commit message. Consider recording
the skip in the per-step JSON meta so `ai_stop_verify_failing_gates` and
`verify-logs.sh` can surface it too.

## Scope / caveats
Output-only change; keep the skip semantics. One commit.
