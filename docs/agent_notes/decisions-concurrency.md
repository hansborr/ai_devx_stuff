# Decisions — concurrency

Concurrency-domain entries split out of `DECISIONS.md` once it crossed
~400 lines. See `DECISIONS.md` for the full preamble (when to read, when to
add, entry template) and the index of domain files.

---

## Race-sensitive writes: compile-enforced `never` on gated tables

Status: Active
Domain: concurrency

### Context
Five tables carry state that races across concurrent requests (combat HP,
turn order, spell slots, leveling, encounter lifecycle). Runtime helpers
existed but nothing stopped a future contributor from reaching past them
with a plain `prisma.characterStats.update(...)` — and several incidents
landed that way before this was tightened.

### Decision
In `packages/server/src/utils/prisma-types.ts`, the `TxClient` / `DbClient`
types override `update`, `updateMany`, and `upsert` on the gated delegates
(`characterStats`, `encounterParticipant`, `encounter`, `characterSpellSlot`,
`characterClass`) as `never`. The sanctioned escape is `RawTxClient`, which
ESLint's `no-restricted-imports` allows only from `utils/*-mutations.ts`.

### Consequences
- Adding a new race-sensitive table means (a) mutation helper in
  `utils/<name>-mutations.ts`, (b) `never`-override on the delegate in
  `prisma-types.ts`, (c) extending the ESLint allowlist for the new helper
  file. Skipping any of these breaks the gate.
- If a new procedure "needs" `.update` on a gated table, it doesn't — write
  the mutation through the existing helper or add a new helper function.
  Disabling the ESLint rule or casting through `RawTxClient` in router code
  is never the right answer.

### References
- `packages/server/src/utils/prisma-types.ts`
- `packages/server/src/utils/*-mutations.ts`
- `docs/CONCURRENCY.md`

---

## Invite accept: compound `updateMany` (Pattern C), not check-then-increment

Status: Active
Domain: concurrency

### Context
Accepting a campaign invite needs to atomically decrement `usesRemaining`
and attach the membership. The obvious shape — read invite, verify
`usesRemaining > 0`, then update — races: two accepts observing the same
row both pass the check and drive it negative.

### Decision
Use a single `updateMany({ where: { id, usesRemaining: { gt: 0 } }, data: { decrement } })`
call ("Pattern C"). The WHERE clause *includes* the precondition, so the
DB either updates exactly one row or zero, and `count === 0` means "someone
else took the last use" — map to `CONFLICT`.

### Consequences
- The pattern generalizes to any "atomically claim one of N" operation
  (seat reservations, slot decrements, inventory takes). Reach for it
  before reaching for a transaction-level lock.
- Never split a "check then write" into two Prisma calls when both touch
  the same row and the precondition is expressible in WHERE.

### References
- `docs/CONCURRENCY.md` — Pattern C section.
