# 179. Persist per-participant stat-block reveal state and render a spectator-safe monster drawer

Status: Not started
Theme: party stat-block reveal · Area: cross-cutting · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The VTT presents “Reveal to party” as a disabled monster-drawer action, while
both drawer permissions and token-menu discovery remain DM-only. A DM who wants
players to inspect a discovered creature must therefore relay selected rules
information through chat or voice.

Implementing the missing workflow is not just enabling the button. The existing
monster drawer combines reusable rules content with live participant state and
DM actions: current HP, HP mutations, saving-throw rolls, and attacks. A
contributor must coordinate persistence, the shared encounter contract,
concurrency classification, the existing mutation/broadcast path, client
permission state, token-menu discovery, and a renderer mode that cannot
accidentally expose or activate DM-only behavior.

## Evidence

- `packages/client/src/components/vtt/in-vtt-drawer.tsx:50-71` renders a
  “DM only” badge and a disabled `vtt-drawer-reveal-button` titled “Not yet
  implemented.”
- `packages/client/src/lib/drawer-perms.ts:11-16,33-35` gives monster drawers
  only `"allowed" | "denied"` access and allows them exclusively for the DM;
  `packages/client/src/components/campaign/tokens/token-context-menu.tsx:24-39`
  likewise returns a monster-sheet intent only when `isDm` is true.
- The persisted and shared participant shapes have visibility and combat-state
  fields but no reveal field:
  `packages/server/prisma/schema.prisma:1283-1303` and
  `packages/shared/src/schemas/encounter.ts:90-128`.
- `packages/server/src/services/encounter-combat/participant-action.ts:53-75`
  fail-closes the concurrency classification with
  `satisfies Record<keyof UpdateParticipantInput, ...>`;
  `:142-159` owns the blind-write projection, and `:304-332` already performs
  DM authorization, persistence, and `broadcastEncounterUpdate`.
- `packages/client/src/components/vtt/drawer/monster-stat-block-state.ts:44-67,77-95`
  already resolves the participant through `encounter.get` before fetching its
  bestiary monster, so reveal state can be read at that existing seam.
- `packages/client/src/components/vtt/drawer/monster-stat-block-drawer.tsx:117-165`
  combines static content with `useAbilityRoll`, `useMonsterAttack`,
  `HpControlStrip`, live metrics, and attack handlers. The metrics read
  `currentHp` and `tempHp` at
  `packages/client/src/components/vtt/drawer/monster-stat-block-header.tsx:25-44,51-64`.
- The action components are partly ready for display-only rendering:
  `ActionGroup.onAttack` is optional and controls whether an Attack button is
  shown at
  `packages/client/src/components/vtt/drawer/monster-stat-block-actions.tsx:12-17,68-87`.
  `AbilityGrid.onRoll` and `LegendaryBlock.onAttack` remain required at
  `monster-stat-block-abilities.tsx:21-29` and
  `monster-stat-block-actions.tsx:38-44`.
- Reveal is not currently a server authorization boundary. Campaign members can
  call `encounter.get`
  (`packages/server/src/routers/encounter.ts:76-90`), whose participant mapper
  includes `monsterId`
  (`packages/server/src/utils/encounter-query.ts:205-223`), and
  `monster.get` is a `publicProcedure`
  (`packages/server/src/routers/monster.ts:178-185`). The encounter projection
  separately hides non-DM live monster/NPC statistics
  (`packages/server/src/utils/encounter-query.ts:155-188`).

## Proposed direction

1. **Add the persisted reveal contract.** Add
   `statBlockRevealed Boolean @default(false)` (or an equivalently explicit
   name) to `EncounterParticipant`, with a committed Prisma migration following
   `docs/guides/add-prisma-migration.md`. Add the boolean to
   `encounterParticipantSchema` and as an optional field in
   `updateParticipantInputSchema`.

   Classify the new input key as `"non-racing"` in
   `PARTICIPANT_FIELD_KIND` and copy it through `buildBlindData`. The existing
   `satisfies` clause should make an omitted classification a compile error.
   Keep it independent of `isVisible`; map visibility and permission to inspect
   rules information are separate controls.

2. **Reuse the existing mutation and broadcast.** Toggle the field through
   `encounter.updateParticipant`. That path already asserts DM membership,
   persists the participant, reloads it, and broadcasts the encounter update;
   do not introduce another tRPC procedure or socket event.

3. **Make monster access reveal-aware at the existing query seam.** Extend
   `MonsterPermContext` with `isRevealed` and change
   `MonsterDrawerAccess` to `"dm" | "spectator" | "denied"`:

   - DM → `dm`;
   - non-DM campaign member with a revealed participant → `spectator`;
   - everyone else → `denied`.

   The monster branch cannot remain fail-closed in `VttSurface` before the
   participant is loaded. Refactor that branch so identity and role reach the
   drawer, while the final monster access decision uses the participant already
   resolved by `monster-stat-block-state.ts`. Do not add a second encounter
   query to `vtt-surface.tsx`.

4. **Complete the reveal controls and discovery path.** Feed the single resolved
   monster drawer state to both `DrawerHeader` and the body. For a DM, enable the
   existing button as a Reveal/Hide toggle and show a revealed-state indicator
   when set. Spectators may see the indicator but never the toggle.

   Give `resolveOpenSheetIntent` an explicit reveal-aware input and update its
   seam comment and tests. Combat-map callers already hold `EncounterDetail`
   (`packages/client/src/components/campaign/combat/combat-map-content.tsx:41-59`),
   so they can resolve the linked participant without another request. Other
   map contexts without participant reveal state must default to no player
   monster-sheet intent.

5. **Add one spectator mode to the existing renderer.** Thread a
   `dm | spectator` mode through `MonsterStatBlockDrawer` and `BestiaryBody`;
   do not fork a second stat-block component. Spectator mode may render
   `NameLine`, static AC/max-HP/speed/CR presentation,
   `DefencesAndProfile`, `AbilityGrid`, and trait/action/legendary text, but it
   must:

   - omit `HpControlStrip`;
   - never read or display participant `currentHp` or `tempHp`;
   - omit `useAbilityRoll`/`useMonsterAttack` wiring and handler props;
   - render ability saves and structured actions as non-interactive text;
   - keep `ConditionsBlock` display-only. It currently has no edit affordance
     (`monster-stat-block-profile.tsx:51-74`), and spectator mode must not add
     one.

   Add negative tests for every omitted control and live value, not only a
   positive “drawer opens” assertion. Extend the existing permission,
   token-context-menu, drawer, state-machine, and E2E page-object coverage using
   TDD.

## Scope / caveats

- Reveal is a UX/consent signal, not a security claim. Server-side filtering of
  bestiary records or participant identifiers is explicitly out of scope and
  could be a separate follow-up.
- The server already nulls live monster/NPC statistics for non-DMs, but the
  client must not turn null into a misleading `max / max` “current HP” display.
  If max HP is shown, label it as static bestiary information.
- Restrict this workflow to monster stat blocks. Character and NPC participant
  drawers, and homebrew-monster visibility policy, are out of scope.
- Spectator omissions are a quiet disclosure and interaction risk: missing one
  metrics or handler branch may compile successfully. Tests must enumerate HP,
  temp HP, rolls, attacks, mutations, and reveal-toggle absence.
- Expect broad fixture churn from the required Prisma default and shared-schema
  field. Update factories explicitly rather than weakening the contract.
- Soft sequencing edge with
  [054-tokencontextmenu-option-bag-two-different.md](./054-tokencontextmenu-option-bag-two-different.md):
  both change TokenContextMenu's combat contract, `combat-map-content.tsx`, and
  variant tests; whichever lands second must carry the reveal-aware open-sheet
  input through 054's discriminated combat variant and tests.
