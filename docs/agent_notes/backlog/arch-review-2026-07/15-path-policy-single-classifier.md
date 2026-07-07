# 15. Path-policy as the single file-classification source

Status: Pending — reconcile scope with lint-deep-dive leaves 41/42 outcomes
before starting (integration is in main as of 2026-07-07, so target `main`)
Size: M-L · Severity: med · Risk: medium-high — ESLint flat-config glob
semantics are unforgiving
Source: 00-report.md T6 / B3

## Problem

File classification is answered independently by four systems:
`scripts/path-policy/path-policy.ts` (the canonical selector engine),
`eslint-config/shared-policy.js:13-108` globs,
`eslint-config/config-surfaces.js` + manifest, and
`scripts/doc-length-policy.sh:14-56` case-globs. A new config surface must be
registered in 3–4 places (e.g. `path-policy.ts:79-88`
`ESLINT_FULL_SCAN_TRIGGERS` re-lists what `config-surfaces.js` enumerates).

## Preconditions

The lint-deep-dive-2026-07 config-architecture track (leaves 41
config-surface manifest, 42 smoke-subject single-sourcing) landed on `main`
via `chore/lint-deep-dive-integration` (`854bd87d`, verified an ancestor of
`main` 2026-07-07). Re-read those leaves' outcomes and reconcile this leaf's
scope against what they already single-sourced before dispatching — the
report was written before that landing.

## Scope

- Make `shared-policy.js` globs, the config-surface manifest, and
  `doc-length-policy.sh` derive from (or generate into) path-policy
  selectors.
- Start with the config-surface list, which already has a manifest — lowest
  risk, proves the derivation shape.

## Verification

- `bun run test:scripts:changed` (path-policy selection changes);
  `bun run harness:check`; full eslint run diffed for identical file
  selection before/after.
