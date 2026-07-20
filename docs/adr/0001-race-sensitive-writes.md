---
id: ADR-0001
date: 2026-07-20
status: Accepted
enforced_by:
  - eslint-rule:local/concurrency-guard
  - restricted-import:RawTxClient
  - type-boundary:packages/server/src/utils/prisma-types.ts#TxClient
  - package-script:codemod:concurrency-guard
  - test-file:packages/server/src/routers/invite-concurrency.test.ts
guide: docs/guides/add-race-sensitive-mutation.md
---

# Race-sensitive writes use mutation boundaries

## Context

Several direct Prisma writes landed before the helper boundary was enforced,
leaving concurrent requests able to lose updates. Five delegates carry the
gated mutable state: `characterStats`,
`encounterParticipant`, `encounter`, `characterSpellSlot`, and
`characterClass`. Character HP has one shared source of truth on
`CharacterStats`; encounter participants do not fork it into a snapshot.

## Decision

`TxClient` and `DbClient` make `update`, `updateMany`, and `upsert` unavailable
on the five gated delegates. Business code writes through the matching
`utils/*-mutations.ts` helper. `RawTxClient` is the mutation-helper-only escape
hatch; casts, lint suppression, and router-level imports are not alternatives.

Extending the surface requires all three parts in one change: a mutation
helper, the restricted delegate type, and the import boundary. HP changes stay
Pattern A writes through `updateCharacterStatsLocked`. Appending a `CombatLog`
row is attribution, not a new race-sensitive helper surface, because the log
is append-only.

Pattern C covers a standalone atomic claim when its precondition fits in one
statement. Campaign invite acceptance places `usesRemaining > 0` in the
`updateMany` `where`; zero affected rows means the last use was taken and maps
to `CONFLICT`, preventing check-then-increment oversubscription.

## Consequences

Follow `docs/CONCURRENCY.md` for the patterns and scope test, and use the
linked guide for the extension recipe. The invite concurrency test is the
deterministic gate for the Pattern C claim; the lint, type, and import gates
keep the five helper-owned delegates closed to direct writes.
