# 28. AssertTurnLockOpts duplicates the documented cross-module AssertTurnOpts turn-validation primitive

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-low · Size: XS
Source: drift:ai duplicate-types (drift-baseline; confirmed both declarations and the missing import edge) · Confidence: med

## Problem
The turn-lock input contract is declared twice with identical fields:

- `combat-actions/types.ts:63-68` exports `AssertTurnOpts` (readonly), headed `Cross-module turn-validation primitive`: `{ encounterId: string; actorSortOrder: number; expectedRound: number; isDm: boolean }`.
- `utils/encounter-state-mutations.ts:161-166` declares a private, mutable `AssertTurnLockOpts` with the **same 4 fields**, only differing by `readonly`.

These are not independent types that happen to coincide — they are the same DTO flowing through one call chain. `assert-turn.ts:15-19` (`assertTurnInsideTx(tx, opts: AssertTurnOpts)`) delegates straight to `assertTurnLock(tx, opts: AssertTurnLockOpts)`; it compiles only because the readonly shape is structurally assignable to the mutable param. Two hand-maintained copies of a **race-sensitive** input bag can drift independently (e.g. a future field added to one and not the other would silently widen/narrow the contract at the structural boundary instead of erroring).

The same duplication exists for the result type, on the same call path: `TurnLockResult` (`encounter-state-mutations.ts:156-159`, mutable) vs `TurnValidationResult` (`combat-actions/types.ts:70-73`, readonly) — both `{ round: number; currentTurnIndex: number }`. `assertTurnInsideTx` returns `Promise<TurnValidationResult>` wrapping `assertTurnLock`'s `Promise<TurnLockResult>`. Worth consolidating in the same pass.

This clears the bar as a small dedup: collapse 2 structural twins (4 type decls total) to 1 each, with the import edge making future drift a compile error rather than a silent structural coercion.

## Evidence
- `packages/server/src/services/combat-actions/types.ts:63-68` — exported readonly `AssertTurnOpts`, headed "Cross-module turn-validation primitive" (confirmed, lines current).
- `packages/server/src/utils/encounter-state-mutations.ts:161-166` — private mutable `AssertTurnLockOpts`, identical 4 fields (confirmed, lines current).
- `packages/server/src/services/combat-actions/assert-turn.ts:1,3,15-19` — imports `assertTurnLock` from `../../utils/encounter-state-mutations.js` and `AssertTurnOpts`/`TurnValidationResult` from `./types.js`; `assertTurnInsideTx` delegates directly, passing `AssertTurnOpts` into the `AssertTurnLockOpts` param.
- `packages/server/src/services/combat-actions/types.ts:70-73` vs `encounter-state-mutations.ts:156-159` — `TurnValidationResult` / `TurnLockResult`, same `{round, currentTurnIndex}` readonly-vs-mutable twin on the same call path.
- Layering: combat-actions imports from `utils/encounter-state-mutations` (per `assert-turn.ts:1`), not the reverse — the util is the lower layer.

## Proposed fix
1. Read `docs/CONCURRENCY.md` first (turn-lock helpers are a documented race-sensitive surface) and keep this change **type-only** — no behavioral edit to `assertTurnLock`.
2. Pick the canonical home. The util is the lower layer that combat-actions already depends on, so to avoid a layering inversion the input/result types should live at or below `utils/encounter-state-mutations.ts`. Either (a) export `AssertTurnLockOpts`/`TurnLockResult` from `encounter-state-mutations.ts` and have `combat-actions/types.ts` re-export them under the documented names `AssertTurnOpts`/`TurnValidationResult` (e.g. `export type { AssertTurnLockOpts as AssertTurnOpts } from ...`), or (b) move both DTOs to a small shared server types module imported by both. Prefer (a) for minimal churn.
3. Adopt the readonly form as canonical (matches the documented primitive and the cross-module re-export). Make `encounter-state-mutations.ts`'s declarations `readonly`; this is safe because the helper only destructures `opts`.
4. Delete the now-redundant local `AssertTurnLockOpts`/`TurnLockResult` declarations once they are unified.
5. Keep the public names stable: `MODULE.md:33` documents `assertTurnInsideTx(..., opts: AssertTurnOpts): Promise<TurnValidationResult>`. If you re-home under different exported names, update `combat-actions/MODULE.md` accordingly.
6. TDD/verification: no new behavior, so no new runtime test is strictly required, but the existing suites must stay green — `packages/server/src/utils/encounter-state-mutations.test.ts` and `packages/server/src/routers/encounter-combat-concurrency.test.ts` exercise this path. Run `bun run verify:changed` (lint:changed, typecheck, test:changed) after staging. The typecheck is the real gate here: with the import edge in place, any field drift becomes a compile error.

## Verification / caveats
- False-positive risk: low. Both declarations and the delegation edge re-confirmed at the cited lines; the structural-assignability path is why it compiles silently today.
- Scope boundary: type-only consolidation. Do NOT alter `assertTurnLock`'s `updateMany`/compound-WHERE logic or the `TRPCError("CONFLICT")` path — those are the actual concurrency guarantees and out of scope.
- Layering check: confirm the chosen canonical module does not introduce a `utils -> services/combat-actions` import (that would be the inversion the audit warns against). Option (a)/(b) above both avoid it.
- A config suppression is not appropriate here — this is real source dedup, not a lint false-positive.
- Optional: if the implementer judges the two `{round, currentTurnIndex}` result types too trivial to unify, the input-bag consolidation alone still clears the bar; the result-type merge is a low-cost add-on, not a blocker.
