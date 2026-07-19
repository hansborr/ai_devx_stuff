# 07 — Author the coverage map as data, render the Markdown

Status: Proposed — trigger: next time the checker needs a schema change
Priority: P1 · Size: M · Risk: low
Source: lint architecture review 2026-07-16 (R7) — GPT and Grok, both P1.

## Problem

The coverage checker parses a generated Markdown table to reconstruct glob
membership and cross-check ESLint reach — Markdown as a load-bearing
database. The human-authored facts and the derived presentation are tangled,
so the map stays hand-edited (a known friction: coverage-map edits are the
one remaining hand-maintained piece of the config-surface registration
flow).

## Do

Invert it: author only the human facts (path/glob, classification,
rationale) in JSON/YAML; derive the rest from the live ESLint config and the
ratchet registry; generate the Markdown table as presentation.

Not urgent on its own — schedule it as the shape of the *next* coverage-map
checker schema change rather than a standalone drive-by.

## Rider: spoke boundary review (added 2026-07-19)

When this leaf fires, run a boundary review over the
`lint-coverage-map-check*` family after the data-model rewrite settles
— not before, and not from a pre-selected deletion list. A drafted
"fold the three single-consumer spokes" plan was cross-reviewed
2026-07-19 (Fable 5 + GPT-5 codex; record in
`../arch-plans-2026-07/00-index.md`) and not adopted as written: a
mechanical fold of today's code breaches the 300-effective-line cap
(entry 169 + io 25 + eslint-reach 82 + row-consistency 67 ≈ 343), the
predicted shrink was mis-sourced (Markdown parsing lives in
`-patterns.ts`, which stays; `-io.ts` owns tracked-file discovery and
staged reads, which survive a format change), and much of
`-row-consistency.ts` validates authored columns this rewrite derives —
it should largely be **deleted as obsolete**, not folded. What the
review agreed on, for that future boundary pass:

- Default to keeping the `-io` and `-eslint-reach` seams (the latter
  owns a real ESLint instance and is cited by three guides:
  `docs/guides/lint-ratchet-adoption.md`, `biome-lint-adoption.md`,
  `lint-ratchet-reference.md`); fold or delete only what the rewrite
  makes redundant, measured after its shapes settle.
- Re-run the fan-in grep at trigger time; the 2026-07-19 snapshot
  (production fan-in of one for `-io`/`-row-consistency`/
  `-eslint-reach`, type-only `EslintReachChecker` edge from
  `-types.ts`) will have drifted.
- Reconcile with the flat-family topology decision in
  `../scripts-flat-family-reorg.md` (this ten-file family is one of
  its named subjects) instead of leaving a smaller nonconforming flat
  family; the prior split ruling (`d38e3c8a`, recorded in the family's
  row of `docs/generated/lint-coverage-map.md`) allows re-joining only
  without per-file suppressions or baseline waivers.
- Refresh the family's row in `docs/generated/lint-coverage-map.md`
  (filename enumeration and count) in whatever form leaf 07 gives it —
  the gate's union matcher will not catch that staleness itself.
