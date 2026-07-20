# Concurrency patterns

Three patterns cover every concurrency-sensitive write in this codebase.
When adding a new mutation, first confirm it actually needs gating (see
§Scope below), then pick the pattern that matches — don't invent a
fourth. See §"Alternatives considered" at the end for why CAS was
chosen over `pg_advisory_xact_lock` or Serializable-everywhere.

The stable architectural decision and its enforcing gates are recorded in
`docs/adr/0001-race-sensitive-writes.md` (ADR-0001).

## Scope — when a gate is worth adding

Pattern A/B/C were added preemptively on architectural-review advice,
not in response to reported bugs. Before extending the gate to a new
table, clear all three bars:

1. **Multiple real-world writers on the same row.** Not "two tabs open
   in theory" — actual usage patterns where two actors produce
   interleaved writes. A player editing their own character is a
   single-writer path.
2. **Lost updates produce user-visible wrong state.** Not "the row
   ends up in a slightly different order than expected" — the user
   must be able to see something is wrong.
3. **The user can't trivially recover.** In a turn-based game with a
   human DM and players watching the screen together, most mismatches
   are caught within seconds and fixed by typing the right value. CAS
   buys nothing when the recovery is "click it again."

**Not candidates, even when they technically could race:**

- **Set-semantics tables** (`CharacterCondition`) — concurrent writes
  commute or are idempotent.
- **Last-write-wins UX** (`MapToken` drag position, action-economy
  flags on `EncounterParticipant`) — CAS would reject legitimate
  concurrent writes and hurt interactive feel. The socket broadcast
  re-syncs everyone.
- **Single-writer paths** (`CharacterSpell` list, most personality
  fields) — no contention to resolve.
- **Append-only logs** (`CombatLog`, `ChatMessage`) — no updates to
  race on.

**New gates need a reported bug from a real session, not a theoretical
race argument.** For this app's usage pattern — turn-based combat,
small player counts, human-in-the-loop recovery — the cost of the
existing machinery is already high relative to realized benefit, and
§"Alternatives considered" acknowledges that the current design may
eventually be worth simplifying. An AI review pattern-matching on
"could this race?" is not sufficient grounds to extend the surface.

## Pattern A — version-CAS via a locked helper

**Applies to:** `CharacterStats` (HP, sorcery points, ability scores,
death saves, exhaustion, concentration) and `EncounterParticipant`
(monster HP on the combat hot path). PCs store HP on `CharacterStats`;
monsters store HP inline on `EncounterParticipant`.

**The rule:** writes go through a locked helper that takes a mutator
callback:

- `updateCharacterStatsLocked(tx, characterId, mutator)` in
  `utils/character-stats-mutations.ts`
- `updateParticipantStatsLocked(tx, participantId, mutator)` in
  `utils/participant-stats-mutations.ts`

The helper reads the row fresh inside the tx, hands it to the mutator,
and writes via `updateMany({where:{id, version}, data:{..., version:
{increment:1}}})`. A concurrent committer causes `CONFLICT` instead of
a lost update.

Attack and spell damage share `applyDamageLocked` in
`utils/damage-mutations.ts`. Callers retain their attack/spell eligibility
guards, then pass the transaction, target participant/character identity, and
already-computed damage; the helper routes through the appropriate locked
Pattern A mutator.

```ts
await updateCharacterStatsLocked(tx, characterId, (stats) => {
  const hp = applyHpAdjustment({
    mode: "damage",
    amount: damageRolled,
    currentHp: stats.currentHp,  // fresh, read inside the helper
    maxHp: stats.maxHp,
    tempHp: stats.tempHp,
  });
  return { currentHp: hp.currentHp, tempHp: hp.tempHp };
});
```

**Type-level enforcement.** `utils/prisma-types.ts` marks `.update` /
`.updateMany` / `.upsert` as `never` on the restricted delegate types,
so direct calls fail to compile. See the negative type tests in
`utils/__type-tests__/`.

**Blind sets on `EncounterParticipant`.** Absolute-value writes to
non-racing metadata (`initiative`, `sortOrder`, action flags, `name`,
`initiativeModifier`, `isVisible`) go through `blindUpdateParticipant`.
Its `BlindParticipantFields` input type is a narrow `Pick<...>` that
**excludes** `currentHp`, `tempHp`, `version`, `conditions`, and
identity fields. The narrowing is load-bearing: `conditions` is
read-modify-write in `services/combat-actions/turn-transaction.ts` (the
C2 fix), and widening `BlindParticipantFields` would silently reintroduce
the `advanceTurn` conditions race.

**Turn-origin columns are non-racing.** `turnStartX`, `turnStartY`,
`turnStartMapId`, and `turnStartRound` have exactly three writer classes,
all in `utils/participant-stats-mutations.ts`:

1. `services/combat-actions/turn-origin.ts::captureTurnOrigin` (via
   `setParticipantTurnOrigin`) inside the already-CAS'd activation and
   advance-turn transactions (`setEncounterState` / `advanceTurnCompound`
   serialize the capture side against other captures).
2. `clearParticipantTurnOrigin`, the fail-closed all-null invalidation
   that every token↔participant link mutation
   (`encounterMap.link/unlink/autoLinkTokens`, `mapToken.create` with a
   participant, `mapToken.delete` of a linked token) runs in the same
   transaction as the link write — required because the projection's
   visibility gate reads the *currently linked* token while the origin
   was captured from the token linked at turn start.
3. `clearTurnOriginsForParticipants`, the tolerant batch clear that the
   two cascade deleters (`map.delete`, whose map cascade removes every
   token on the map, and `deleteCharacterWithCascade`, whose character
   cascade removes tokens possibly cross-linked to surviving
   participants) run in the same transaction as the delete.

All writers set the whole four-column set atomically and none bumps
`version`, so capture/clear stays invisible to concurrent CAS-protected
DM edits. They are kept out of `BlindParticipantFields` on purpose — the
blind whitelist stays a deliberate list of DM-adjacent metadata, and any
further writer for these columns would be a reviewable decision.

**Capture/clear serialization protocol.** A capture that read the link
with a plain `include` could race a link mutation: read hidden token H's
position, lose to the relink tx (which clears the origin), then land H's
coordinates with a fresh round stamp — re-leaking a hidden position
through the projection once a visible token is linked. Because every
link mutation's clear UPDATEs the participant row inside the same
transaction as its link write, the participant row itself is the
mutual-exclusion channel, and `captureTurnOrigin` uses it lock-by-write:
it clears the origin FIRST (acquiring the row lock through the
sanctioned helper — Pattern A's write-based serialization without the
version bump), then reads the link on a fresh statement snapshot, then
writes the origin from that read. A relink that committed before the
lock is visible to the read; one still in flight has its clear queued
behind the lock, so the all-null clear lands last. Either order leaves
the origin coherent with the committed link state. (`SELECT FOR UPDATE`
stays out per §Don't use; the lock-by-write shape keeps the rule inside
the mutation helpers.) The link mutations' own side is Pattern C: each
resolves the token's current link *inside* its transaction and re-checks
it in the compound `updateMany`/`deleteMany` WHERE
(`{id, encounterParticipantId: <value just read>}`), surfacing
`CONFLICT` instead of clearing a stale "previous" participant
(`autoLinkTokens` skips instead of conflicting — best-effort semantics).
Both `captureTurnOrigin` and `executeAdvanceTurnTx` resolve "the
participant at turn index N" with the shared `PARTICIPANT_ORDER`
tie-break so duplicate `sortOrder` values cannot make the tick, the
capture, and the projection disagree on the row.

**Known pre-existing edge: cross-steal relink deadlock (assessed
2026-07-19, out of turn-origin scope).** Two concurrent steal-style
relinks that swap two participants' tokens (T1: token A→P_B, T2: token
B→P_A, starting from A↔P_A / B↔P_B) deadlock on the
`MapToken.encounterParticipantId` `@unique` index: each UPDATE removes
one unique value uncommitted and then waits on the other transaction's
uncommitted removal of the value it inserts, so Postgres's detector
aborts one side (`40P01`, surfaced by Prisma and reaching the client as
`INTERNAL_SERVER_ERROR` rather than `CONFLICT`). This cycle is not a
product of the turn-origin work: before it, the link path was a bare
autocommit `mapToken.update` overwrite against the same `@unique`
(`routers/encounter-map.ts` at `56d74ba3`; the constraint predates the
branch), and two such single-statement transactions form the identical
wait cycle at the same two statements. The in-tx CAS added since blocks
at that same token write — *before* any origin clear runs in this
interleaving — so the sorted-id clear order cannot and need not prevent
it (it prevents the different, branch-introduced participant-row clear
cycle). Consequences are benign: the aborted side is an interactive
transaction that rolls back completely (token write and origin clears
all revert — no partial state, no origin disclosure), the surviving
swap commits coherently with its clears, and recovery is "click
again". Per §Scope, no retry or extra lock-ordering machinery until a
real session reports it.

**Ruling: residual origin-without-token window (accepted, 2026-07-19).**
The cascade paths cannot be made fully airtight without gating token
reads: a link + capture interleaving with a concurrent `map.delete` /
character delete can leave a participant holding a fresh-round origin
while its token is gone (the deleter's in-tx sweep read predates the
late link). This state is **non-disclosing by construction**: the
projection (`resolveActiveTurnOrigin`) returns `null` for non-DM viewers
unless the participant has a *currently linked* visible token, and every
path that would give the participant a new token is a link mutation that
clears the origin first — so stale coordinates can never pair with a
visible token. The residue is DM-only, self-healing, and per §Scope
(gates grow on reported bugs, not theoretical races) carries no further
machinery.

**Action-economy flags are intentionally last-writer-wins.**
`actionUsed`, `bonusActionUsed`, and `reactionUsed` are blind-written
by both the DM toggle path (`encounter.updateParticipant`) and
`advanceTurn`'s turn-start reset. A race means the DM's toggle is
lost and they click again. This is acceptable for a tabletop RPG:
the consequence is cosmetic, the DM is already looking at the
tracker, and the fix (click again) is instant.

## Pattern B — counter-as-CAS

**Applies to:** `CharacterSpellSlot.used` (via `consumeSpellSlot` and
`recoverSpellSlot`) and `CharacterClass.level` / `.hitDiceUsed` /
`.subclassId` (via `advanceClassLevel`, `spendHitDice`, `setSubclass`). All
are monotonic-ish counters where the counter itself serves as the
optimistic-lock key. `convertSlotToPoints` calls `consumeSpellSlot`, but the
conversion also writes `CharacterStats`, so it is a cross-table writer listed
below rather than a single-table Pattern B path.

**The rule:** writes go through helpers in
`utils/spell-slot-mutations.ts` and `utils/character-class-mutations.ts`.
The helpers use `updateMany({where:{id, <counter>: previousValue}, data:
{<counter>: newValue}})`. If a concurrent writer advanced the counter
between the caller's read and this write, the `updateMany` affects zero
rows and throws `CONFLICT`.

Non-racing variants (long-rest `resetAllSpellSlots` / `resetAllHitDice`)
skip the CAS because they're idempotent resets.

**Why not Pattern A?** Different tables, different row identities. The
shape is similar but the fields racing are different; consolidating
would conflate unrelated models.

## Pattern C — compound `updateMany` with the precondition in `where`

**Applies to:** `Encounter` `advanceTurn`, state-machine transitions
(setup → active, active ↔ paused, → resolved), `currentTurnIndex`
shifts from outside `advanceTurn`, and metadata writes. It also applies to a
standalone atomic claim such as `CampaignInvite` acceptance: the
`usesRemaining > 0` precondition belongs in the same `updateMany` `where`, and
zero affected rows maps to `CONFLICT` rather than allowing two acceptors to
consume the final use.

**The rule:** writes go through helpers in
`utils/encounter-state-mutations.ts`. Every field checked in JS is also
checked in the `updateMany` WHERE so two concurrent advances can't
both pass the JS guard and both clobber. Helpers:

A compound claim whose complete precondition fits in one statement does not
need a new gated-delegate helper surface; its focused invariant test is the
deterministic gate.

- `advanceTurnCompound` — canonical Pattern C; CAS on `previousRound`
  and `previousTurnIndex`. Returns row count so the caller can pick
  between `BAD_REQUEST` (encounter no longer active) and `CONFLICT`
  (turn already advanced).
- `setEncounterState(client, id, from, to, extra?)` — state-machine
  transitions with `from` in the WHERE; invalid transition → `CONFLICT`.
- `setCurrentTurnIndex(client, id, fromIndex, toIndex)` — shifts the
  turn index from outside `advanceTurn` (character-delete,
  participant-reindex) with compound-WHERE protection.
- `updateEncounterMeta` — non-racing metadata; no CAS.

**Why compound instead of a version column?** Encounter transitions
check multiple correlated fields (`state`, `currentTurnIndex`, `round`).
A single version CAS works but doesn't give you "the turn already
advanced" vs "the encounter was paused" semantics for free.

## Cross-table invariants

Most transactions write exactly one race-sensitive table. The ones that
don't follow a **canonical lock order** so concurrent multi-table
writers can't acquire rows in opposite directions and deadlock:

> **`CharacterStats` → `CharacterClass` → `CharacterSpellSlot` → `EncounterParticipant`**

### Cross-table writers

**1. `routers/encounter.ts:updateParticipant` (DM override)** — writes
`CharacterStats` + `EncounterParticipant` when the DM overrides a
character participant. Row identities: `Stats(X) + EP(P_X)` where
`P_X.characterId = X`. Lock order: **Stats → EP** (canonical).

**2. `services/spell-casting/combat-transaction.ts:executeCombatSpellTransaction`**
— writes `EncounterParticipant` + `CharacterSpellSlot` + `CharacterStats`
when a PC casts a concentration damage spell at a monster (case 3b
below). Row identities: `EP(M)` (monster) + `CSS(C) + Stats(C)` (caster).
Caster-row order: **Stats(C) → CSS(C)** (canonical). The `EP(M)` lock
is acquired first but `M` is a monster participant whose row identity
is disjoint from every other multi-table writer, so its early
acquisition can't interleave. The combat path delegates the concentration+slot
sequence to the internal helper `concentrateAndConsumeSlot` in
`services/spell-casting/combat-transaction.ts`, which enforces
*replaceConcentration before consumeSpellSlot*. The independent non-combat
sequence is path 8 below and preserves the same relative order. Flipping
either path would put `CSS → Stats` (reverse of rest-service) and deadlock
with a concurrent rest on the same character.

**3. `services/rest-service.ts:executeShortRest`** — writes
`CharacterStats` + `CharacterClass`. Implemented as a two-pass
structure: `planHitDiceSpend` rolls dice without writing, then pass 2
commits `Stats` first (HP gain), `CharacterClass` second (dice spent).
Canonical.

**4. `services/rest-service.ts:runLongRestTransaction`** — writes
`CharacterStats` + `CharacterClass` + `CharacterSpellSlot`. Lock order:
**Stats → CC → CSS** (canonical). Wrapped in Serializable isolation
for reasons unrelated to lock order (see below).

**5. `services/level-up/apply-level-up.ts:applyLevelUp`** — writes
`CharacterStats` + `CharacterClass` + `CharacterSpellSlot`. Row identities:
`Stats(X) + CC(X,K) + CSS(X,1..9)`, where `K` is the class being advanced or
created. Lock order: **Stats → CC → CSS** (canonical). Sorcerer level-up and
subclass work may revisit the already-acquired `Stats(X)` or `CC(X,K)` row;
those same-transaction writes do not reverse the acquisition order.

**6. `services/character-live-state/sorcery-point.ts:convertSlotToPoints`**
— writes `CharacterStats` + `CharacterSpellSlot`. Row identities:
`Stats(X) + CSS(X,L)`, where `L` is the converted slot level. Lock order:
**Stats → CSS** (canonical).

**7. `services/character-live-state/sorcery-point.ts:createSlotFromPoints`**
— writes `CharacterStats` + `CharacterSpellSlot`. Row identities:
`Stats(X) + CSS(X,L)`, where `L` is the created slot level. Lock order:
**Stats → CSS** (canonical).

**8. `services/spell-casting/non-combat-cast.ts:applyLeveledCast`** — every
leveled non-combat cast writes `CharacterSpellSlot`; concentration or
metamagic also writes `CharacterStats`. In those multi-table cases, row
identities are `Stats(C) + CSS(C,L)`, where `L` is the cast slot level.
`applyMetamagicCost` and/or `replaceConcentration` run before
`consumeSpellSlot`, so lock order is **Stats → CSS** (canonical). Concentration
cantrips and rituals write only `Stats` and are not cross-table writers.

### No deadlock between these paths

- **1 vs 2:** At most `Stats` is shared. Path 1's `EP(P_X)` is a
  character participant; path 2's `EP(M)` is a monster participant;
  by schema (`characterId XOR monsterId`), these are distinct rows.
  Single shared row can't deadlock.
- **1 vs 3–8:** Paths 3–8 don't touch `EP`; path 1 doesn't touch
  `CC`/`CSS`. At most `Stats` is shared.
- **2/6/7/8 pairwise:** Shared caster rows are acquired in the canonical
  **Stats → CSS** order. Path 2's early monster-only `EP(M)` acquisition is
  disjoint from paths 6–8.
- **2/6/7/8 vs 3:** At most `Stats` is shared because short rest doesn't touch
  `CSS`.
- **2/6/7/8 vs 4/5:** Shared rows are `Stats` and `CSS`, acquired in the
  canonical **Stats → CSS** order.
- **3 vs 4/5:** Shared rows are `Stats` and `CC`, acquired in the canonical
  **Stats → CC** order.
- **4 vs 5:** All three row families can be shared, and both paths acquire
  them in the canonical **Stats → CC → CSS** order.

### Spell-cast cases

| case | target | conc spell | writes |
|---|---|---|---|
| 1 | PC | no | `Stats(T damage)` [+ `Stats(T conc check)` if concentrating] [+ `CSS(C)`] |
| 2 | PC | yes | case 1 + `Stats(C conc replace)` |
| 3a | monster | no | `EP(M)` [+ `CSS(C)`] |
| 3b | monster | yes | `EP(M)` + `Stats(C conc replace)` + `CSS(C)` |

Case 2 writes `Stats` on two different rows (target and caster).
Concurrent case-2 casts with swapped roles (A → B, B → A) are
prevented by `assertTurnInsideTx` serializing non-DM casts; a DM
bypassing that with two mutually-targeted casts in parallel is a
theoretical deadlock Postgres catches via `40P01`.

### Adding a new cross-table writer

1. Acquire rows in the canonical order above, OR prove via row-identity
   disjointness that shared rows with every existing writer are either
   single-row or acquired in the same relative order.
2. Update the writer list above.
3. Consider whether a compound `$transaction` is actually needed — a
   two-tx version (write table A, commit, then write table B) avoids
   the cross-table concern at the cost of a brief inconsistency window.

## Serializable isolation exception

`executeLongRest` is the only path that uses Serializable. The reason:
`syncSpellSlots` is a multi-statement read-modify-write keyed off the
character's class list. A concurrent `character.levelUp` committing
between long-rest's in-tx class `findMany` and its `syncSpellSlots`
loop would delete a freshly-granted slot row (e.g., wizard 5 → 7
losing the level-4 slot). Serializable detects the read/write
anti-dependency and aborts one tx with `serialization_failure`, which
Prisma raises as `PrismaClientKnownRequestError` code **P2034**.
`executeLongRest` catches it, retries up to `LONG_REST_MAX_RETRIES`
times, and surfaces `CONFLICT` on final failure.

Every other path uses READ COMMITTED + targeted CAS. Long-rest's
multi-statement cross-table shape is unique enough to justify the
heavier isolation.

## Alternatives considered

The branch picked Pattern A/B/C + type-level enforcement early and
didn't benchmark the alternatives. Reviewers have rightly pointed out
that for this workload (turn-serialized combat, low contention
windows, small player counts) both of these would also work:

- **`pg_advisory_xact_lock` at tx start.** One line per tx, keyed on
  `characterId` or `encounterId`, covers the same races with no
  version columns, no mutation helpers, no per-table shims.
  Downside: "last writer wins" semantics after the lock releases —
  a DM override racing a screen-read window silently clobbers
  concurrent attacks instead of surfacing `CONFLICT`, which matters
  if the client forwards the conflict to the user. Also: the lock
  discipline isn't enforceable at the type level, so a future dev
  can add a mutation path that forgets to acquire the lock.
- **Serializable isolation as the default + retry loop.** Postgres
  SSI detects read/write anti-dependencies and aborts one of two
  racing txs with P2034. At this app's concurrency level the abort
  rate is almost certainly negligible. Downside: every mutation
  needs retry plumbing, and retries change the mental model of
  "what state did my read see."

Pattern A/B/C wins on non-blocking reads, fine-grained contention,
and explicit `CONFLICT` surfacing at the point of race. It pays for
that with cognitive load (three patterns, restricted delegate types,
lock-order reasoning). For a low-contention workload the tradeoff is
debatable.

**If a future audit concludes the cognitive load isn't paying for
itself**, migrating to advisory locks is mechanically feasible: the
mutation helpers already centralize every writer, so the blast radius
is contained to the ~5 files in `utils/*-mutations.ts`.

## Don't use

- **`SELECT FOR UPDATE`** — Prisma doesn't expose it cleanly.
- **Schema-level triggers or Prisma middleware** — considered and
  rejected; explicit helpers make the rule visible at call sites
  where developers are already thinking about concurrency.

## Testing

Concurrency tests use the **state-consistency invariant** pattern:

```ts
expect(finalHp).toBe(initialHp - successes * damage);
expect(round).toBe(1 + successes);
expect(hitDiceUsed).toBe(successes * hitDiceToSpend);
```

This catches lost updates regardless of whether Fastify serializes or
interleaves concurrent requests.

`[200, 409]` shape assertions only hold when the client sends a
CAS token in the payload. `character.updateStats` requires a
client-supplied `expectedVersion` (the `CharacterStats.version` the
client saw when the user decided to submit), and the helper
`updateCharacterStatsLockedWithExpectedVersion` rejects stale versions
with `CONFLICT` **before** applying the mutator. Cross-session
stale-read-then-blind-write is closed for the sheet-edit UI paths
(`AbilityScores`, `DeathSavesInteractive`, `CombatStats` inspiration).

`encounter.updateParticipant` routes requests through two paths based
on a **whitelist** of non-racing fields:

- **CAS path** (`expectedVersion` present): uses
  `updateParticipantStatsLockedWithExpectedVersion` (+ optional
  `expectedStatsVersion` for character HP/death saves). Used for
  racing fields: `currentHp`, `tempHp`, `conditions`, death saves.
- **Blind path** (`expectedVersion` omitted): uses
  `blindUpdateParticipant` directly. Used for non-racing metadata:
  `actionUsed`, `bonusActionUsed`, `reactionUsed`, `isVisible`,
  `name`, `initiative`, `sortOrder`, `initiativeModifier`. Does NOT
  increment `version`, so toggle clicks can't invalidate concurrent
  CAS-protected operations.

Field classification lives in the `PARTICIPANT_FIELD_KIND` map in
`routers/encounter.ts`, declared `as const satisfies
Record<keyof UpdateParticipantInput, "racing" | "non-racing">`. The
`satisfies` clause makes the map **exhaustive**: every field on the
update input must carry a `"racing"` / `"non-racing"` entry or the build
fails. `assertVersionForRacingFields` then throws `BAD_REQUEST` when any
`"racing"` field (`currentHp`, `tempHp`, `conditions`, death saves) is
written without `expectedVersion`. So new schema fields do *not* silently
default to CAS-protected — they fail to compile until explicitly
classified, which is the stronger, fail-closed guarantee: you cannot add
a participant field without consciously deciding whether it races.

The client sends `expectedVersion` for HP, conditions, and death-save
payloads, and omits it for action toggles and visibility toggles.

Other procedures that compute their writes from `freshStats` inside
the mutator (`character.adjustHp`, rest, level-up non-ASI, spell-action,
etc.) use the original `updateCharacterStatsLocked` and do not need a
client-supplied version — their intra-tx read-then-CAS already makes
stale-snapshot writes impossible because the mutator never sees a
pre-transaction snapshot. Tests for those procedures use the
state-consistency invariant instead of the `[200, 409]` shape.

See `routers/character-stats-concurrency.test.ts`,
`routers/encounter-combat-concurrency.test.ts`, and
`routers/sorcery-point.test.ts` for examples.
