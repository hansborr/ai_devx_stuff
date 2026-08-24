---
id: ADR-0001
date: 2026-07-20
status: Superseded by ADR-0007
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

The type gate covers *delegate* writes only. Every gated table is also a
relation of a non-gated one, and a nested write through the parent
(`character.update({ data: { stats: { update: … } } })`) goes through the
generated update-input types instead — outside the branded delegates by
construction. That path is held by the nested branch of
`local/concurrency-guard` alone, which is a name-matching lint and therefore
defense in depth rather than closure — a weaker guarantee than the delegate
ban, and one a payload assembled outside the call site still escapes. It is
scoped to resolved Prisma mutation arguments so it does not turn every
`{ stats: { update: … } }` object into a hard error, and it applies inside
`utils/*-mutations.ts` too, because a helper's single-table trust does not
extend to a different table reached through a non-gated parent. Its relation
table is keyed `<parent model>.<relation field>` and derived from
`schema.prisma` by `concurrency-guard-drift.test.ts`, so schema growth fails
the guard rather than widening the escape silently. Every finding names a
relation the parent model actually declares, which is what keeps a hard error
off type-valid writes that merely reuse a relation name — `Spell.classes` is a
`Json` scalar, `Character.classes` is the gated relation.
