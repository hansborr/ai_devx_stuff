# 03d1: Split lint-ratchet-metrics And Drain Its Baseline Finding

Status: Done (2026-06-12, landed in "refactor(lint): split ratchet metrics
helpers")

Completion notes (2026-06-12):

- Split `lint-ratchet-metrics.ts` into focused sibling modules for shared
  metric types/errors, complexity parsing/delta logic, formatting, baseline
  item parsing, and metric validation; the original file remains the public
  export surface for existing imports.
- Removed the `regexp/no-unused-capturing-group` suppression for
  `lint-ratchet-metrics.ts` and changed the complexity message regex's unused
  max group to non-capturing.
- Refreshed `lint-ratchet.baseline.json`; `ratchet/local-max-lines-runtime`
  remains in place with zero findings for 03d2/03g, and
  `lint:ratchet:summary` now reports zero findings across all ratchets.
- Updated the lint-ratchet portable runtime fixture/docs to include the split
  helper modules.
Order: 03d1
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md` — read its
unbacked-suppressions warning and cross-family ratchet rule first. Split out
of the former 03d on 2026-06-11 so the file split and the family adoption
are separate single-run leaves.

## Context

`scripts/lint-ratchet/lint-ratchet-metrics.ts` carries one of the two
remaining baseline findings (03c drains the other): `local/max-lines` at 357
effective lines under `ratchet/local-max-lines-runtime`. Line counts here
are the ratchet's `effective-line-count` metric — blank and comment lines
are skipped, so `wc -l` reads higher; do not mistake that gap for a stale
reference. Like 03c, this is a real refactor (file split), not config
surgery.

Suppression surface for this file (`eslint-config/script-configs.js`):
`lint-ratchet-metrics.ts` in the `regexp/no-unused-capturing-group` block —
unbacked (see parent warning).

Coupling: 13b adds a parser shape test against this file's
complexity-message regex; if the split moves the parser, 13b locates it by
searching, but note the new module in this leaf when done.

## Scope

1. Split the file into focused modules under the normal `local/max-lines`
   cap (follow `docs/agent_notes/eslint-max-lines-policy.md`; no behavior
   change — the lint-ratchet tests must pass unmodified except for import
   paths).
2. Keep the new modules inside lint coverage: `lintedScriptFiles` re-includes
   `scripts/lint-ratchet/lint-ratchet*.ts`, so either name the split modules
   to match or extend the entry (03d2 widens it to the whole directory
   anyway). `tsconfig.scripts.json` already covers the directory.
3. Remove this file's `regexp/no-unused-capturing-group` suppression entry;
   fix surfaced findings.
4. `bun run lint:ratchet:update` — the committed baseline loses this
   finding (zero findings total once 03c has also landed). Do NOT delete
   `ratchet/local-max-lines-runtime`: it still covers files outside normal
   lint and is finished by 03d2 and 03g.

## Definition Of Done

The metrics finding is out of the committed baseline; the metrics modules
are under the normal max-lines cap with no suppression entries;
`ratchet/local-max-lines-runtime` remains as a zero floor pending 03d2/03g.

## Verification

Umbrella gate set, plus `bash scripts/tests/test-lint-ratchet.sh` and the
lint-ratchet vitest targets — this batch edits the ratchet system's own
sources, so its self-tests are the real gate.
