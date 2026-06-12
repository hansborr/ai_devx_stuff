# 03c: Split lint-coverage-map-check And Drain Its Floors

Status: Done (2026-06-12, landed in "refactor(lint): split coverage map
checker")

Completion notes (2026-06-12):

- Split `lint-coverage-map-check.ts` into focused sibling modules for
  types, path/table parsing, I/O, and finding formatting; the public CLI/test
  entrypoint stayed at `scripts/lint-coverage-map-check.ts`.
- Widened normal lint and `tsconfig.scripts.json` coverage to
  `scripts/lint-coverage-map-check*.ts`; removed the checker's per-file
  `scriptDebtOverrideConfigs` block and confirmed normal ESLint is clean.
- Deleted the five drained ratchets
  (`core-complexity-top-level-scripts`,
  `core-no-magic-numbers-top-level-scripts`,
  `local-max-lines-lint-coverage-map-check`,
  `regexp-no-unused-capturing-group-lint-coverage-map-check`, and
  `typescript-eslint-require-await-script-singletons`), refreshed the
  baseline, and recorded the required orphan-removal debt-log entry.
- Ripple surfaces: removed the five ratchet controls from
  `harness.controls.json`, regenerated `docs/generated/harness-controls.md`,
  and updated the coverage-map row for the split helper family.
- `lint:ratchet:summary` now shows one remaining current finding, only under
  `ratchet/local-max-lines-runtime`.
Order: 03c
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

`scripts/lint-coverage-map-check.ts` carries one of the two remaining
baseline findings: `local/max-lines` at 352 effective lines (the ratchet's
`effective-line-count` metric skips blank and comment lines; `wc -l` reads
higher — that gap is not a stale reference) under
`ratchet/local-max-lines-lint-coverage-map-check`. This batch is a real
refactor (file split), not just config surgery.

Other floors over this file:

- `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check` (zero)
- the `lint-coverage-map-check.ts` suppression block
  (`complexity`, `no-magic-numbers`, `require-await`,
  `regexp/no-unused-capturing-group` all off) — the first two are backed by
  the cross-family top-level-scripts ratchets, the last two by the
  singleton ratchets;
- final entries of the cross-family ratchets 03a/03b narrowed:
  `ratchet/core-complexity-top-level-scripts`,
  `ratchet/core-no-magic-numbers-top-level-scripts`,
  `ratchet/typescript-eslint-require-await-script-singletons`.

Note: if the split renames or removes `lint-coverage-map-check.ts`, check
whether `docs:lint-coverage-map:check` and the coverage-map checker itself
still exist or moved — Leaf 11's old caveat ("if the coverage-map checker
still exists at promotion time") applies to this file's own future.

## Scope

1. Split the file into focused modules under the normal `local/max-lines`
   cap (follow `docs/agent_notes/eslint-max-lines-policy.md`; no behavior
   change — `lint-coverage-map-check.test.ts` must pass unmodified except
   for import paths).
2. Add the new modules to `lintedScriptFiles` (or widen the existing entry)
   and to `tsconfig.scripts.json` if a new directory appears.
3. Remove the suppression block; fix surfaced findings.
4. Delete `ratchet/local-max-lines-lint-coverage-map-check` and
   `ratchet/regexp-no-unused-capturing-group-lint-coverage-map-check`;
   delete the now-empty cross-family ratchets
   (`core-complexity-top-level-scripts`,
   `core-no-magic-numbers-top-level-scripts`,
   `require-await-script-singletons`) once this file was their last entry.
5. `bun run lint:ratchet:update` — the committed baseline should lose one of
   its two remaining findings.

## Definition Of Done

Baseline debt drops from 2 findings to 1; the file family is under normal
lint with no suppression block and no singleton ratchets; the three
cross-family top-level/script-singleton ratchets are fully retired.

## Verification

Umbrella gate set, plus
`bash scripts/vitest.sh run scripts/lint-coverage-map-check.test.ts` and a
diff of `lint:ratchet:summary` showing only the expected ratchet removals.
