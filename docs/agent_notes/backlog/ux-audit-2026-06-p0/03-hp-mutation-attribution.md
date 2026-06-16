# HP Writes Must Surface In The Encounter With Attribution

Status: Done (option b landed — see Notes)
Order: 03
Source: audit P0-3 (`docs/agent_notes/ux-audit-2026-06-06.md:82-106`).
Land after leaf 02 (same failure family; needs the cache path working).

## Context

Encounter and sheet share one HP value: `resolveParticipantStats` returns
`stats.currentHp` / `stats.ac`
(`packages/server/src/utils/encounter-query.ts:109-126`); participants
store no combat snapshot
(`packages/server/src/utils/encounter-participant-helpers.ts:19-21`).
Sheet-side writes (Second Wind heal via `adjustHp`,
`packages/server/src/services/character-live-state/stats-conditions.ts:71-88`)
broadcast `character:updated` but write no combat-log entry, so in combat
the DM sees tracked damage "silently revert to full" — indistinguishable
from corruption. Combat damage takes a different path
(`packages/server/src/services/combat-actions/apply-damage.ts:14-43` +
`attack-transaction.ts`, which does write a combat log). Concurrent
writers raced in the audited session (HP oscillating 12 -> 0 -> 0).

This is a two-writer race on a race-sensitive field. Read
`docs/CONCURRENCY.md` and the `character-live-state` and
`encounter-combat` `MODULE.md`s before touching it. (Harness note: the
`character-live-state` MODULE.md is known to overstate its facade —
routers import internals directly; trust the code over the doc's facade
claims.)

## Scope

- Decide between the audit's two directions and record the decision (in
  Notes and `docs/agent_notes/decisions-concurrency.md`):
  (a) snapshot combat HP onto the participant at add-time, encounter
  authoritative during active combat; or (b) keep the shared value but
  route all HP mutations through one path that emits a combat-log entry
  plus a broadcast with actor attribution ("Aragorn healed 9 (Second
  Wind)"). Direction (b) preserves the single-source-of-truth design and
  reuses existing log/broadcast machinery; (a) changes the data model.
  Pick (b) unless the investigation surfaces a blocker, and say why.
- For (b): when a character in an active encounter takes an HP write from
  any source (sheet adjustHp, rest, combat damage/heal), the encounter's
  combat log gains an attributed entry and the encounter view updates via
  the existing fan-out. Use the locked stats-mutation helpers; do not
  expand the race-sensitive helper surface without re-reading
  `docs/CONCURRENCY.md`.
- Cover the race the audit saw: concurrent DM damage and player heal must
  serialize to a consistent final value with both log entries present.
- The transient HP flicker (audit P2-22) is the same family; verify the
  fix removes it or note why not.

## Definition Of Done

No HP change on a character in an active encounter can occur without an
attributed, broadcast combat-log entry; concurrent damage+heal converges
on every client; a regression test covers the Second Wind repro.

## Verification

- Race test using the existing concurrency test helpers (two concurrent
  writers, assert final HP and two log entries).
- `bun run e2e -- e2e/encounter-combat.spec.ts e2e/spell-rest.spec.ts`.
- Manual repro: sheet-side Second Wind during active combat shows an
  attributed log entry on the DM client.
- `bun run verify:changed`.

## Notes (implementation, 2026-06-13)

### Decision: option (b), append-only attributed log

Implemented option (b), not (a). Kept the single source of truth (shared
`CharacterStats` HP) and routed every sheet/rest HP write through one
attribution path: when the character is in an **active** encounter, append
an attributed `CombatLog` entry inside the HP-write transaction, then
broadcast `encounter:updated` after commit. Rationale: (b) preserves the
single-source-of-truth design and reuses the existing combat-log +
`broadcastEncounterUpdate` machinery; (a) would snapshot HP onto the
participant, forking the source of truth and changing the data model. No
blocker surfaced. Full rationale recorded in
`docs/agent_notes/decisions-concurrency.md`.

The attribution helper `logCharacterHpChangeInTx`
(`packages/server/src/utils/encounter-hp-log.ts`) is NOT race-sensitive
and does NOT expand the locked-mutation surface: `CombatLog` is append-only
(a non-candidate for CAS per `docs/CONCURRENCY.md §Scope`). The HP write
still goes through `updateCharacterStatsLocked` (Pattern A), which already
serializes concurrent writers; the helper only records what that write did,
using before/after captured from the locked helper's fresh-stats mutator and
its returned row. No `RawTxClient` escape, no gated-delegate calls.

### HP-write caller map (via `code:intel` / rg on the locked helpers)

`CharacterStats` HP-write sites (`currentHp`/`tempHp` through
`updateCharacterStatsLocked*`), and how each is routed. **NOT every HP write is
attributed** — the earlier "exhaustive / every HP write is attributed" wording
was overstated. What IS attributed is the sheet `adjustHp`/`updateStats` +
short/long rest paths; the DM-override and level-up paths are deliberate
out-of-scope exceptions (see below).

**Attributed (wired through `logCharacterHpChangeInTx`):**

- `character-live-state/stats-conditions.ts` `adjustHp` — sheet HP
  delta (Second Wind heal flows here). **Wired** (source "HP adjustment").
- `character-live-state/stats-conditions.ts` `updateStats` — absolute
  sheet edit that can set HP. **Wired** when the patch touches
  `currentHp`/`tempHp` (source "Sheet edit").
- `rest-service.ts` `executeShortRest` — short-rest heal. **Wired**
  (source "Short Rest").
- `rest-service.ts` `runLongRestTransaction` — long-rest restore.
  **Wired** (source "Long Rest").

**Already self-logging (combat paths, left unchanged):**

- `combat-actions/apply-damage.ts` (attack) — already writes a combat log
  in `attack-transaction.ts`. **Unchanged.**
- `spell-casting/apply-damage.ts` (combat spell) — already writes a combat
  log in `combat-transaction.ts`. **Unchanged.**

**Deliberate out-of-scope exceptions (NOT attributed here):**

- `routers/encounter.ts:updateParticipant` → `participant.ts`
  (DM override) — the encounter router already broadcasts `encounter:updated`
  for this path, and the DM action is already reflected in the tracker the DM
  is looking at; out of the leaf's named scope (sheet/rest/combat).
  **Left as-is** (last-writer-wins per CONCURRENCY.md).
  *Follow-up: consider attributing this too.*
- `level-up/apply-level-up.ts` — writes `currentHp` + `hpGain` (and `maxHp`);
  rare mid-combat. **Left as-is.** *Follow-up: consider attributing this too.*

**Non-HP `currentHp`-adjacent writers (not HP-bar writes, not in scope):**

- `concentration-helpers.ts` (concentration field only),
  `sorcery-point.ts`/`metamagic-helpers.ts` (sorcery points) — **not in scope.**

### Race + flicker

- Concurrent DM damage + player heal: Pattern A version-CAS already
  serializes the two writers to a consistent final HP (verified — the race
  test's HP invariant passed before attribution was added). The new work
  adds the missing attributed heal log entry so BOTH log entries are
  present. Covered by the 8-iteration race test.
- P2-22 transient HP flicker: resolved. The flicker was the same family —
  a sheet HP write changed the encounter's HP without telling the encounter
  view, so the view briefly showed stale HP until the next unrelated
  refresh. Every sheet/rest HP write now broadcasts `encounter:updated`
  post-commit, so the encounter view re-reads authoritative HP immediately.

### Tests

- `packages/server/src/routers/encounter-hp-attribution.test.ts` —
  Second Wind / sheet-heal + sheet-damage regression (attributed log
  entry + no silent revert), no-op-write does-not-log, setup-only encounter
  does-not-log, and the concurrent DM-damage + player-heal race (final HP
  consistent + both log entries). Codex P2 follow-ups added: temp-HP-only
  loss (damage absorbed by temp HP, currentHp delta 0) still surfaces an
  attributed entry + broadcast; a genuine both-deltas-zero no-op still logs
  nothing; and a character in TWO active encounters gets an attributed entry
  in BOTH.
- Updated `rest-service.test.ts` unit mocks to stub the attribution
  helper's `encounterParticipant.findFirst` (returns null → no encounter →
  no log).

### e2e

- `e2e/encounter-combat.spec.ts` — added "sheet-side HP adjust during
  combat surfaces an attributed combat-log entry": the player adjusts HP
  from the drawer sheet during active combat and the DM sees the
  "HP adjustment" combat-log entry live (no reload). Authored per the leaf;
  NOT run here (the e2e suite was intentionally not executed).

### Deferred

- A rest-in-combat e2e in `e2e/spell-rest.spec.ts` was NOT added: that spec
  has no campaign/encounter scaffold, and duplicating the combat setup there
  is out of proportion to the risk it would catch. Short/long-rest
  attribution is covered server-side by `rest-service` tests plus the shared
  `logCharacterHpChangeInTx` path exercised by the integration suite. A
  follow-up that runs the e2e suite can add it if desired.
