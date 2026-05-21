---
leaf: lint-hardening/19 (slice 5)
status: landed
landed: 2026-05-19
branch: feature/lint-hardening-leaf-19-drift-ai-small-modules
parent_branch: feature/lint-hardening-review-followup
---

# Leaf 19 Slice 5: drift-ai small-module subset ESLint adoption

## Summary

Extended ESLint coverage to three `scripts/drift-ai/**` files — the
modules and tests under the 300-line `local/max-lines` ceiling that
probed clean once the directory was unignored.

Adopted files (with line counts):

- `scripts/drift-ai/errors.ts` (6)
- `scripts/drift-ai/scope.ts` (62)
- `scripts/drift-ai/scope.test.ts` (44)

No code changes — only narrow `eslint.config.js` additions:

1. `!scripts/drift-ai/` directory unignore (so the full-repo lint
   walk descends into the directory at all).
2. File-level `!` exemptions for the three adopted files.
3. Per-file entries in the scripts parser-options block.
4. Per-file entries in the `local/type-assertion-boundary` block.

## Codex review correction (slice 5 fix-up)

The first probe of this slice initially included four more files —
`current-inventory.ts`, `current-inventory.test.ts`, `comments.ts`,
and `harness-freshness.test.ts` — and ran clean. Codex review
(P2 on commit `526a5c32`) caught that the probe was misleading:
without an `!scripts/drift-ai/` directory unignore, the full-repo
walk pruned the directory entirely; the file-level negations only
worked when files were passed explicitly (as `bun run lint -- file…`
or `lint:changed` does). Adding the directory unignore exposed the
real findings:

- `comments.ts`: complexity 21 (vs 10 ceiling) on `classifyLine`,
  plus 4 `restrict-template-expressions` errors,
  `regexp/no-unused-capturing-group`, and an autofixable
  `simple-import-sort` reorder — too many structural blockers.
- `current-inventory.ts` and `current-inventory.test.ts`:
  autofixable `simple-import-sort/imports`.
- `harness-freshness.test.ts`: missing
  `@typescript-eslint/explicit-function-return-type` annotation.

All four files were carved out for the same reason the slice 2
deferral pattern uses: the autonomous slice doesn't apply autofixes,
add type annotations, or split functions on its own judgment. They
stay parked in the `19-scripts-eslint-remaining-families.md` queue.

## Why a subset, not the whole `drift-ai/**/*.ts` glob

A glob adoption mirroring `scripts/drift/**/*.ts` is not yet tractable.
Nine `drift-ai/` files exceed the 300-line `local/max-lines` ceiling:

| file | lines |
| --- | --- |
| `suppressions.test.ts` | 332 |
| `harness-freshness.ts` | 365 |
| `comments.test.ts` | 387 |
| `suppressions.ts` | 466 |
| `config.ts` | 515 |
| `duplicates.ts` | 515 |
| `ghost-files.ts` | 687 |
| `ghost-files.test.ts` | 694 |
| `duplicates.test.ts` | 696 |

These would each need either a structural split or a targeted
warn-only override — the same architectural debt decision that
deferred slice 2 (`generate-harness-controls.ts`). Combined with the
four under-ceiling files that have other lint findings (see codex
review correction above), the whole-glob adoption stays parked for a
future leaf with explicit budget.

This slice instead enumerates the three currently-clean files
explicitly. Once the larger files come under the ceiling and the
finding-bearing files are repaired, the explicit list can be
replaced with the `scripts/drift-ai/**/*.ts` glob.

## Verification

- `bun run lint -- --max-warnings=0` (exit 0)
- `bun run typecheck` (exit 0)
- `bun run test:scripts:changed` (exit 0; all 5 smokes pass)

## Cross-refs

- Backlog leaf: `backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- Verdict register: `backlog/lint-hardening/evaluation-verdicts.md`
- Sibling adoptions:
  - `lint-hardening-leaf-19-scripts-lint-rule-docs-adoption.md`
  - `lint-hardening-leaf-19-scripts-lint-ratchet-config-adoption.md`
  - `lint-hardening-leaf-19-scripts-code-intel-server-and-logs-audit-test-adoption.md`
  - `lint-hardening-leaf-19-scripts-generate-harness-controls-deferral.md`
