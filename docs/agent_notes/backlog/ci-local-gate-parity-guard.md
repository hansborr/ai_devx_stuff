# CI Local Gate Parity Guard

Status: Parked
Date: 2026-07-03
Source: Deferred repo-audit finding from the docs/process staleness cleanup.

## Context

This branch fixes the missing individual CI/local gate wirings found during the
audit, but that is still a point-in-time repair. The systemic gap is that
local verification and CI can drift without a mechanical assertion catching the
shape change.

`harness.controls.json` already owns generated verify and hook surfaces. CI
should either be checked against that manifest or generated from it so parity
is structural, not remembered by review.

## Scope

- Extend `bun run harness:check` with a CI-parity assertion, or generate the CI
  gate step list from `harness.controls.json`.
- Make the assertion compare the meaningful gate identities and scripts, not
  whitespace or workflow formatting.
- Add fixtures that prove an omitted, extra, or renamed CI/local gate fails the
  check with an actionable diagnostic.
- Folded in from arch-review-2026-07 T2/A2 (2026-07-07): derive the pre-commit
  generator-freshness surface — the hand-maintained 12-path `generated_pattern`
  regex and the hard-coded `:check` list in `.husky/pre-commit:185-192` — from
  `harness.controls.json`, which already models generators as controls. Same
  pattern as the CI parity above: generate or mechanically check, don't
  remember by review. (The other registry copies in `harness-check.ts` —
  freshness list, EXEMPT_SCRIPTS — should derive from the manifest in the same
  slice.)

## Verification

- Focused harness/generator test for CI parity.
- `bun run harness:check`
