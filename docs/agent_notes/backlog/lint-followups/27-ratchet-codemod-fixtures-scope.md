# Leaf 27: Lint-Ratchet Codemod-Fixtures Scope Mismatch

Status: Resolved (commit `49d3149b`, on `feature/lint-hardening-review-followup`)
Discovered: 2026-05-19 during Leaf 07 drain (feature/lint-hardening-review-followup)
Sources:

- `scripts/lint-ratchet-config.ts` (ratchet `files` glob: `scripts/**/*.ts`, `ignores`: `dist/`, `node_modules/`)
- `eslint.config.js` lines 103-130 (global ignore: `scripts/**/*` with three explicit `!` un-ignores)
- `docs/agent_notes/backlog/lint-followups/11-codemod-eslint-coverage.md`

## Problem

The `local/type-assertion-boundary` lint ratchet's synthetic ESLint
config inherits its own `files` / `ignores` from
`scripts/lint-ratchet-config.ts`, not from the main `eslint.config.js`.
This means the ratchet inspects files the main ESLint run deliberately
skips.

Concretely: regular `bun run lint` ignores everything under
`scripts/**/*` except `scripts/code-intel/**`, `scripts/drift/**`, and
`scripts/generate-lint-guidance.ts` — see `eslint.config.js:121-126`.
The ratchet config has only `["**/dist/**","**/node_modules/**"]` as
ignores, so it picks up roughly 48 findings from `scripts/**` files.
Of those, **36 come from codemod test fixtures** under
`scripts/codemods/fixtures/**`:

```
 4 scripts/codemods/fixtures/concurrency-guard/clean-helper-shapes/{before,after}/.../character-class-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/direct-write-and-raw-import/{before,after}/.../encounter.ts
 2 scripts/codemods/fixtures/concurrency-guard/ignored-helper-unexpected-mutator/{before,after}/.../character-class-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/pattern-a-regression/{before,after}/.../character-stats-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/pattern-b-regression/{before,after}/.../spell-slot-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/pattern-c-missing-count-handling/{before,after}/.../encounter-state-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/pattern-c-regression/{before,after}/.../encounter-state-mutations.ts
 2 scripts/codemods/fixtures/concurrency-guard/unclassified-helper-mutator/{before,after}/.../character-stats-mutations.ts
```

These fixtures are inputs to codemod regression tests, not production
code:

- `before/` snapshots are intentionally broken (the codemod's job is
  to transform them).
- `after/` snapshots are frozen at codemod-authoring time and will
  drift from the live `packages/server/src/utils/...` files they were
  copied from.

The fixtures appear in the ratchet baseline only as an artifact of the
scope mismatch — not because the codemod team chose to gate them.

## Considered fixes

1. **Harmonize ratchet ignores with `eslint.config.js`**: add
   `scripts/codemods/**` (or a tighter `scripts/codemods/fixtures/**`)
   to `scripts/lint-ratchet-config.ts` `ignores`. Drops the baseline by
   36 findings without changing any production code.

2. **Update the fixture snapshots** to match the current state of the
   files they shadow (each `after/` snapshot would gain the same
   sanctioned-escape boundary comments the live files now have).
   Mechanical but high-churn and the snapshots would drift again the
   next time the live files change.

3. **Apply Leaf 11**: take a position on full codemod ESLint coverage
   first, then decide what the ratchet should track.

## Decision

Deferred during the original drain because:

- The fix interacts with Leaf 11 (`11-codemod-eslint-coverage.md`),
  which is parked pending a coherent codemod coverage policy.
- The 36-finding gap is bookkeeping noise that doesn't reflect a real
  production hazard, so it isn't blocking the drain.
- A scope-narrowing change to the ratchet should probably ship as one
  intentional commit rather than mixed into the boundary-labelling
  work.

## Resolution

Implemented in commit `49d3149b` ("chore(lint): exempt codemod
fixtures from boundary ratchet") earlier on
`feature/lint-hardening-review-followup`. The
`ratchet/local-type-assertion-boundary` entry in
`scripts/lint-ratchet-config.ts` now lists
`scripts/codemods/fixtures/**` in its `ignores` array, matching the
main `eslint.config.js` policy that already excludes `scripts/**/*`
except for `scripts/code-intel/**`, `scripts/drift/**`, and
`scripts/generate-lint-guidance.ts`. The 36 phantom findings and 16
baseline entries dropped out as part of the same commit; net ratchet
movement was 196 → 160.

Leaf 11 itself remains parked — the wider codemod coverage decision
hasn't moved — but the narrow fixtures-scope alignment is now done and
no longer blocked by Leaf 11.
