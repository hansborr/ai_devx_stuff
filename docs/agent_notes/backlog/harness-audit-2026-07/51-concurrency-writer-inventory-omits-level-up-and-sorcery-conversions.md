# 51 — Concurrency writer inventory omits level-up and sorcery conversions

Status: Done
Track: DOC (docs) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The four-writer inventory and update contract were verified. `applyLevelUp` and both sorcery conversions follow the canonical order today but are missing from the analysis; one existing sorcery citation is also classified as single-table.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/CONCURRENCY.md:167-197` — the documented cross-table inventory contains four writers.
- `docs/CONCURRENCY.md:225-230` — new multi-table writers are required to update the inventory.
- `packages/server/src/services/level-up/apply-level-up.ts:32`, `packages/server/src/services/level-up/apply-level-up.ts:43`, and `packages/server/src/services/level-up/apply-level-up.ts:80` — level-up writes stats, class, and character spell slots.
- `packages/server/src/services/character-live-state/sorcery-point.ts:46-67` and `packages/server/src/services/character-live-state/sorcery-point.ts:82-108` — both conversion directions write stats and spell slots.
- `docs/CONCURRENCY.md:113` — `convertSlotToPoints` is currently cited as a single-table path.

Failure: Reviewers relying on the writer inventory can omit three live transactions from pairwise deadlock analysis, making a future order reversal easier to miss.

## Do

Add `applyLevelUp` and both sorcery conversions with row identities and relative lock order. Correct the single-table classification and update the pairwise analysis; this is documentation completeness, not a claim of a current deadlock.

## Verify

```
rg -n "applyLevelUp|applyLeveledCast|convertSlotToPoints|createSlotFromPoints" docs/CONCURRENCY.md
```

## Acceptance

- Every verified multi-table writer appears in the inventory with lock order.
- The update contract and pairwise analysis cover level-up and both conversion directions.
