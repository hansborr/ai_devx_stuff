# 09 — Docs: shrink the required path, strip internal references

Status: Done — 2026-07-17 split lint-ratchet.md (1,139→448 lines) into an
operator guide + new lint-ratchet-reference.md; stripped internal review-cycle
citations from the portable surface; and added a keyed generator that projects
the four baseline conflict-recovery recipes into the merge runbook from the
driver's own print_conflict_recovery cases (parity guard now the generator's
--check). The split decision itself was design-recorded in lint-deep-dive 70
item 3.
Priority: P2 · Size: M · Risk: low
Source: lint architecture review 2026-07-16 (R9) — Sonnet and Grok P1, Opus
P2; synthesis P2 because docs depth is partly the product for a public
reference.

## Problem

`docs/guides/lint-ratchet.md` is 1,145 lines. Beyond size:

1. Files marked portable carry internal review-cycle citations ("see Leaf 22
   Review Cycle F3") that mean nothing to the outside audience.
2. Three differently-worded merge-conflict recovery recipes exist where one
   generator keyed by baseline would do — a 1,145-line manual is partly a
   signal that merge recovery is under-automated; prefer encoding
   constraints in the tool over prose.

## Do

1. Execute the split already designed in
   `lint-deep-dive-2026-07/70-ratchet-docs-accuracy-and-shape.md` item 3:
   keep quickstart + commands + lifecycle as the guide; move baseline
   identity and rule-source/parser internals to a reference doc. Do not
   re-litigate the split shape here — that leaf owns the decision.
2. Sweep portable-marked files for internal review-cycle citations and
   remove or generalize them.
3. Unify the three merge-conflict recovery recipes into one generator keyed
   by baseline (natural companion to leaf
   [04](./04-single-merge-driver-shell-body.md)'s driver descriptor — the
   recovery text lives there).
