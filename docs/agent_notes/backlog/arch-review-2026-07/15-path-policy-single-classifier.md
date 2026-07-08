# 15. Path-policy as the single file-classification source

Status: Done 2026-07-07 — implemented by `8cdc79f8`
(`fix(scripts): derive path policy configs`) and `ed4e9c87`
(`refactor(lint): share JS TS extensions`), with fixture follow-up
`0024525c` (`fix(scripts): copy lint policy fixtures`) and verification
expectation follow-up `8417fc15` (`fix(scripts): align verify config probe`).
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

## Reconciled outcome

The 2026-07-07 reconciliation against lint-deep-dive leaves 41/42 superseded
the original inversion direction. The config-surface manifest remains the
single source of truth, and path-policy is now its fourth consumer for
source-relevant config surface selectors. Path-policy does not generate the
manifest.

`doc-length-policy.sh` was descoped because it uses a different taxonomy:
advisory hot-doc length budgets, not a second config-surface source that can
drift against the manifest.

`ESLINT_FULL_SCAN_TRIGGERS` remains hand-curated. It represents semantic
full-scan triggers, not the config-surface inventory; the original claim that
it re-listed `config-surfaces.js` was stale after leaf 41 landed.

The implementation also single-sourced the JS/TS lintable extension set in
`eslint-config/shared-policy.js`, deriving flat-config brace globs and
path-policy changed-lint extensions from the same exported array. The full
ESLint selection diff was empty before/after that change.

Final changed-smoke verification found additional synthetic repos that copied
`path-policy.ts`; those fixtures now copy `config-surfaces.js`, the manifest,
and `shared-policy.js` instead of weakening the production imports.
The verify changed-gate smoke now probes `vitest.slow.config.ts` instead of an
unregistered root `prisma.config.ts`, matching the manifest-only source
relevance contract.

## Verification

- `bun run test:scripts:changed` (path-policy selection changes);
  `bun run harness:check`; full eslint run diffed for identical file
  selection before/after.
