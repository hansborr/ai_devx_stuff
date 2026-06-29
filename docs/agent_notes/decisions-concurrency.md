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

---

## HP-write attribution in an active encounter: option (b), append-only log (ux-audit P0-3)

Status: Active
Domain: concurrency

### Context
Encounter and sheet share one HP value (`resolveParticipantStats` returns
`CharacterStats.currentHp`; participants store no combat snapshot). A
sheet-side write — Second Wind / `adjustHp`, short/long rest — changed the
encounter's view of HP but wrote no combat-log entry, so the DM saw tracked
damage "silently revert to full", indistinguishable from corruption. Combat
damage/heal already write a combat log; sheet and rest writes did not. The
audited session also showed HP oscillating under a concurrent DM-damage +
player-heal race.

### Decision
Implement option (b) from the leaf, not option (a). Keep the single
source of truth (shared `CharacterStats` HP) and route every HP write
through one attribution path: when the character is in an **active**
encounter, append an attributed `CombatLog` entry inside the same
transaction as the HP write, then broadcast `encounter:updated` after the
transaction commits. Reuse the existing combat-log + `broadcastEncounterUpdate`
machinery; do not snapshot HP onto the participant (option a changes the
data model and forks the source of truth).

The attribution helper `logCharacterHpChangeInTx` lives in
`utils/encounter-hp-log.ts`. It is **not** a race-sensitive helper and does
**not** expand the locked-mutation surface: `CombatLog` is append-only,
explicitly a non-candidate for CAS in `docs/CONCURRENCY.md §Scope`. The HP
write itself still goes through `updateCharacterStatsLocked` (Pattern A),
which already serializes concurrent writers via version-CAS; the helper only
records what that write did (before/after captured from the locked helper's
fresh-stats mutator and returned row). Because it only *reads*
`EncounterParticipant`/`Encounter` and *creates* a `CombatLog`, it needs no
`RawTxClient` escape and trips no gated-delegate ban.

### Consequences
- **Scope of what IS attributed** (NOT "every HP write" — that earlier claim
  was overstated): the sheet/rest write sites —
  `character-live-state/stats-conditions.ts` (`adjustHp`, `updateStats`) and
  `rest-service.ts` (short + long rest). Combat attack/spell paths already
  log via their own transactions, so they were left unchanged.
- **Deliberate out-of-scope exceptions** (two `updateCharacterStatsLocked`
  callers are intentionally NOT routed through the attribution helper):
  - **DM-override** (`services/character-live-state/participant.ts`, via
    `routers/encounter.ts:updateParticipant`) — the encounter router already
    broadcasts `encounter:updated` for this path, and the DM is looking at the
    tracker they just edited, so a combat-log line adds little.
  - **Level-up** (`services/level-up/apply-level-up.ts`) — writes `currentHp`
    + `hpGain`; rare mid-combat.
  - Follow-up: consider attributing these two as well (out of scope for P0-3;
    not wired here).
- Zero-delta writes (both currentHp and tempHp deltas zero, e.g. heal at full
  HP with no temp HP) log nothing — the combat log is not polluted by no-op
  clicks. A non-zero temp-HP delta (including damage fully absorbed by temp HP,
  currentHp delta 0) IS a visible HP-bar change and IS surfaced (codex P2 fix).
- A character in more than one active encounter gets an attributed entry +
  `encounter:updated` broadcast in EVERY active encounter, not just the oldest:
  the shared `CharacterStats` HP is surfaced into all of them, so one write
  changes the HP bar everywhere (codex P2 fix — `logCharacterHpChangeInTx` uses
  `findMany` and returns one `LoggedHpChange` per active encounter).
- The concurrent DM-damage + player-heal race now converges on a consistent
  final HP (Pattern A serialization, unchanged) AND surfaces both log
  entries; the P2-22 transient flicker is the same family and is resolved
  because the encounter view is broadcast on every HP write.
- Broadcasts fire strictly after the transaction commits, matching
  `fanOutBroadcasts` / `emitCharacterUpdate` discipline.

### References
- `packages/server/src/utils/encounter-hp-log.ts`
- `packages/server/src/services/character-live-state/encounter-attribution.ts`
- `packages/server/src/services/rest-encounter-attribution.ts`
- `docs/agent_notes/finished_work/ux-audit-2026-06-p0.md` (HP-attribution P0 shipped; pack closed 2026-06-21)
- `docs/CONCURRENCY.md` — §Scope (append-only non-candidates), Pattern A.
