# UX Audit 2026-06 P0 Task Pack

Status: Task index — see "Working This Pack" for how to pick and finish
work
Created: 2026-06-12
Source: `docs/agent_notes/ux-audit-2026-06-06.md` (live-play audit, three
concurrent clients). This pack covers only the P0 findings — the audit's
"fix before any real multiplayer session" tier — plus the dev-DB fixture
cleanup the audit left behind. Code references below were re-verified
against the working tree on 2026-06-12.

## Verification Summary

Confirmed on 2026-06-12:

- No spell/cantrip step exists in the creation wizard: `WIZARD_STEPS` in
  `packages/client/src/components/character-create/wizard-state.ts:92-101`
  enumerates Species, Class, Background, Abilities, Proficiencies,
  Equipment, Personality, Review; nothing under
  `packages/client/src/components/character-create/steps/` selects spells.
- Turn advancement does broadcast server-side:
  `packages/server/src/services/encounter-combat/turn-action.ts` calls
  `fanOutBroadcasts` (`broadcast-helpers.ts:25-55`), which emits
  `encounter:updated` via
  `packages/server/src/socket/encounter-broadcast.ts:13-20`. The client
  listens in `packages/client/src/hooks/realtime-invalidation.ts`. The
  audit nonetheless observed the turn counter updating while the
  "Current" highlight (driven by `encounter.currentTurnIndex` in
  `initiative-tracker.tsx:79-89`) went stale — so P0-2 is a client cache
  refresh bug, not a missing broadcast.
- HP has two write paths: sheet-side `adjustHp`
  (`packages/server/src/services/character-live-state/stats-conditions.ts:71-88`,
  broadcasts `character:updated`, writes no combat log) and combat damage
  (`packages/server/src/services/combat-actions/apply-damage.ts:14-43` +
  `attack-transaction.ts`, writes a combat log and fans out). The
  encounter reads PC HP/AC live from `CharacterStats` via
  `resolveParticipantStats`
  (`packages/server/src/utils/encounter-query.ts:109-126`); participants
  store no snapshot (`encounter-participant-helpers.ts:19-21`).
- Audit fixtures are still in the dev DB (audit lines 275-278): campaign
  "The Sunken Crypt of Velgaroth" and both PCs, kept for reproducing the
  P0/P1 findings.

## Working This Pack

1. Work exactly one leaf per run: resume the leaf marked `In Progress` if
   one exists, otherwise take the first leaf in Ordering whose `Status:`
   is not `Done`.
2. Each leaf records its own state in its `Status:` line. Vocabulary:
   `Parked`, `In Progress` (optionally with a WIP note),
   `Blocked — <reason>`, `Done (<date>, <landing commit>)`.
3. When finishing a leaf, add short notes (decisions, surprises, deferred
   bits) and commit the status edit with the code change.
4. Re-verify file/line references before editing. Use TDD; read the
   nearest `MODULE.md` before editing services, hooks, or socket areas,
   and the relevant `docs/guides/` entry before tRPC, socket, or
   race-sensitive work.
5. Not workable: `00-index.md` (this file).

## Ordering

1. `01-wizard-spell-selection-step.md` — spellcasters must leave the
   wizard able to cast (audit P0-1).
2. `02-turn-pointer-live-sync.md` — turn/round pointer must push live to
   all clients (audit P0-2).
3. `03-hp-mutation-attribution.md` — HP writes must surface in the
   encounter with attribution (audit P0-3).
4. `04-dev-db-fixture-cleanup.md` — reseed the dev DB once 01-03 no
   longer need the repro fixtures (terminal).

## Promotion Protocol For The Rest Of The Audit

P1 items (stale AC, rest-modal lock, on-turn action surface, cast
feedback, attach broadcast, accessibility sweep) and the P2/P3 tables
stay in the audit document. To work one, write a new numbered leaf here
following the audit's fix direction and add it to the Ordering. The
older `backlog/ux_ui_audit/` pack (2026-04) predates this audit;
re-validate anything there before promoting it.

## Dependencies And Coupling

- Leaf 02 and leaf 03 are the same observed failure family (combat state
  divergence); land 02 first so 03's broadcasts have a working cache path
  to land on.
- Leaf 04 must run last: the fixtures are the repro environment for
  verifying 01-03.
- The lint pack `backlog/lint-followups-2026-06/` leaf 03d rewrites
  `encounter.po.ts` / `character-wizard.po.ts` selectors; if leaves here
  change initiative-tracker or wizard DOM, coordinate (accessible names
  added here make that drain cheaper).
