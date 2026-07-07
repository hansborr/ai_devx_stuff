# Add A Race-Sensitive Mutation

Use this path only when a write has real lost-update risk. Start with the
decision, not the lock.

1. Clear the three-bar gate from `docs/CONCURRENCY.md:9` before adding any
   concurrency control:
   multiple real-world writers can hit the same row, a lost update creates
   user-visible wrong state, and the user cannot trivially recover. New gates
   also need a reported real-session bug, not a theoretical race argument
   (`docs/CONCURRENCY.md:40`).
2. If any bar is missing, keep the write simple. Set-semantics tables,
   last-writer-wins UI, single-writer paths, and append-only logs are called
   out as non-candidates in `docs/CONCURRENCY.md:27`.
3. Reuse an existing helper in `packages/server/src/utils/*-mutations.ts`
   before adding a new one. These files are the trust boundary for gated
   tables and the only files allowed to import `RawTxClient`.
4. Pick Pattern A when the row has a `version` column and the new value is
   derived from fresh in-transaction state. Existing helpers:
   `updateCharacterStatsLocked`,
   `updateCharacterStatsLockedWithExpectedVersion`,
   `updateParticipantStatsLocked`, and
   `updateParticipantStatsLockedWithExpectedVersion`.
5. Pick Pattern B when a counter is itself the optimistic-lock key. Existing
   helpers in `spell-slot-mutations.ts` and `character-class-mutations.ts`
   include `consumeSpellSlot`, `recoverSpellSlot`, `advanceClassLevel`,
   `spendHitDice`, and `setSubclass`.
6. Pick Pattern C when every JS guard field must also appear in a compound
   `updateMany` WHERE, especially `Encounter` state, round, and turn-index
   transitions. Existing helpers in `encounter-state-mutations.ts` include
   `advanceTurnCompound`, `setEncounterState`, `setCurrentTurnIndex`,
   `assertTurnLock`, and `updateEncounterMeta`.
7. Preserve conflict semantics. Pattern A/B helpers throw `CONFLICT` when the
   CAS `updateMany` affects zero rows; `advanceTurnCompound` returns row count
   so callers can distinguish `BAD_REQUEST` from `CONFLICT`
   (`docs/CONCURRENCY.md:63`, `docs/CONCURRENCY.md:112`,
   `docs/CONCURRENCY.md:137`).
8. For cross-table writers, acquire rows in the canonical order from
   `docs/CONCURRENCY.md:153`:
   `CharacterStats` -> `CharacterClass` -> `CharacterSpellSlot` ->
   `EncounterParticipant`. If you cannot follow that order, prove row-identity
   disjointness and update the writer list in `docs/CONCURRENCY.md`.
9. Do not import `RawTxClient` outside `packages/server/src/utils/*-mutations.ts`.
   `packages/server/src/utils/prisma-types.ts:13` documents the escape hatch,
   and the restricted-import rule in
   `eslint-config/package-boundary-configs.js` enforces the `RawTxClient`
   boundary.
10. Do not call `.update`, `.updateMany`, or `.upsert` directly on gated
    delegates from business code. `packages/server/src/utils/prisma-types.ts:9`
    documents the restriction, and the delegate shims at
    `packages/server/src/utils/prisma-types.ts:26` make those methods type
    errors for `CharacterStats`, `EncounterParticipant`, `Encounter`,
    `CharacterSpellSlot`, and `CharacterClass`.
11. Add invariant-style concurrency tests: run parallel writers and assert the
    final database state, not just response shape. Follow
    `packages/server/src/utils/character-stats-mutations.test.ts`,
    `packages/server/src/utils/participant-stats-mutations.test.ts`,
    `packages/server/src/utils/character-class-mutations.test.ts`,
    `packages/server/src/routers/character-stats-concurrency.test.ts`,
    `packages/server/src/routers/encounter-combat-concurrency.test.ts`, and
    `packages/server/src/routers/sorcery-point.test.ts`.
12. Use `[200, 409]` response assertions only when the client sends a CAS token
    such as `expectedVersion`; otherwise assert state consistency after
    `Promise.all` or `Promise.allSettled` (`docs/CONCURRENCY.md:287`).
13. Run the focused test file while iterating, then run
    `bun run verify:changed` before calling the change done.

Useful checks:

- `local/concurrency-guard` catches direct gated delegate `.update`,
  `.updateMany`, `.updateManyAndReturn`, and `.upsert` calls outside
  `utils/*-mutations.ts` with the helper to use.
- `RawTxClient` restricted import blocks new Prisma escape hatches outside
  `utils/*-mutations.ts`.
- Typecheck catches restricted-delegate `.update`, `.updateMany`, and `.upsert`
  calls on gated tables.
- The negative type tests in `packages/server/src/utils/__type-tests__/` keep
  the restricted delegates from drifting.
- `bun run doctor` includes broader worktree, DB, dependency, lint-suppression,
  and migration-safety drift checks when the change also touches those surfaces.
