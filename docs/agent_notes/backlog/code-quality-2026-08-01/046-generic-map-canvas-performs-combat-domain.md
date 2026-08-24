# 46. The generic map canvas imports the encounter contract and derives combat turn/HP/condition state that its own module doc assigns to the combat feature

Status: Not started
Theme: feature-boundary layering · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MapCanvas` is the low-level Konva renderer that both ordinary map editing and
active combat share. It should change when map rendering changes. Instead it
accepts the complete `EncounterDetail` as an optional prop and, through a
helper in its own directory, derives full combat presentation state — whose
turn it is, current/max/temporary HP, condition lists, participant identity —
before handing per-token slices to `TokenShape`. That means the generic
renderer changes whenever the encounter contract changes, and a contributor
touching combat presentation has to edit `maps/`, not `combat/`.

The maps module contract says the opposite, twice: its gotcha assigns
combat-specific behavior to `../combat` "even when it is visually rendered on
the map", and it describes `map-canvas-helpers.ts` as a pure helper seam for
canvas calculations. In reality that helpers file opens with a "Combat overlay
helpers" section that understands encounter state, turn order, and HP. The
combat module's own contract already names the correct home — it "should
compose" token presentation and map mechanics "around active combat state",
and it has a dedicated maps-facing bridge file (`combat-map-bridges.ts`) that
imports `EncounterDetail` today. The documented boundary and the code
disagree, and the doc is the side contributors are told to trust.

## Evidence

- `packages/client/src/components/campaign/maps/map-canvas.tsx:2` — the
  generic canvas imports `EncounterDetail` from the encounter schema; `:38` —
  `readonly encounter?: EncounterDetail;` on `MapCanvasProps`.
- `packages/client/src/components/campaign/maps/map-canvas.tsx:64-66` — combat
  derivation sits beside layer parsing: `parseFogData`, `parseDrawingData`,
  then `const combatStateMap = useCombatStateMap(encounter);`. `:135` feeds
  `combatState={getCombatState(token, combatStateMap)}` to each `TokenShape`.
- `packages/client/src/components/campaign/maps/map-canvas-helpers.ts:15-61` —
  the "Combat overlay helpers" section: `CombatStateInput` (`:15-19`) shaped
  from `EncounterDetail["state"]`/`["participants"]`; `buildCombatStateMap`
  (`:21-35`) deriving `isCurrentTurn` from `sortOrder === currentTurnIndex`
  plus conditions, HP, temp HP, and participant id; `getCombatState`
  (`:37-46`); the memoized `useCombatStateMap` hook (`:48-61`). Only
  `parseFogData`/`parseDrawingData` (`:67-81`) match the module's description
  of the file.
- `packages/client/src/components/campaign/maps/MODULE.md:95-96` — "Combat-specific
  behavior belongs in `../combat/` even when it is visually rendered on the
  map." `:81-82` describes `map-canvas-helpers.ts` as "the pure-helper seam
  for coordinate and sizing calculations" — the combat section contradicts it.
- `packages/client/src/components/campaign/combat/MODULE.md:107` — the combat
  module "should compose them around active combat state" (token presentation
  from `../tokens/`, map mechanics from `../maps/`); `:43-44` document
  `combat-map-bridges.ts` as the existing "combat ↔ map glue".
  `packages/client/src/components/campaign/combat/combat-map-bridges.ts:1`
  already imports `EncounterDetail`, and `combat-map-bridges.test.tsx` already
  hosts its hook tests.
- Call sites: `packages/client/src/components/campaign/combat/combat-map-content.tsx:158-168`
  renders `MapCanvas` with `encounter={encounter}` at `:168`;
  `packages/client/src/components/campaign/maps/map-detail-content.tsx:112-123`
  renders it with no `encounter` prop — ordinary maps never use the combat path.
- `packages/client/src/components/campaign/tokens/token-shape.tsx:27-34` —
  `CombatTokenState` is defined and exported by the tokens module; `:46` is the
  `combatState` prop MapCanvas forwards; `:63-78` — `resolveHpDisplay` sources
  HP from `combatState` first, then the token's own fields.
- `packages/shared/src/schemas/map.ts:83` — `encounterParticipantId` is part of
  the shared `MapToken` schema, so a per-token id lookup is generic map wiring.
- Measured at the pin: `map-canvas.tsx:16` is the only importer of
  `map-canvas-helpers.ts`, and no `*.test.*` file references
  `buildCombatStateMap`, `useCombatStateMap`, or `getCombatState` — the combat
  derivation is untested where it lives today.

## Proposed direction

Replace the `encounter?: EncounterDetail` prop on `MapCanvas`
(`map-canvas.tsx:38`) with a domain-neutral
`combatTokenStates?: ReadonlyMap<string, CombatTokenState>` keyed by
`encounterParticipantId`, and move the derivation into the combat feature:

1. **TDD first**: add `useCombatStateMap` hook coverage in
   `packages/client/src/components/campaign/combat/combat-map-bridges.test.tsx`
   (there is no existing map-canvas-helpers test to migrate). Run it with
   `bun run test -- packages/client/src/components/campaign/combat/combat-map-bridges.test.tsx`.
2. Move `buildCombatStateMap`, `useCombatStateMap`, and the
   `CombatStateInput` shape out of `map-canvas-helpers.ts:15-61` into
   `combat/combat-map-bridges.ts` — the module's existing maps-facing bridge
   seam. Delete `getCombatState`: its logic folds into a trivial inline lookup
   in `MapCanvas` (`token.encounterParticipantId ?
   combatTokenStates?.get(token.encounterParticipantId) : undefined`), which
   is generic wiring since `encounterParticipantId` is part of the shared
   `MapToken` schema and `CombatTokenState` is the tokens-module render type
   MapCanvas already forwards to `TokenShape`.
3. `combat-map-content.tsx` calls the moved memoized hook and passes the
   resulting map at its `MapCanvas` call site (`:158-168`).
   `map-detail-content.tsx` changes only by prop-name absence — ordinary maps
   pass no combat projection, preserving the current undefined-`combatState`
   render path through `TokenShape`/`resolveHpDisplay`.
4. This leaves `map-canvas-helpers.ts` holding only
   `parseFogData`/`parseDrawingData`, realigning it with `maps/MODULE.md`'s
   description of the file as a pure helper seam. Carry a one-line
   `combat/MODULE.md` update noting `combat-map-bridges.ts` owns the
   combat-token render projection; `maps/MODULE.md`'s gotcha (`:95-96`)
   already states the target contract and needs no change beyond removing any
   now-false canvas/combat wording (check the `:81-82` helper-seam sentence
   still reads true once the combat section is gone).

Keep the prop name combat-explicit (`combatTokenStates`), not fake-generic:
the module contract permits maps to compose token render props — the defect
was deriving encounter state, not naming. `CombatTokenState` stays exported
from `tokens/token-shape.tsx`; combat importing it is sanctioned by
`combat/MODULE.md:107`, so do not relocate the type.

## Scope / caveats

- **Out of scope**: any `MapCanvasFrame` or shared canvas-shell extraction;
  changes to `TokenShape` or `CombatTokenState` themselves; changes to the
  tokens module or server encounter contracts.
- **Prior-pack constraint (binding, do not reopen)**: the 2026-07-25 pack
  refused the configurable shared canvas-shell — leaf 13's `<MapCanvasFrame>`
  and panel primitives were dropped as not earning a configurable shell for
  two call sites (`docs/agent_notes/backlog/code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md:588`).
  That ruling covers shell extraction, not this change: replacing the existing
  optional `encounter` prop with a narrower optional data prop does not
  reintroduce a flag-bearing shared shell. Do not misread the constraint as
  forbidding any optional prop on `MapCanvas` — that misreading would stall
  the leaf.
- **Memoization is load-bearing**: the projection map must stay memoized in
  the combat-side hook (as `buildCombatStateMap` currently is via `useMemo` in
  `map-canvas-helpers.ts:54-60`). An unmemoized map prop would re-render every
  `TokenShape` per encounter tick and could disturb Konva drag/selection
  behavior. The `React.memo` rationale comment at
  `tokens/token-shape.tsx:204-212` names `useCombatStateMap` and the
  `encounter` prop as the stability argument — keep that comment true when the
  hook moves and the prop renames (a comment-only edit, not a `TokenShape`
  change).
- **HP display regression point**: `resolveHpDisplay`
  (`token-shape.tsx:63-78`) sources HP from `combatState` first and falls back
  to the token's own fields; the undefined-`combatState` path on ordinary maps
  must render exactly as today.
- **Sequencing**: soft edge with
  [088-client-component-module-documents-misstate.md](./088-client-component-module-documents-misstate.md)
  — both touch `combat/MODULE.md`; whichever lands second folds the other's
  wording (this leaf adds one line about `combat-map-bridges.ts` owning the
  combat-token projection). Otherwise independent.
