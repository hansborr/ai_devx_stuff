# 03 — Make metrics strategies, not switch statements

Status: Done — 2026-07-16: metric-strategy registry
(scripts/lint-ratchet/metric-strategies.ts) owns each metric's collection
reduction, item codec, and same-count semantic-minimum merge; item 2 (single
max-lines exceptions codec) landed as eslint-config/max-lines-exceptions-codec.js,
consumed by both the TS gate spec (scripts/max-lines-exceptions-core.ts) and the
plain-JS config loader (eslint-config/shared-policy.js), so the live ESLint
config and the --check gate validate entries against one schema. The only
carry-over — folding per-metric comparison and debt-log delta onto the strategy —
is genuinely part of leaf 01's grouped BaselineSpec (those return
ratchet-specific Delta/regression types) and is tracked there, not here.
NOTE: the earlier plan to route this through leaf 01's grouped algebra was
dropped for item 2 — the config-load-critical codec was unified directly and
independently, which is safer than coupling it to the larger migration.
Priority: P1 · Size: M (incremental on top of 01)
Source: lint architecture review 2026-07-16 (R3) — GPT P1, Gemini P2.

## Problem

The code itself admits a new metric requires edits across collection,
schema, merge, comparison, debt log, reporting, and portability (comment at
`scripts/lint-ratchet/lint-ratchet-config.ts:271` — verified at HEAD
2026-07-16), and the collector hardcodes the `local/max-lines` and
`complexity` rule names (`current-collector.ts:129-130,151-153`). Adding a
metric is a cross-cutting edit, not a registration.

## Do

1. Register each metric once as a strategy owning its message reduction,
   item codec, comparison, merge/meet, and debt-log delta. This is the same
   interface as leaf 01's `BaselineSpec` — design them together.
2. Fold in GPT's max-lines finding: the committed exceptions baseline has
   two readers with different invariants — the TS spec vs a hand-written
   reader in `eslint-config/shared-policy.js` — so the gate and the live
   ESLint config don't consume the same schema. One codec, consumed by both.
