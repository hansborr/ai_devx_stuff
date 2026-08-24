# 50. Seven of eight optimistic character-sheet rollback branches — and every settled invalidation binding — have no consumer-level test

Status: Not started
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
