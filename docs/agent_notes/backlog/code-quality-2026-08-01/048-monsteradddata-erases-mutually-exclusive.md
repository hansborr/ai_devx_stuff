# 48. MonsterAddData models two mutually exclusive monster origins as three unrelated optional fields, and three adapters hand-copy its participant defaults

Status: Not started
Theme: discriminated union carriers · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MonsterAddData` is the client-side carrier used by the two current monster
selection sources: SRD (`monsterId`) and homebrew (entry id plus version). Its
three independently optional fields admit states no current adapter produces:
no source, both sources, or an unpaired homebrew version. The shared wire
`superRefine` rejects both-source and unpaired-homebrew inputs, but deliberately
accepts an origin-free custom monster participant. Thus some client mistakes
surface as runtime rejection, while a no-origin mistake can persist null
provenance successfully. The client carrier should state its narrower
current-UI invariant without claiming that invariant belongs to the wire.

On top of the weak shape, three separate converters build `MonsterAddData` by
hand — one from an SRD summary row, one from a full SRD `Monster`, one from a
homebrew entry — and each independently repeats the same participant
initialization (`currentHp = maxHp`, `tempHp: 0`, `isVisible: true`). A
contributor changing an add-time default has three places to update and nothing
that flags a missed one; a contributor adding a fourth source will copy the
defaults a fourth time.

## Evidence

- `packages/client/src/components/campaign/npcs/monster-tab.tsx:16-28` — the
  `MonsterAddData` interface: `monsterId?`, `homebrewMonsterEntryId?`, and
  `homebrewMonsterEntryVersion?` are three unrelated optional fields, so
  neither-origin, both-origins, and version-without-entry all typecheck.
- `packages/client/src/components/campaign/npcs/monster-tab.tsx:32-44` —
  adapter 1, `toMonsterAddData(m: MonsterSummary)`: sets
  `currentHp: m.maxHp`, `tempHp: 0`, `isVisible: true`, and hard-codes
  `initiativeModifier: 0`.
- `packages/shared/src/schemas/monster.ts:227-238` — `monsterSummarySchema`
  has no `initiativeModifier` field; the hard-coded 0 above is forced by the
  source shape, not a stylistic choice.
- `packages/client/src/components/campaign/npcs/monster-detail-dialog.tsx:49-61`
  — adapter 2, `toAddData(m: Monster)`: repeats the identical defaults but uses
  the real `m.initiativeModifier` (the full record has the field).
- `packages/client/src/components/campaign/npcs/homebrew-monster-tab.tsx:24-37`
  — adapter 3, `toMonsterAddData(entry, data)`: repeats the defaults a third
  time and fills the homebrew id/version pair.
- `packages/client/src/components/campaign/encounters/add-participant-dialog.tsx:7`
  — the dialog imports the type from `monster-tab.tsx` (usage at `:36`), making
  a list-view component the de-facto owner of a cross-component contract.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:285-287`
  — `onAddMonster` spreads the whole bag into the mutation
  (`mutate({ encounterId, type: "monster", ...data })`); nothing between the
  adapters and the wire narrows the origin.
- `packages/shared/src/schemas/encounter-inputs.ts:116-132` — the wire schema
  mirrors the same three optional fields; `:159-182` enforces not-both
  (`:161-167`), id-requires-version (`:168-174`), and version-requires-id
  (`:175-181`) but has no at-least-one-origin check. The supported no-origin
  path is pinned by
  `packages/server/src/routers/encounter-participants-add.test.ts:67-76` and
  `packages/server/src/utils/encounter-participant-helpers.test.ts:79-94`.
- `packages/client/src/components/campaign/npcs/monster-tab.test.tsx:71-93` —
  the tab test pins the exact flat `onAdd` payload (assertion at `:83-93`),
  including `initiativeModifier: 0`.

## Proposed direction

Introduce a small client module (e.g.
`packages/client/src/components/campaign/npcs/monster-add-data.ts`) that owns
the carrier:

1. **Discriminated origin plus common stats.** A `MonsterOrigin` union —
   `{ kind: "srd"; monsterId: string } | { kind: "homebrew"; entryId: string;
   entryVersion: number }` — plus a `MonsterAddData` of `{ origin }` and the
   common participant stats (`name`, `maxHp`, `currentHp`, `tempHp`, `ac`,
   `initiativeModifier`, `challengeRating`, `isVisible`). No-origin,
   both-origins, and unpaired-version become unrepresentable client-side.
2. **Centralize the three source adapters in the same module** —
   `fromMonsterSummary` (`MonsterSummary`; `initiativeModifier` defaults to 0
   because the summary schema has no such field), `fromMonster` (full
   `Monster`; uses `m.initiativeModifier`), and `fromHomebrewMonster`
   (`HomebrewEntry` + `HomebrewMonsterDisplay`) — all delegating the shared
   defaults (`currentHp = maxHp`, `tempHp = 0`, `isVisible = true`) to one
   helper. Keep both `initiativeModifier` behaviors verbatim, per-source.
3. **One flattener at the mutation boundary.** Add
   `toAddMonsterParticipantInput(data)` that switches exhaustively on
   `origin.kind` — no `default` branch, so a future third origin fails
   typecheck, matching the repo's discriminated-union idiom — and emits exactly
   the existing flat wire fields (`monsterId` XOR the
   `homebrewMonsterEntryId`/`homebrewMonsterEntryVersion` pair).
4. **Update the five consumers.** `monster-tab.tsx` (`:32` adapter),
   `monster-detail-dialog.tsx` (`:49` adapter), and `homebrew-monster-tab.tsx`
   (`:24` adapter) call the centralized adapters; `add-participant-dialog.tsx`
   re-points its type import; `encounter-detail-view.tsx:285-287` replaces the
   `...data` spread with the flattener inside the `type: "monster"` mutate
   call. `MonsterAddData` is currently declared and exported from
   `monster-tab.tsx:16-28` and imported by `homebrew-monster-tab.tsx`,
   `monster-detail-dialog.tsx`, and `add-participant-dialog.tsx` — the move
   requires updating all of them plus `monster-tab.test.tsx`, which asserts the
   exact `onAdd` payload (`:71-93`). Update that expectation to the new
   `{ origin, ... }` shape rather than weakening it
   (`bun run test -- packages/client/src/components/campaign/npcs/monster-tab.test.tsx`).

The mutation input's invariants at `encounter-inputs.ts:159-182` (not-both,
id-requires-version, version-requires-id) stay untouched: the new flattener
makes those states unrepresentable client-side, and the shared checks remain
the wire-level backstop. Do not delete or relax them.

## Scope / caveats

- **Out of scope:** `packages/shared/src/schemas/encounter-inputs.ts` (its flat
  fields and `superRefine` checks stay unchanged as the wire backstop), server
  helpers (`participant-action.ts`, `encounter-participant-helpers.ts`), and
  the NPC/character add paths in the same dialog.
- **Do not unify the two SRD adapters into one.** Summary rows legitimately
  default `initiativeModifier` to 0 (the schema has no field) while the detail
  dialog and homebrew path use the real value; averaging the adapters into one
  silently changes add-time initiative behavior. The split is per-source and
  must be preserved.
- **The flattener must emit the homebrew id/version strictly as a pair and
  never both origins**, or the `encounter-inputs` `superRefine` will start
  rejecting adds at runtime that the old spread happened to pass.
- **Likeliest breakage is an incomplete import sweep:** moving `MonsterAddData`
  out of `monster-tab.tsx` touches type imports in at least four files plus
  `monster-tab.test.tsx`.
- **Sequencing (soft edge only):**
  [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  and
  [026-monster-provenance-invariants-disappear.md](./026-monster-provenance-invariants-disappear.md)
  both target `packages/shared/src/schemas/encounter-inputs.ts`; this leaf
  deliberately leaves that file untouched, so it can land in any order provided
  the wire schema stays out of scope here.
- **Prior pack:** `15-client-discriminated-state.md` is landed through
  CLIENT-CLUSTER-PLAN.md slice N1 and covered NPC-editor draft/submit typing,
  not this monster-to-encounter source carrier — no dependency.
