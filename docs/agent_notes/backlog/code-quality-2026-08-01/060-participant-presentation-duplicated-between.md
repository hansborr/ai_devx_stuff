# 60. State-independent participant presentation is duplicated between encounter setup and combat because the generic primitives are filed under combat

Status: Not started
Theme: shared participant UI primitives · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Encounter setup and active combat both present the same state-independent
participant facts — identity (name + type icon), statistics (HP, AC), and
visibility — but with two independent markup and styling vocabularies. The
genuinely generic components (`HpBar`, `AcDisplay`, `ConditionBadges`, the
type-icon map) are filed under the combat directory or reached across
directory lines, so setup code reproduces them instead: setup's
`ParticipantRow` hand-rolls its own HP and AC spans, and the visibility toggle
button is copy-pasted between setup and combat with identical icon markup and
aria-label pattern. Meanwhile combat imports the type-icon map *from* the
setup directory, so the cross-directory dependency already runs both ways. A
contributor changing how a participant is shown (an icon, an accessibility
label, low-HP styling) must find and edit two vocabularies, and the directory
layout keeps inviting the next setup-side reimplementation.

## Evidence

- `packages/client/src/components/campaign/encounters/encounter-participants.tsx:25-49` — setup's `ParticipantRow` independently renders type icon, name, type badge, HP as an inline `Heart` + `currentHp/maxHp` text span (`:37-42`), AC as `Shield` + number (`:43-48`), and initiative.
- `packages/client/src/components/campaign/combat/participant-stats.tsx:7` (`HpBar`), `:54` (`ConditionBadges`), `:77` (`AcDisplay`) — the generic stat vocabulary; none of these components reads any combat-only state, yet all live under `combat/`.
- `packages/client/src/components/campaign/combat/initiative-tracker/participant-stat-line.tsx:16-26` — combat's stat line composes the type badge, `HpBar`, and `AcDisplay`: a second presentation vocabulary for the same HP/AC facts setup renders by hand.
- `packages/client/src/components/campaign/encounters/encounter-participants.tsx:55-68` vs `packages/client/src/components/campaign/combat/initiative-tracker/dm-participant-tools.tsx:40-52` — the visibility toggle is copy-pasted: same `Button variant="ghost" size="sm"`, same `Hide ${name}`/`Show ${name}` aria-label conditional, same `Eye className="h-4 w-4"` / `EyeOff className="h-4 w-4 text-muted-foreground"` pair.
- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-row-info.tsx:161,189` — combat duplicates setup's identity markup too: the same `PARTICIPANT_TYPE_ICONS[participant.type]` lookup and `<TypeIcon className="h-4 w-4 text-muted-foreground" />` render as `encounter-participants.tsx:25,30`.
- `packages/client/src/components/campaign/combat/initiative-tracker/initiative-row-info.tsx:7` — combat imports `PARTICIPANT_TYPE_ICONS` from `@/components/campaign/encounters/encounter-icons.js` (declared at `encounter-icons.ts:3-7`): the icon primitive is filed under setup while the stat primitives are filed under combat, so neither directory is the neutral home.

## Proposed direction

Agreed disposition: **move the state-independent participant primitives (type
icon, `HpBar`/`AcDisplay` stat vocabulary, visibility-toggle button) into a
neutral encounter-participant module, recompose the setup `ParticipantRow` and
the initiative-tracker files around them without adding boolean-flag or
optional-callback props, and update the affected MODULE.md files and colocated
tests.** One small commit. Mechanics:

- Neutral home: a module under `packages/client/src/components/campaign/`
  that is neither `encounters/` nor `combat/` (e.g. an
  `encounter-participant/` directory). Move `PARTICIPANT_TYPE_ICONS`
  (`encounters/encounter-icons.ts:3-7`) and the contents of
  `combat/participant-stats.tsx` there, and extract one visibility-toggle
  button component from the two copies (`encounter-participants.tsx:55-68`,
  `dm-participant-tools.tsx:40-52`) — the aria-label pattern is already
  identical, so the extraction changes no rendered output.
- Recompose consumers: setup's `ParticipantRow`
  (`encounter-participants.tsx:14-81`) and the initiative-tracker files
  (`participant-stat-line.tsx:4`, `dm-participant-tools.tsx`,
  `initiative-row-info.tsx:7`) import from the neutral module. If a call site
  needs different behavior, compose a setup-only or combat-only wrapper around
  the primitive — do not add boolean-flag or optional-callback props to the
  shared components (binding constraint from the disposition).
- Update `combat/MODULE.md:62-65` (lists `participant-stats.tsx` as a combat
  piece) and `encounters/MODULE.md` per `docs/guides/add-module-doc.md`, and
  move/extend the colocated tests (`participant-stats.test.tsx`,
  `participant-stat-line.test.tsx`, `dm-participant-tools.test.tsx`,
  `encounter-participants.test.tsx`) alongside the code they cover.

## Scope / caveats

- **This is relocation-and-reuse, not visual unification.** Setup's compact
  `Heart` + text HP treatment (`encounter-participants.tsx:37-42`) and
  combat's `HpBar` are partly intentional visual variants; converging them
  onto one rendering is a product decision and is out of scope. What must
  converge is the *home* of the primitives and the copy-pasted
  visibility/identity markup.
- Mutation wiring stays put: `useEncounterDetailMutations`
  (`encounter-participants.tsx:123-215`) is owned by
  [043-encounter-detail-behavior-fragmented-across.md](./043-encounter-detail-behavior-fragmented-across.md),
  which restructures the same file. No hard ordering, but do not work the two
  leaves concurrently in `encounter-participants.tsx`.
- [088-client-component-module-documents-misstate.md](./088-client-component-module-documents-misstate.md)
  refreshes the combat MODULE docs; if both are in flight, land the MODULE.md
  edits sequentially so neither overwrites the other's corrections.
