# Phase-1 hotspot addendum — lane 02 (analyzers)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- `scripts/drift-ai/` + `scripts/drift-triage/` is the **clearest
  multi-signal hotspot in the whole repo** — rank 1 on structural evidence.
  `scripts/drift-ai` accounts for 334 location appearances in the triage
  review queue and is touched by 293 repeated-literal groups.
- Dolos: of the top 40 script-root clone pairs, 64 of 80 endpoints are in
  `scripts/drift-ai`; all 40 pairs are non-test and 12 have fragments of
  ≥ 20 lines. Repeated families named by lane 00: **argument parsers, check
  configurations, advisory runners, Knip adapters, and hotspot/coldspot
  formatters** — start your duplication analysis from those five families.
- Git churn is *less* exceptional here (37 file touches in the pinned
  range), so history understates the structural concentration; do not let
  low churn talk you out of structural findings.
- Test size is a maintenance-surface signal for your pointers (tests are
  lane 06's): `scripts/drift-ai.test.ts` is 2,765 lines, triage tests
  1,144, several drift-ai suites > 800.

Weighting: go deepest on the five repeated families above and on module
layout of `scripts/drift-ai/` (the prior audit never read its module
bodies). `scripts/logs-audit/` and `scripts/code-intel*` had no standout
lane-00 signal — sweep at normal weight and record coverage honestly.
