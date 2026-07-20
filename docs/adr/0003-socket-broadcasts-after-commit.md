---
id: ADR-0003
date: 2026-07-20
status: Accepted
enforced_by:
  - eslint-rule:local/no-broadcast-in-transaction
  - eslint-rule:local/socket-registry-broadcasts
  - test-file:packages/server/src/socket/broadcast-registry.test.ts
guide: docs/guides/add-socket-broadcast.md
---

# Socket broadcasts happen after commit through the registry

## Context

An emit inside a transaction can expose state that later rolls back. A direct
emit of a registry-owned event also bypasses payload validation and structured
broadcast logging.

## Decision

Persistence completes before broadcast. Registry-owned events flow through
`broadcast()` / `broadcastToUsers()` and their family helpers. Transaction
callbacks return committed data or a side-effect plan; callers fan out only
after the transaction resolves.

For sheet and rest HP writes, every attribution `CombatLog` row is written in
the same transaction as the Pattern A HP change. The returned affected
encounter list is broadcast after commit through `broadcastEncounterUpdate`.
Every active encounter containing the character receives an entry and fan-out.
A genuine zero-delta write creates neither a log row nor a broadcast.

This attribution scope covers sheet/rest HP writes. DM override and level-up
remain deliberate exceptions; combat attack and spell paths already own their
logging transactions.

## Consequences

New event families register their schema, delivery policy, and logging fields
before adding a helper. Callers return side-effect plans across transaction
boundaries and never emit from inside them. See `docs/socket-architecture.md`
for the realtime boundary and the linked guide for the repair sequence.
