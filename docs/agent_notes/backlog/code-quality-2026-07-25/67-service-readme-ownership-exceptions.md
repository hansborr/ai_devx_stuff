# 67. The service placement guide states ownership rules that its established exceptions contradict

Status: **Done 2026-07-30** on branch
`fix/cq-62-67-identity-and-docs`, commits `e02a4c676` and `3d46a513e`. The
service guide now classifies ownership by auth and request-level broadcasts
rather than call depth or a closed signature list, treats transaction ownership
independently, names the rest cores' post-commit broadcast exception, and
permits the established narrow transaction-local utility shape. The follow-up
also distinguishes inline `updatePersonality` from shape-2 `levelUp` and records
the existing flat `inventory-service.ts`. The correction was rechecked against
`persistImportedCollection`, `deleteCharacterWithCascade`, and
`performLevelUp`.
Theme: Service and utility ownership taxonomy · Area: server docs · Severity: low · Size: XS

Source: review of SERVER-COMMENTS S13 on
`feat/cq-server-comments-s12-s13` (2026-07-30) · Confidence: high — both
claims were checked against production code and focused tests

Evidence is pinned to `1a4dba03c`. Re-resolve line anchors before editing.

## Problem

Two categorical statements in `packages/server/src/services/README.md` are
false for established, documented exceptions:

1. The caller-owned service shape says the caller owns broadcast and the deeper
   function emits no Socket.io events (`:118-123`), then lists
   `executeShortRest` and `executeLongRest` as examples (`:132-135`). Both rest
   cores broadcast after their transaction commits.
2. The `utils/` taxonomy says concurrency primitives do not own a transaction
   boundary or sequence a multi-step protocol (`:67-71`). The same README later
   documents `utils/prepared-spell-toggle.ts` as a deliberate utility that owns
   one Serializable check-and-write transaction (`:205-210`).

The exceptions are reasonable; the categorical taxonomy is the drift. Leaving
both statements in place makes the guide unsafe to use as a placement or
side-effect checklist.

## Evidence

- `packages/server/src/services/rest-service.ts:311-315` broadcasts logged HP
  changes and rest chat after a short-rest commit.
- `packages/server/src/services/rest-service.ts:438-442` does the same after a
  successful long-rest attempt.
- `packages/server/src/services/rest-service.test.ts:493-520` and `:652-700`
  pin the chat broadcast boundary, including no broadcast from failed
  serialization attempts.
- `packages/server/src/utils/prepared-spell-toggle.ts:127-177` owns the
  `$transaction`, rereads the spell row, loads cap inputs, counts prepared
  spells, and writes the toggle under `Serializable`.
- `packages/server/src/utils/prepared-spell-toggle.test.ts:206-230` pins the
  concurrent last-slot invariant, while `:233-300` exercises the retry path.

## Proposed direction

1. Separate auth ownership from broadcast ownership in the caller-owned shape.
   State the common case without claiming it is universal, and name rest as the
   established post-commit broadcast exception.
2. Describe `utils/` by orchestration surface rather than by a blanket
   transaction prohibition. Preserve the existing prepared-spell ruling: one
   narrow check-and-write transaction with no service orchestration surface may
   remain a utility.
3. Keep this documentation-only. Do not move the rest broadcasters or
   `prepared-spell-toggle.ts` merely to make the old prose true.

## Scope / caveats

- This leaf was filed rather than folded into S13 because S13 explicitly
  confined its README edit to the service-convergence block.
- Re-check the cited code and tests before choosing wording. If the taxonomy
  cannot express both live exceptions briefly, weaken or delete the categorical
  claims instead of adding a longer exception catalogue.

## Verify

```
bun run test -- packages/server/src/services/rest-service.test.ts packages/server/src/utils/prepared-spell-toggle.test.ts
bun run lint
```
