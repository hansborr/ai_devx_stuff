# 14. `--propose` bypasses registry validation — previews can differ from what the registry would accept

Status: Proposed — from the 2026-07-04 lint deep-dive; NOT implemented. Re-verify file:line before acting.
Lens: ratchet · Area: propose mode · Severity: low-med · Size: S · Confidence: high
Theme: preview-parity · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`--propose` is routed through `runUnvalidatedMode` alongside the pure report
modes, so a proposed ratchet skips the path/scope/metric/empty-glob validation
that committed registry entries get. The advertised workflow is "mirror the
real registry entry before promoting it" — but a proposal can look clean (e.g.
a zero-file glob quietly matching nothing, or an option shape the registry
validators would reject) and then fail only after the user copies it into
`lint-ratchet-config.ts`. Preview/commit parity is the whole point of the mode.

## Evidence
- `scripts/lint-ratchet/modes.ts:226-255` — `runUnvalidatedMode` comment ("skip the registry preflight/validate gate entirely") and the `propose` branch inside it. Verified 2026-07-04.
- `scripts/lint-ratchet/propose.ts:123-143,188-194` — ad-hoc single-entry build with its own partial checks only.
- `scripts/lint-ratchet/registry-validation.ts:305-322` — the validators committed entries get.
- `docs/guides/lint-ratchet.md:459-471` — documents propose as the dry run to "mirror the real registry entry".

## Proposed direction
Build the synthetic ratchet config, then run the applicable registry validators
(shape, glob syntax, empty-glob against tracked files, absolute-path) before
collection, reporting failures with the same `<kind>: <message>` vocabulary as
`check-registry`. Keep propose-only conveniences (synthetic id, no
harness-manifest requirement) as explicit exemptions rather than skipping the
gate wholesale.

## Scope / caveats
- Empty-glob should arguably stay a *warning* in propose mode (probing an
  empty scope is a legitimate exploratory question) — but say so in output
  instead of silently printing a zero-file preview.
- 2026-07-04 review: trim candidate — the failure this prevents is
  self-correcting one step later (the copied entry fails registry validation
  immediately), so the blast radius is one round-trip. Keep only while it
  stays S-size.
- One commit: validation call + exemption list + tests for a bad-glob and a
  bad-options proposal.
