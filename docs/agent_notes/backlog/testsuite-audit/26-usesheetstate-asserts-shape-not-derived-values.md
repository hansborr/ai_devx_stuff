# 26. useSheetState test asserts only the shape of returned keys, not any derived value

Status: Done — implemented 2026-06-14 (batch 5a)
Lens: defect-catching · Area: client · Severity: low · Size: S · Confidence: med
Theme: hook-shape-only-smoke · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
`useSheetState` is the character sheet's central aggregating hook: it fans out to a dozen sub-hooks (`useCharacterStats`, `useInventory`, `useSpellSlots`, `useSorceryPoints`, …) and folds their results, plus several synchronous derivations, into one wide object the sheet consumes (`sheet-state.ts:58-126`). Six of those returned fields are computed values — `passivePerc`, `calculatedAc`, `primaryClassId`, `maxMasterySlots`, `sorcererLevel`, `sorceryPoints` — and the order they are wired into the literal (`sheet-state.ts:101-125`) is exactly the kind of place a copy-paste swap hides (e.g. `passivePerc: computeSheetAc(...)` under the `passivePerc` key, or `primaryClassId` and `sorcererLevel` transposed).

The single `useSheetState` test guards none of that. It renders the hook against the real `TEST_CHARACTER_DETAIL` fixture, then asserts `Object.keys(result.current).sort()` against a hand-maintained 23-key literal and adds three `typeof === "function"` checks (`sheet-state.test.ts:163-197`). That verifies the object's *shape* — which keys exist and that three of them are callable — but never reads a single derived *value*. A wiring bug that returns the wrong computed number under the right key (swapped `passivePerc`/`calculatedAc`, a `primaryClassId` pointing at the wrong class slot, a non-sorcerer reporting a non-zero `sorcererLevel`) sails through green. The test's only failure mode today is "a key was added or removed," at which point a maintainer mechanically re-syncs the 23-entry literal — brittle churn that trains the reader to treat the assertion as bookkeeping rather than a behavioral guard.

The fixture is already in hand at `sheet-state.test.ts:165` (`renderHook(() => useSheetState(TEST_CHARACTER_DETAIL), { wrapper })`) — a deterministic level-3 fighter with WIS 12 and Perception proficiency — so the inputs needed to pin the synchronous derivations are sitting right there, unread.

## Evidence
- `packages/client/src/pages/character-sheet/sheet-state.test.ts:163-197` — the entire `useSheetState` `it()` asserts `Object.keys(result.current).sort()` against a 23-key literal plus three `typeof === "function"` checks (`levelUp`, `rest.shortRest`, `weaponMasteryHook.setMasteries`); no derived value is read.
- `packages/client/src/pages/character-sheet/sheet-state.test.ts:165` — `renderHook(() => useSheetState(TEST_CHARACTER_DETAIL), { wrapper })` already supplies the real fixture, but its derived outputs are never asserted.
- `packages/client/src/pages/character-sheet/sheet-state.ts:101-125` — the returned object wires `passivePerc`/`calculatedAc`/`primaryClassId`/`maxMasterySlots`/`sorcererLevel`/`sorceryPoints` (lines 119-124), any of which could be mis-wired under the wrong key without changing the key set the test checks.
- `packages/client/src/pages/sheet-helpers.ts:24-33,210-213` — `computeSheetPassivePerception` and `getSorcererLevel` are pure synchronous derivations over the character; combined with the fixture (`fixtures-character.ts:13-83`: `class-fighter`, WIS 12, level 3, Perception proficient at :77-83) they yield deterministic outputs (`passivePerc = 10 + 1 + 2 = 13`, `sorcererLevel = 0`, `primaryClassId = "class-fighter"`).

## Proposed direction
Keep the existing shape guard verbatim (it still catches accidental key add/remove) and *add* value assertions for the deterministic synchronous derivations against `TEST_CHARACTER_DETAIL`, in the same `it()` or a sibling one rendered with the same wrapper:

- `expect(result.current.primaryClassId).toBe("class-fighter")` — guards `character.classes[0]?.classId` wiring (`sheet-state.ts:87,121`).
- `expect(result.current.sorcererLevel).toBe(0)` — guards the `getSorcererLevel` derivation for a non-sorcerer (`sheet-state.ts:95,123`).
- `expect(result.current.passivePerc).toBe(13)` — guards `computeSheetPassivePerception` (`sheet-state.ts:119`); 13 = base 10 + WIS mod +1 (score 12) + proficiency bonus +2 (level 3, Perception proficient), all read off the fixture.

Coverage strictly increases: the same single test now fails on a mis-wired aggregation, not only on a key-set drift, and the change is purely additive (no assertion is removed or weakened). It is a one-hook, one-file edit with no source change.

## Scope / caveats
Touch only `packages/client/src/pages/character-sheet/sheet-state.test.ts`; no source change. Re-verify the three pinned values against the fixture before landing — they are derived from `fixtures-character.ts` as it stands at HEAD (level 3, WIS 12, Perception proficient, fighter-only), so if that fixture is edited the expectations must move with it.

Deliberately do **not** assert `calculatedAc` as a precise number in this synchronous `renderHook`: `computeSheetAc` depends on async tRPC query data (`useInventory(...).items` and `useSrdLookups().classNames`, `sheet-state.ts:120`) that is empty/loading without a `waitFor`, so pinning it either flakes or freezes an empty-inventory intermediate value. Leave AC to its own awaited test or out of scope here. Likewise `maxMasterySlots` and `sorceryPoints` are fine to leave as-is unless a follow-up wants them — the three synchronous derivations above are the high-value, deterministic wins.

This is a defect-catching strengthening, not a relocation or dedup finding. It is independent of the colocated rules-test conventions tracked elsewhere; it pairs thematically with other `hook-shape-only-smoke` findings (shape-asserting hook tests that read no value) but requires no shared change — each can land on its own. `_mergedFrom` carried only the identical restatement of this same finding, so nothing additional is folded in.
