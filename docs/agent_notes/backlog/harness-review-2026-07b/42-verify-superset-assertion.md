# 42. Nothing asserts verify's slot set is a superset of pre_commit's — the marker bridge relies on it

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: verify-pipeline · Area: verify-gates · Severity: med · Size: S · Confidence: high
Theme: implicit-invariants · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED)

## Problem
Pre-commit's marker bridge accepts a fresh matching `verify`/
`verify:changed` success marker in place of running its own slots. That
is sound only while the `verify` consumers' slot sets cover everything
`pre_commit`'s does. Today the four consumers happen to share identical
slot membership, but the relationship holds by convention: a manifest
edit dropping a slot from `verify` while keeping it in `pre_commit`
would silently under-verify every bridged commit.

## Evidence
- Bridge: `.husky/pre-commit:295-316`,
  `scripts/lib/verify-metadata.sh:499-538` (Codex: CONFIRMED at `:533`).
- Slot sets: `scripts/verify/steps.generated.sh:12-15`; source of truth
  `harness.controls.json` verify-wrapper controls.

## Proposed direction
Add the superset assertion where the slot sets are already parsed and
validated: `scripts/harness/generate-verify-steps.ts` (fail generation)
and/or `harness-check.ts` (fail the check). Generation-time is better —
the invariant can never reach a generated file. Add a
`generate-verify-steps.test.ts` case with a violating manifest fixture.

## Scope / caveats
Pure meta-level guard; zero runtime cost. Also assert
`verify_changed ⊇ pre_commit` since the bridge accepts changed-mode
markers too — confirm which modes `musi_try_verify_marker_bridge`
actually accepts before writing the assertion. One commit.
