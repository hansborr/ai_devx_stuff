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
  fields) — no contention to resolve. Note that "not a gate candidate"
  is about the *row*: the prepared-spell **cap** across those rows is a
  set-level invariant, and the one path that can race against it
  (`characterSpell.togglePrepared`) holds it in a Serializable
  transaction instead of gating the delegate. That is a per-path
  guarantee, not a global one — see §"Serializable isolation
  exception".
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

Single-target attack damage routes through `applyDamageLocked` in
`utils/damage-mutations.ts`. Structured spell damage calls the same two
Pattern A mutators directly so its combined caster/damaged-character pass can
preserve the multi-row ordering documented below.

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

**Type-level enforcement.** `utils/prisma-types.ts` re-declares `.update` /
`.updateMany` / `.updateManyAndReturn` / `.upsert` as `ConcurrencyGatedWrite`
on the restricted delegate types, so direct calls fail to compile. That type
has no call signature *and* is not assignable to Prisma's real method type,
which is the load-bearing half: ordinary structural widening and forwarding
into a raw-typed binding fail. (The methods used to be `never`, which is
assignable to everything — `const raw: Prisma.TransactionClient = tx` handed
back every banned method with no lint hit.) `DbClient` also omits the
raw-returning `$extends`, and `TxClient` makes nested `$transaction`
non-callable. Each owning `utils/*-mutations.ts` file contains the sanctioned
marked `RawTxClient` cast, but its `rawWrites` return is scoped to that file's
single delegate.

This is a compile-time guard, not a runtime wrapper or a proof against every
TypeScript lie. A user-defined predicate over a restricted/raw union, or an
assertion function that narrows to their intersection, can recover the runtime
methods without an `as` expression; `local/type-assertion-boundary` does not
inspect those return-type annotations.

**Nested relation writes** — `tx.character.update({ data: { stats: { update:
… } } })` — are outside the restricted-delegate surface *by construction*, and
no type change can close them cheaply: the write goes through the generated
`Prisma.CharacterUpdateInput`, which carries its own `update`/`updateMany`/
`upsert` members and has no seam to intercept per parent model. They are
covered instead by the nested branch of `local/concurrency-guard`, which
flags a gated relation key whose payload contains a gated mutator. That
branch is the **only** enforcement on this path, and it is defense in depth
rather than closure: a name-matching lint, not a type gate. It fires only
inside a *resolved Prisma mutation argument* — a `update`/`updateMany`/
`updateManyAndReturn`/`upsert` call on a `<client>.<model>` receiver whose
argument object carries `where` — so an unrelated `{ stats: { update: … } }`
object is not a lint error, and it follows a one-hop `const` binding for the
argument, the relation envelope and the mutator value, but a payload assembled
through a helper call or spread will not be caught. Unlike the direct branch it
stays live inside `utils/*-mutations.ts`: those files are trusted for their own
table, and a nested write reaches a different one.

Its relation table is keyed `<parent model>.<relation field>` and derived from
`schema.prisma` by
`scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts`, so a new
relation to a gated model fails the guard instead of silently widening the
escape. The parent qualification is load-bearing, not tidiness: relation names
are not unique across models and not even unique to relations — `classes` is a
`CharacterClass[]` relation on `Character` and a `Json` scalar on `Spell` — so
matching the key alone made `spell.update({ data: { classes: { update: … } } })`
a hard error, and made any non-Prisma `.update({ where, … })` receiver one too.
The cost is that a gated relation reached through a *non-gated* relation
envelope (two hops, e.g. `campaign.update` → `members` → `character` →
`stats`) drops the parent model and is not flagged; the walk carries the model
across payload envelopes (`data`, `update`, …) and across gated relations, and
stops guessing when it loses it. Nested `create` stays out of scope — that is
ordinary character creation.

Type closure versus a lint is not the whole option space, and this section used
to read as if it were. A Prisma `$extends({ query: { $allModels: … } })` guard
installed in `prisma/client.ts` would inspect the payload that actually reaches
the driver, which makes it *unescapable by payload construction* — strictly
stronger than the lint, and far cheaper than intercepting the generated
update-input types. It is a runtime change on every write in the process, so it
is tracked separately in
`docs/agent_notes/backlog/code-quality-2026-07-25/60-nested-write-runtime-guard.md`
rather than assumed away.

Prisma's raw-SQL entry points (`$executeRaw`, `$executeRawUnsafe`,
`$queryRaw`, `$queryRawUnsafe`) also sit outside delegate typing and can update
gated tables without a cast or marker; the separate `raw-prisma-sql` lint fence
limits them to sanctioned server boundaries but does not make this type gate
exhaustive. See the negative type tests in `utils/__type-tests__/`, in particular
`raw-client-widening-restrictions.ts`.

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
— structured spell casts first acquire the encounter turn gate. They then
form the union of every positively damaged character ID and the caster
character ID, deduplicate it, sort it by code point, and visit that list
exactly once through `updateCharacterStatsLocked`. The caster's concentration
replacement and damage (when overlapped) share that first locked update; a
caster with no other stats change receives the sanctioned version-bump no-op.
Each damaged character's concentration check completes before the pass moves
on. The cast then acquires `CharacterSpellSlot` once (leveled spells only),
followed by positively damaged non-character `EncounterParticipant` rows in
code-point participant-ID order. Lock order is therefore **Encounter gate →
sorted Stats union → CSS → sorted EP**. Later writes to a stats row already
held by its concentration check are not new lock acquisitions.

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

- **1 vs 2:** Both acquire any shared `Stats` row before `EP`; path 2 also
  sorts every multi-row family by code point.
- **1 vs 3–8:** Paths 3–8 don't touch `EP`; path 1 doesn't touch
  `CC`/`CSS`. At most `Stats` is shared.
- **2/6/7/8 pairwise:** Shared caster rows are acquired in the canonical
  **Stats → CSS** order. Path 2 does not acquire monster `EP` rows until both
  families have completed.
- **2/6/7/8 vs 3:** At most `Stats` is shared because short rest doesn't touch
  `CSS`.
- **2/6/7/8 vs 4/5:** Shared rows are `Stats` and `CSS`, acquired in the
  canonical **Stats → CSS** order.
- **3 vs 4/5:** Shared rows are `Stats` and `CC`, acquired in the canonical
  **Stats → CC** order.
- **4 vs 5:** All three row families can be shared, and both paths acquire
  them in the canonical **Stats → CC → CSS** order.

### Structured spell-cast row proof

Two casts sharing character rows cannot each hold a higher/lower row while
waiting for the other: both attempt the same smallest shared character ID
first. Caster/target role swaps do not change the sequence because caster and
targets are merged before any stats CAS. Separate encounters may bypass a
shared encounter gate, but retain that same row order. Two areas sharing
monster rows likewise acquire participant IDs in the same order. Rest,
level-up, sorcery conversion, and non-combat casting continue to observe
`Stats → CharacterClass → CSS`; DM overrides observe `Stats → EP`.

### Adding a new cross-table writer

1. Acquire rows in the canonical order above, OR prove via row-identity
   disjointness that shared rows with every existing writer are either
   single-row or acquired in the same relative order.
2. Update the writer list above.
3. Consider whether a compound `$transaction` is actually needed — a
   two-tx version (write table A, commit, then write table B) avoids
   the cross-table concern at the cost of a brief inconsistency window.

## Serializable isolation exception

Two paths use Serializable. Both are multi-statement read-modify-writes
keyed off a **set** of rows rather than a single row, which is the one
shape Pattern A/B/C cannot express: there is nothing to put in a
compound `where`, because the precondition is a property of sibling
rows the statement does not name.

**1. `executeLongRest`.** `syncSpellSlots` is a multi-statement
read-modify-write keyed off the character's class list. A concurrent
`character.levelUp` committing between long-rest's in-tx class
`findMany` and its `syncSpellSlots` loop would delete a freshly-granted
slot row (e.g., wizard 5 → 7 losing the level-4 slot). It retries up to
`LONG_REST_MAX_RETRIES` times and surfaces `CONFLICT` on final failure.

**What stops that here is not SSI.** Postgres tracks read/write
anti-dependencies only *between serializable transactions*, and
`performLevelUp` opens an ordinary `$transaction` with no
`isolationLevel` (`services/level-up/level-up.ts`), so it runs at the
connection default — READ COMMITTED. A serializable transaction gets no
anti-dependency detection against it at all. What protects long rest is
**first-updater-wins**: long rest does not merely *read* the
`CharacterClass` rows level-up writes, it writes them too
(`resetAllHitDice`, before `syncSpellSlots` runs), and a
repeatable-read-or-stricter transaction that updates a row committed
after its snapshot aborts with `40001` regardless of the other side's
isolation level. Both halves — the missing detection and the abort that
does happen — are pinned by
`utils/serializable-isolation.test.ts`. That abort is raised by the
*statement*, so it reaches Prisma as **P2034**; see "Detecting the
abort" below for why the other shape exists.

This is also why long rest's retry loop retries immediately while the
prepared toggle's backs off (`rest-service.ts` vs
`prepared-spell-toggle.ts`): first-updater-wins can only fire once the
conflicting writer has *already committed*, so the retry re-reads
settled state instead of re-colliding with a peer that restarts at the
same instant. That reasoning covers the abort long rest is known to
take. It does *not* cover a true SSI abort between long rest and the
prepared toggle — the only two serializable paths, and therefore the only
pair SSI can see — where the losers can restart together. Long rest
writes `CharacterStats` and `CharacterClass`, which the toggle reads, so
that edge exists; nobody has observed the abort. If long rest ever starts
surfacing `CONFLICT` in practice, give it the toggle's jittered
`backoff()` rather than raising `LONG_REST_MAX_RETRIES`.

**2. `togglePreparedWithRetry`** (`utils/prepared-spell-toggle.ts`),
behind `characterSpell.togglePrepared`. The router used to count the
prepared non-cantrip `CharacterSpell` rows and then update with nothing
between the statements, so two concurrent prepares both read
`maxPrepared - 1`, both passed the guard, and the toggle path itself
pushed the character over the limit. SSI closes it because each
transaction's `prepared = true` write falls inside the predicate the
other one counted. The flip is derived from the row *inside* the
transaction, so a retry re-decides against the winner's committed state
instead of re-asserting a stale desired value. `CharacterSpell` stays
out of the gated delegate set: the fix is transaction-local, and a gate
with one guarded caller and a dozen ordinary writers is worse than none.

**What this establishes, precisely.** The guarantee is about the write
path, not about the table: *`togglePrepared` never raises a character's
prepared count above its cap, however many prepares run concurrently.*
It is **not** the global claim "a character is never over its prepared
cap". Character creation already breaks that one without any
concurrency — `services/character-create-spells.ts` marks every chosen
level-1 spell `prepared: true`, and a level-1 wizard chooses six against
a cap of four (`shared/rules/spellcasting.ts`). That is a missing rule
check at creation, not a lost update, so no locking discipline fixes it:
a per-character row or advisory lock shared by every writer would
serialise them without adding the check creation never makes. Closing
the global cap means giving creation the same cap check (and deciding
what a level-1 wizard's sixth spell means) — a rules change, tracked
separately from this isolation-level one. Until then, do not cite this
section as evidence that the cap holds globally.

**Why Serializable and not a per-character lock.** The creation gap
above is *not* the reason, and an earlier revision of this section
wrongly used it as one. It defeats the claim that a lock delivers the
global invariant, but Serializable does not deliver that invariant
either — SSI adds no check to creation any more than a lock does. On the
narrower question this section is actually about, *toggle versus
toggle*, a `pg_advisory_xact_lock(characterId)` under READ COMMITTED
would close the race just as completely, and with no retry loop, no
jitter and no two-shape error predicate. The reasons that discriminate
are these:

- **No raw SQL.** Advisory locks have no Prisma API; they need
  `$queryRaw`/`$executeRaw`, which the `raw-prisma-sql` restricted-syntax
  fence confines to sanctioned server boundaries
  (`eslint-config/restricted-syntax-policy.js`). Serializable is a
  `$transaction` option.
- **No fourth pattern, and no new lock order.** A `Character`-scoped lock
  would have to be threaded into the canonical acquisition order in
  §"Cross-table invariants" and honoured by long rest and level-up
  forever after — a repo-wide, permanently-remembered obligation for one
  path's fix. Serializable is transaction-local and reuses the exception
  this section already sanctions, along with its error predicate.
- **Against, honestly:** Serializable turns a contended-but-correct
  workload into abort-plus-retry. It aborts on *any* concurrent prepare
  for the character, not only at the cap boundary, and the sheet fires an
  optimistic mutation per click — so the retry loop runs in ordinary use,
  on a finite budget, with a user-visible `CONFLICT` past it. A lock
  would serialise the same writers once, with no wasted work. That cost
  is accepted because the contention is a handful of clicks on one
  character, not because it is zero.

Serializable aborts on *any* concurrent prepare for the character, not
only at the cap boundary, so this path retries with jittered backoff
(`MAX_ATTEMPTS`). A retried attempt re-counts against the winner's
committed state, so away from the boundary it succeeds and at the
boundary it returns the ordinary `BAD_REQUEST "Cannot prepare more than
N spells"` — the same error a sequential caller would have seen.
`CONFLICT` is only reachable once the budget is spent.

**Detecting the abort.** Postgres reports `serialization_failure` as
SQLSTATE `40001`, and under the `@prisma/adapter-pg` driver adapter it
arrives in one of two shapes depending on when it is raised. A statement
that fails inside the transaction is mapped normally and surfaces as
`PrismaClientKnownRequestError` **P2034**. An abort raised by the
`COMMIT` of an *interactive* `$transaction` is not: that path re-rejects
the adapter's own `DriverAdapterError` verbatim — `cause.kind` is
`TransactionWriteConflict`, and there is no `code` for the client to
recode from.

Both shapes occur, and which one you get is a property of the race, not
of the path. Measured on the prepared-toggle race (four racers held at a
barrier until all had counted), 17 of 18 aborts arrived as the unmapped
`DriverAdapterError` and 1 as P2034 — a loser whose `UPDATE` happened to
run after the winner had already committed aborts at the statement.
Long rest's abort against a level-up is first-updater-wins, which is
always raised by the statement and is therefore always P2034. So neither
branch of the predicate is dead, and neither path observes only one
shape. `isPrismaSerializationFailure` in `utils/prisma-errors.ts` matches
both and is the only place that knowledge lives; a retry loop that checks
P2034 alone compiles, passes a mocked unit test, and then silently never
retries the commit-time half in production.
`utils/serializable-isolation.test.ts` pins both shapes against the real
driver by choreographing each abort, rather than racing and hoping — the
unit tests in `prisma-errors.test.ts` synthesise the adapter's shape, so
an upstream rename would leave them green while production stopped
retrying.

Every other path uses READ COMMITTED + targeted CAS. Reach for
Serializable only when the invariant is genuinely set-level; a
single-row precondition belongs in a compound `where`.

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
  racing txs (as P2034 or as the adapter's unmapped conflict — see
  "Detecting the abort" above). At this app's concurrency level the
  abort rate is almost certainly negligible. Downside: every mutation
  needs retry plumbing, retries change the mental model of "what state
  did my read see", and the detection only holds *between* serializable
  transactions, so it is all-or-nothing — a single remaining READ
  COMMITTED writer is invisible to every serializable peer.

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
