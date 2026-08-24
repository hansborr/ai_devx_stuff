# Add A Race-Sensitive Mutation

Use this path only when a write has real lost-update risk. Start with the
decision, not the lock.

The enforced architectural boundary is ADR-0007:
`docs/adr/0007-runtime-guarded-mutation-boundaries.md`.

1. Clear the three-bar gate in `docs/CONCURRENCY.md` §"Scope — when a gate is
   worth adding" before adding any concurrency control:
   multiple real-world writers can hit the same row, a lost update creates
   user-visible wrong state, and the user cannot trivially recover. New gates
   also need a reported real-session bug, not a theoretical race argument (the
   "New gates need a reported bug" rule in that section).
2. If any bar is missing, keep the write simple. Set-semantics tables,
   last-writer-wins UI, single-writer paths, and append-only logs are called
   out under "Not candidates" in that section.
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
   `assertTurnLock`, and `updateEncounterMeta`. Gated delegates still use
   their helpers; a standalone compound claim such as `CampaignInvite`
   acceptance may write explicitly when its complete precondition is encoded
   in the statement and a focused invariant test gates the result.
7. If the precondition is a property of *sibling* rows rather than of the row
   being written — "fewer than N of this character's spells are prepared" —
   none of the three patterns fits, because there is nothing to put in a
   compound WHERE. Wrap the read and the write in one
   `isolationLevel: "Serializable"` transaction and retry the abort; see
   `docs/CONCURRENCY.md` §"Serializable isolation exception" and
   `utils/prepared-spell-toggle.ts`. Derive the value you write from the row
   the transaction reads, not from a pre-transaction read in the caller —
   otherwise a retry re-asserts a stale desired state instead of re-deciding.
   Detect the abort with `isPrismaSerializationFailure`
   (`utils/prisma-errors.ts`). Do not gate the delegate for a
   transaction-local fix. What this buys you is a guarantee about *that write
   path*; if other writers can reach the same invariant without the check,
   say so where you document it rather than claiming the invariant holds.
   **Serializable only sees other Serializable transactions.** Postgres tracks
   read/write anti-dependencies between serializable transactions and nowhere
   else, so a concurrent READ COMMITTED writer — which is every other path in
   this repo — is invisible to it. Against those you get only what repeatable
   read gives you: a stable snapshot, plus first-updater-wins on rows that were
   *in that snapshot* and that you then UPDATE. If your invariant depends on a
   row you merely read, wrapping it in Serializable does not protect it; say so
   instead of implying detection.
   **"Rows you write" is not the same as "the rows your statement targets."**
   First-updater-wins fires when your UPDATE reaches a row whose latest version
   was committed after your snapshot. A row *inserted* after your snapshot is
   not in it, your statement never reaches it, and you commit blind past it —
   so a set-shaped `updateMany({ where: { parentId } })` over a to-many
   relation buys you nothing against a concurrent INSERT into that relation.
   That is exactly the shape a set-level invariant has, so the write you rely
   on to be exclusive with the other path must be a row that *already exists*
   for both of you — in practice a single owning row both paths UPDATE. On the
   Serializable path, make it the first write immediately after the
   snapshot-defining read, before any dependent write. A READ COMMITTED peer
   has no equivalent snapshot rule; keep the row as the first write in its
   post-validation write phase. `docs/CONCURRENCY.md`
   §"Serializable isolation exception" works this through for long rest versus
   level-up, where the barrier is the `CharacterStats` row and the class-row
   `updateMany` is not one. `utils/serializable-isolation.test.ts` pins all of
   it, INSERT case included.
8. Preserve conflict semantics. Pattern A/B helpers throw `CONFLICT` when the
   CAS `updateMany` affects zero rows; `advanceTurnCompound` returns row count
   so callers can distinguish `BAD_REQUEST` from `CONFLICT`. See the rule for
   each pattern in `docs/CONCURRENCY.md`.
9. For cross-table writers, acquire rows in the canonical order from
   `docs/CONCURRENCY.md` §"Cross-table invariants":
   `CharacterStats` -> `CharacterClass` -> `CharacterSpellSlot` ->
   `EncounterParticipant`. If you cannot follow that order, prove row-identity
   disjointness and update the writer list in `docs/CONCURRENCY.md`.
10. Do not import `RawTxClient` outside `packages/server/src/utils/*-mutations.ts`.
    The `RawTxClient` declaration in
    `packages/server/src/utils/prisma-types.ts` documents the escape hatch, and
    the restricted-import rule in
    `eslint-config/package-boundary-configs.js` enforces the `RawTxClient`
    boundary.
11. Do not call `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert`
    directly on gated delegates from business code.
    The `RestrictedDelegates` and `ConcurrencyGatedWrite` declarations in
    `packages/server/src/utils/prisma-types.ts` make those methods type errors
    for `CharacterStats`, `EncounterParticipant`, `Encounter`,
    `CharacterSpellSlot`, and `CharacterClass`.
12. Add invariant-style concurrency tests: run parallel writers and assert the
    final database state, not just response shape. Follow
    `packages/server/src/utils/character-stats-mutations.test.ts`,
    `packages/server/src/utils/participant-stats-mutations.test.ts`,
    `packages/server/src/utils/character-class-mutations.test.ts`,
    `packages/server/src/routers/character-stats-concurrency.test.ts`,
    `packages/server/src/routers/encounter-combat-concurrency.test.ts`, and
    `packages/server/src/routers/sorcery-point.test.ts`.
13. Use `[200, 409]` response assertions only when the client sends a CAS token
    such as `expectedVersion`; otherwise assert state consistency after
    `Promise.all` or `Promise.allSettled` (`docs/CONCURRENCY.md` §"Testing").
14. Run the focused test file while iterating. Use full foreground
    `bun run verify` when the change touches the generated relation graph,
    `prisma-types.ts`, or the ESLint rule; otherwise run
    `bun run verify:changed` before calling the change done.

Useful checks:

- `local/concurrency-guard` catches direct gated delegate `.update`,
  `.updateMany`, `.updateManyAndReturn`, and `.upsert` calls outside
  `utils/*-mutations.ts` with the helper to use. Its second branch catches
  literal *nested* relation writes (`character.update({ data: { stats: {
  update: … } } })`) as an early diagnostic. The mandatory Prisma query
  extension is the closure mechanism and also rejects helper/spread-assembled
  or multi-hop payloads at runtime. Write the parent and gated rows as separate
  statements, routing the gated one through its helper.
  `bun run codemod:concurrency-guard -- <file>` is a read-only scanner for
  direct writes and sanctioned-helper shape drift. It reports suggested helper
  boundaries but never rewrites source; nested diagnostics belong to ESLint
  and the runtime guard rather than a second static scanner.
- `RawTxClient` restricted import blocks new Prisma escape hatches outside
  `utils/*-mutations.ts`.
- Typecheck catches restricted-delegate `.update`, `.updateMany`,
  `.updateManyAndReturn`, and `.upsert`
  calls on gated tables — and, because the delegates are not assignable to
  their raw Prisma counterparts, also catches attempts to escape the ban by
  forwarding `TxClient` / `DbClient` into a `Prisma.TransactionClient` binding.
- The negative type tests in `packages/server/src/utils/__type-tests__/` keep
  the restricted delegates from drifting.
- `bun run doctor` includes broader worktree, DB, dependency, lint-suppression,
  and migration-safety drift checks when the change also touches those surfaces.
