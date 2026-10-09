# 50. Seven of eight optimistic character-sheet rollback branches — and every settled invalidation binding — have no consumer-level test

Status: Landed on fix/cq-050
Theme: optimistic rollback test coverage · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The character-sheet hooks in `packages/client/src/hooks/character-sheet/` wire
thirteen mutations with `onSettled` invalidation; eight of them are optimistic
(`onMutate` snapshot + `onError` restore). The `restoreSnapshot`/`snapshotAndSet`
helpers are tested in isolation (`cache-helpers.test.ts`), but the mutation-option
bindings — which snapshot each mutation restores on failure, and which query keys
it invalidates after settling — are almost entirely untested at the consumer
level. Exactly one of the eight rollback branches has a failure test
(`characterSpell.togglePrepared`); the other seven, and all thirteen settled
invalidation bindings in these four suites, have none.

That means a refactor can drop or mis-key a hook's `onError` or `onSettled`
wiring and every focused test stays green. The user-visible failure is quiet and
nasty: a failed mutation leaves stale optimistic state on the sheet (a spell slot
shown as spent that the server rejected, an inventory item that never actually
deleted), or a succeeded mutation never refetches the queries it changed. The
suites instead spend lines on shell assertions — `typeof result.current.createItem
=== "function"` — that pass under any wiring at all. The seams needed to close
the gap already exist in this directory; nothing new has to be built.

## Evidence

- Eight optimistic mutations carry `onMutate`/`onError`/`onSettled` wiring:
  inventory update `packages/client/src/hooks/character-sheet/use-inventory.ts:59-74`
  and delete `use-inventory.ts:76-91`; spellSlot use
  `use-spell-slots.ts:45-62`, recover `use-spell-slots.ts:64-79`, recoverAll
  `use-spell-slots.ts:81-92`; sorceryPoint convertSlotToPoints
  `use-sorcery-points.ts:50-61`; characterSpell remove
  `use-character-spells.ts:56-67` and togglePrepared
  `use-character-spells.ts:69-83`.
- Five more are settled-only (no `onMutate`/`onError`): inventory create
  `use-inventory.ts:55-57`, sorceryPoint createSlotFromPoints
  `use-sorcery-points.ts:63-67`, characterSpell add
  `use-character-spells.ts:52-54`, cast `use-character-spells.ts:85-87`,
  dropConcentration `use-character-spells.ts:89-91` — thirteen settled
  invalidation bindings in total.
- The invalidation families differ per hook and per mutation:
  `use-inventory.ts:50-53` invalidates both `inventoryKey` and the
  `trpc.inventory.list.queryFilter({ characterId })`; `use-spell-slots.ts:40-43`
  invalidates `characterKey` + `spellsKey`; `use-sorcery-points.ts:46-48`
  invalidates `characterKey` only; `use-character-spells.ts:44-46` (`invalidate`,
  `spellsKey` only, bound to add/remove/togglePrepared) vs
  `use-character-spells.ts:47-50` (`invalidateAll`, `spellsKey` + `characterKey`,
  bound to cast/dropConcentration).
- Only one rollback branch is asserted through the hook:
  `use-character-spells.test.ts:194-241` fails `togglePrepared` with FORBIDDEN
  and asserts the cache captured at the rollback moment. The other seven
  branches have no failure test anywhere in the four suites.
- Zero invalidation assertions in the four target suites: no
  `invalidateQueries` spy appears in `use-inventory.test.ts`,
  `use-spell-slots.test.ts`, `use-sorcery-points.test.ts`, or
  `use-character-spells.test.ts`. The pattern exists in the sibling suites —
  `use-character-personality.test.ts:32-47` asserts both exact keys after
  settlement, and `use-weapon-masteries.test.ts:75`, `use-rest.test.ts:167`,
  `use-character-level-up.test.ts:74` all spy the same way.
- The suites instead carry shell assertions that any wiring passes:
  "exposes createItem/updateItem/deleteItem mutation function" typeof checks at
  `use-inventory.test.ts:76-88` and `:109-114`; "exposes flexible casting
  mutation functions" at `use-sorcery-points.test.ts:47-51` and "all pending
  flags start as false" at `:100-104`.
- Every seam the fix needs already exists: `overrideMockTRPC` keep-pending
  helpers that spread the hook-supplied opts over a replaced `mutationFn`
  (`use-inventory.test.ts:15-47`, `use-spell-slots.test.ts:28-77`,
  `use-character-spells.test.ts:21-53`, `use-sorcery-points.test.ts:23-38`);
  `armMockTRPCMutationFailure` (`use-character-spells.test.ts:6,18`); a
  reject-once + persistent-wrapper + exact-snapshot rollback template
  (`use-character-stats-adjust-hp.test.tsx:215-245`); and a `restoreSnapshot`
  module spy that captures cache state at rollback before the settled refetch
  repopulates it (`use-character-spells.test.ts:211-240`).

## Proposed direction

Keep the approach entirely inside the four test files —
`use-inventory.test.ts`, `use-spell-slots.test.ts`, `use-sorcery-points.test.ts`,
`use-character-spells.test.ts` in `packages/client/src/hooks/character-sheet/`
— using the two seams the suite already owns; add no new infrastructure. Run
each suite with `bun run test -- <file>` as it grows.

1. **One failure test per uncovered rollback branch** — seven: inventory
   update + delete, spellSlot use + recover + recoverAll, sorceryPoint
   convertSlotToPoints, characterSpell remove (togglePrepared is already
   covered at `use-character-spells.test.ts:194-241`). Override that
   procedure's `mutationOptions` via `overrideMockTRPC` with a rejecting
   `mutationFn` while spreading the hook-supplied opts — the existing
   keep-pending helpers (`use-inventory.test.ts:15-47`,
   `use-spell-slots.test.ts:28-77`) are the exact template; a reject variant is
   a one-line `mutationFn` change. Seed the cache, assert the optimistic write
   landed, then assert exact restoration of the seeded snapshot.
   `use-character-stats-adjust-hp.test.tsx:215-245` is the reference for the
   reject-once + `createPersistentWrapper` + exact-snapshot shape.
2. **Capture cache state at the rollback moment, not after settle.** The
   `onSettled` invalidation refetch repopulates the cache from mock fixtures,
   so a naive post-settle read passes even with the `onError` wiring deleted.
   Use the `restoreSnapshot` module-spy pattern from
   `use-character-spells.test.ts:211-240` (or `createPersistentWrapper` where
   the refetch cannot repopulate) consistently.
3. **Assert every settled invalidation binding per mutation.** Spy on the
   wrapper queryClient's `invalidateQueries` (`vi.spyOn`, as in
   `use-character-personality.test.ts:32-47`) and after settlement assert each
   key/filter the hook binds: use-inventory both `inventoryKey` and the
   `trpc.inventory.list.queryFilter`; use-spell-slots `characterKey` +
   `spellsKey`; use-sorcery-points `characterKey` only; use-character-spells
   distinguishing `invalidate` (`spellsKey`) from `invalidateAll` (`spellsKey`
   + `characterKey` on cast/dropConcentration). Assert the per-mutation
   binding, never a generic "something was invalidated". The five settled-only
   mutations (inventory create, sorceryPoint createSlotFromPoints,
   characterSpell add, cast, dropConcentration) need only this invalidation
   assertion, not a rollback test.
4. **Replace the shell tests these subsume** — the "exposes X mutation
   function" typeof assertions — while keeping the existing optimistic-state
   and campaign-scope tests as-is.

Detail notes: `recoverAll` takes no per-slot variables (`use-spell-slots.ts:83`),
so its rollback test should seed multiple partially-used slots and assert all
are restored. "Invalidation families" always means *every key the hook binds
for that mutation* — the families are per-hook, not uniform (single-key in
use-sorcery-points; two distinct settled callbacks in use-character-spells).

## Scope / caveats

- **Out of scope:** any change to the hooks themselves, `cache-helpers.ts`
  (separately tested in `cache-helpers.test.ts`), the mock-trpc test
  infrastructure, and e2e coverage.
- **The rollback-vs-settled-refetch race is the main flake source.** Asserting
  cache contents after the settled invalidate refetch resolves reads fixture
  data, not the rollback result — producing tests that pass without the
  `onError` wiring. The capture-at-rollback spy or persistent wrapper must be
  used on every rollback test, not just where a failure is first noticed.
- **A careless override drops the contract under test.** Replacing
  `mutationOptions` wholesale instead of spreading the hook-supplied opts
  (`...trpc.x.y.mutationOptions(opts)`) silently discards the very
  `onError`/`onSettled` bindings being tested, yielding green tests that
  assert nothing. Follow the existing keep-pending helpers exactly.
- **Invalidation assertions couple tests to exact key/filter shapes** — an
  intentional key refactor fails many tests at once. Acceptable here, since
  the binding is the contract, but prefer deriving expected keys from the
  shared `character-keys.ts` helpers over hand-written literals so there is
  one source of truth.
- Read `packages/client/src/hooks/character-sheet/MODULE.md` first; it states
  the optimistic-rollback and invalidation ownership these tests pin.
- **Adjacent leaves touch the same files; avoid concurrent edits** (no hard
  ordering): [044-optimistic-writers-spread-transport.md](./044-optimistic-writers-spread-transport.md)
  edits the optimistic writers in `use-inventory.ts` and siblings — the exact
  `onMutate` behavior these failure tests seed around; and
  [062-character-key-hook-constructs-three-filter.md](./062-character-key-hook-constructs-three-filter.md)
  trims unused filter members from `character-keys.ts`, which the invalidation
  assertions should read their expected keys from.
- Land
  [041-character-hooks-expose-second-identity.md](./041-character-hooks-expose-second-identity.md)
  before this leaf so the new rollback and invalidation tests use the narrowed
  action payloads; 041 changes all four hook implementations consumed here and
  their adjacent suites.

**Implementation notes (2026-09-12, `fix/cq-050`):**

- Done, entirely inside the four test files (no hook, `cache-helpers.ts`,
  mock-trpc, or e2e change; no new shared test infrastructure). All seven
  uncovered rollback branches now have a consumer-level failure test
  (inventory update + delete, spellSlot use + recover + recoverAll,
  sorceryPoint convertSlotToPoints, characterSpell remove), and all thirteen
  settled invalidation bindings are asserted per mutation with
  `toHaveBeenCalledTimes(n)` plus one `toHaveBeenCalledWith` per bound key —
  never "something was invalidated". The `use-character-spells` tests pin the
  `invalidate` (spellsKey only, with an explicit `not.toHaveBeenCalledWith`
  on characterKey) vs `invalidateAll` (spellsKey + characterKey) split.
- Rollback shape: each test keeps the mutation pending through the existing
  keep-pending helper (which now returns its `Deferred` so the test can
  `reject` it), asserts the optimistic write landed, rejects, then asserts
  the cache captured at the `restoreSnapshot` moment `toEqual`s the seeded
  snapshot. Every rollback test uses a file-local `captureCacheAtRollback()`
  (the module-spy pattern from the pre-existing togglePrepared test, which was
  moved onto the same helper); none reads the cache after settle. The helper
  is duplicated per file by design — the leaf asked for no new infrastructure
  — and is a candidate for a `*.test-helper.ts` consolidation later.
- Expected keys are derived, not hand-written: each suite renders the hook
  alongside `useCharacterKeys` (and `useTRPC().inventory.list.queryFilter`
  for the inventory filter) inside the same `renderHook` callback.
- Shell tests replaced: inventory "exposes createItem/updateItem/deleteItem
  mutation function" (three), sorcery "exposes flexible casting mutation
  functions" and "all pending flags start as false", and the sorcery
  "createSlotFromPoints invokes without error" smoke test (now the settled
  invalidation assertion). The optimistic-state, campaign-scope, and 044
  projection / parse-throw tests are untouched.
- Break-the-wiring proof run per suite before committing (hook edited, suite
  run, hook restored from a backup copy): removing `onError` failed every new
  rollback test with `expected undefined to deeply equal …`; removing an
  `onSettled` or swapping `invalidateAll`/`invalidate` on cast/toggle failed
  the matching invalidation tests on their call counts.
- Nothing narrowed. Test counts: inventory 14 -> 14, spell-slots 9 -> 12,
  sorcery-points 7 -> 6, character-spells 9 -> 15.

**Round-1 fixes (2026-09-12, after the Opus round-1 review):**

- Applied (P1): the per-file `captureCacheAtRollback()` copies restored
  their `restoreSnapshot` spy only through a trailing `rollback.restore()`
  call, so a failing assertion leaked the spy (`clearMocks` does not restore
  implementations) and the next capture wrapped it in itself, overflowing
  the stack and adding a misleading second red test. The helper now lives
  once in `cache-helpers.test-helper.ts` and restores its spy through
  `onTestFinished`; the eight `restore()` call sites are gone. Re-proved:
  a deliberately failing rollback assertion, and a hook with its remove
  `onError` deleted, each produce exactly one red test and no overflow.
  `read()` returns `unknown` (the seeded value in each `toEqual` carries the
  shape) because the lint tier rejects a single-use type parameter.
- Applied (P2, consolidation): the new `*.test-helper.ts` supersedes the
  "duplicated per file by design" note above. The leaf's "no new
  infrastructure" caveat targets the mock-tRPC seam, not a colocated test
  helper of the kind this directory already keeps
  (`use-character-stats.test-helper.tsx`). The file is excluded from
  coverage by the existing `*.test-helper.*` glob; the lint coverage-map row
  count for the client test tier moved 346 -> 347 and the generated map was
  refreshed. The three spell-slot rollback tests are one `it.each` with a
  `slot()` seed helper; `recoverAll` keeps its multi-slot partially-used seed.
- Applied (P2, redundant case): the `removeSpell` row of the `invalidate`
  `it.each` is dropped; its rollback test asserts the same count and key
  against the same `onSettled` binding (deleting the binding fails the
  rollback test alone).
- Applied (P2, row shape): `SeededSpellRow` is replaced by one
  `SEEDED_SPELLS` const sliced from `TEST_CHARACTER_SPELLS` and typed
  `CharacterSpellWithDetails`, shared by the optimistic-remove and rollback
  tests.
- Applied (P2, docs): `MODULE.md` "Test Seams" gains the capture-at-rollback
  and derived-keys conventions.
- Nothing declined. Test counts after the round: spell-slots 12 (unchanged,
  now tabled), character-spells 15 -> 14.

**Final-round fixes (2026-09-12, after the round-3 review):**

- Applied (P1): `captureCacheAtRollback()` read `qc.getQueryData(key)` with
  the key the hook handed to `restoreSnapshot`, so a mis-keyed `onError` was
  a false green — the restore wrote the snapshot to the wrong key and the
  capture read that same wrong key back, while the seeded query kept the
  optimistic write. The helper now takes `(queryClient, seededKey)` and
  reads the key the test seeded. Proof: mis-keying `use-character-spells`
  `remove` `onError` to `characterKey` and `use-spell-slots` `recoverAll`
  `onError` to `spellsKey` each left the suite fully green before the change
  (14/14 and 12/12) and each fails exactly its own rollback test after it.
- Applied (P2, narrowing step 4): the seven pre-existing `optimistically …`
  tests that the rollback tests subsume are deleted — spell-slots useSlot /
  recoverSlot / recoverAll, inventory delete / update, character-spells
  remove, sorcery convertSlotToPoints. Each rollback test seeds the same
  cache, fires the same mutation and waits on the same optimistic assertion
  before rejecting, so the duplicates bought no signal while still building
  a persistent wrapper and rendering the hook. Step 4's "keep the existing
  optimistic-state tests as-is" is narrowed accordingly. Kept: the clamping
  tests (`does not increment used past total`, `does not decrement used
  below zero`), the campaign-scope tests, and the 044 patch-projection /
  parse-throw tests — none of those is covered by a rollback test. The
  sorcery rollback test absorbed the consumed-slot assertion its duplicate
  carried. Re-proved after the deletions: neutering the `useSlot` increment
  and the inventory update patch each fails the matching rollback test, so
  the optimistic writes are still pinned.
- Declined (P2, `isPending` column): the `expect(isPending(...)).toBe(false)`
  read inside each settled `waitFor` is redundant with the invalidation call
  count, but it is the line that says "the mutation settled" at the point of
  the wait; dropping it churns four files for no change in signal, and both
  final-round reviewers rated it non-blocking.
- Test counts after the round: inventory 14 -> 12, spell-slots 12 -> 9,
  sorcery-points 6 -> 5, character-spells 14 -> 13 (93 in the directory).
- Applied (two P2s from the scoped round-3 re-read): the sorcery rollback
  test's absorbed optimistic assertion read only `spellSlots[1]?.used`, so
  `convertSlotToPoints` could burn every available slot and stay green — it
  now compares the whole `spellSlots` array in the same `waitFor`, in the
  `use-spell-slots` `optimisticUsed` style. Re-proved the reviewer's way:
  dropping the `slot.spellLevel === slotLevel` guard from
  `use-sorcery-points.ts` fails the strengthened test (slot-1 reads
  `used: 1`) where it passed before, and the suite is green again with the
  guard restored (93/93). And the MODULE.md rollback-test convention claimed
  every rollback test waits on the optimistic state, which would license
  deleting the two `optimistically toggles prepared status` tests — the
  `togglePrepared` rollback test waits on the toast instead, so those two
  are that write's only pin; the sentence now names the exception and says
  they must stay. Nothing else from the re-read was actioned: it closed the
  P1 and raised no other finding.
