# Developer Experience Sprint 2 Roadmap

Active DX5-DX8 developer-experience work. Use `docs/agent_notes/NEXT.md` as
the active queue; promote one leaf at a time from this file.

## Phase DX5: Server Refactors

Goal: make server-side extension points easier to understand and safer to
modify.

### DX5.1a SRD Mapper Boundary

`packages/server/src/routers/srd.ts` is ~611 lines of 16 list/get
procedures, all sharing the same fetch → select → map → `.output()` shape
and repeating the same `casterType` / `spellcastingAbility` /
`hitDie` narrow-cast at each call site.

- [x] Extract a shared narrow-cast helper for the Prisma → enum boundary
      so the `as ClassNarrow["..."]` lines disappear from per-procedure
      mappers.
- [x] Add focused tests around the narrow-cast contract and existing SRD
      mapper behavior.
- [x] Keep router procedure names and `.output()` schemas stable.

Definition of done: Prisma-to-domain narrowing is centralized and covered,
without changing SRD procedure behavior.

### DX5.1b SRD Query Helper Module

Land DX5.1a first so this leaf can focus on router shape rather than enum
boundary cleanup.

- [x] Extract repeated fetch/select/map/output patterns into a small
      builder/helper layer; target collapsing each list/get pair to roughly
      the schema + select + order shape, with mapping handled by the
      helper.
- [x] Keep router procedure names and `.output()` schemas stable.
- [x] Add focused tests around the builder/helper behavior, not the
      procedures themselves.

Definition of done: adding an SRD field or query requires changing fewer
places, the per-procedure body is dominated by schema/select/order, and
output validation stays obvious at the procedure boundary.

### DX5.2 Encounter Query Contracts

Today encounter read shape is split across two places: `PARTICIPANT_INCLUDE`
lives inline in `packages/server/src/routers/encounter.ts`, while
`ENCOUNTER_DETAIL_INCLUDE` and row interfaces (`EncounterRow`,
`CharacterStatsRow`, etc.) sit in
`packages/server/src/utils/encounter-helpers.ts` alongside auth and mutation
logic. The contracts are imported separately and drift independently.

- [x] Consolidate include constants, row interfaces, and the row-typed
      mappers (`mapParticipant`, `mapCombatLog`, `mapEncounterDetail`,
      `mapEncounterSummary`, `loadEncounterDetail`) into a typed query
      module that owns the encounter read contract.
- [x] Leave auth helpers (`assertEncounterDm`,
      `assertMapBelongsToCampaign`, `validateCharacterForCampaign`) and
      mutation helpers (`buildParticipantUpdateData`,
      `buildCharacterStatsUpdate`, `buildAddParticipantData`,
      `getMaxSortOrder`, `activateEncounter`, `lockTurnIndexForRemoval`,
      `reindexSortOrders`) in `encounter-helpers.ts` or its participant
      helper module so the surface narrows back toward auth/mutation
      responsibilities.
- [x] Keep services and routers importing the narrow contracts they need.
- [x] Avoid behavior changes.

Definition of done: encounter read shapes are explicit and easier to audit,
and `encounter-helpers.ts` no longer mixes read contracts with auth/mutation
helpers.

### DX5.3a Socket Emit Inventory

Before introducing the registry, inventory every server-side socket emit and
classify the owner. Current direct emits include domain mutation/chat
broadcasts, presence and campaign-room membership signals, notification
delivery, and connection control/error events.

- [x] List every server-side `.emit()` call and classify it as registry-owned,
      presence-owned, notification-owned, or control/error-only.
- [x] Define the first registry scope as domain mutation/chat broadcasts unless
      the inventory proves another family belongs in the same abstraction.
- [x] Keep this leaf documentation-only; do not migrate emit code yet.

Definition of done: DX5.3b-DX5.3f have an explicit emit inventory and a scoped
registry boundary. Inventory parked at
`docs/agent_notes/finished_work/socket-emit-inventory.md` after DX5.3f closed;
first registry scope is domain mutation events plus `chat:newMessage`.

### DX5.3b Socket Broadcast Registry Foundation

The broadcast surface today spans five files in `packages/server/src/socket/`
(`campaign-broadcast.ts`, `character-broadcast.ts`, `chat-broadcast.ts`,
`encounter-broadcast.ts`, `map-broadcast.ts`) plus
`services/encounter-combat/broadcast-helpers.ts`. `campaign-broadcast.ts`
(~12 lines, one event) is the cheapest proving slice.

- [x] Create a typed event registry mapping event name, payload schema, and
      room/channel policy.
- [x] Migrate `campaign-broadcast.ts` onto the registry as the proving
      slice.
- [x] Add compile-time or test coverage that registry payloads match the
      shared socket schemas in `@musi/shared`.
- [x] Document the migration recipe in the registry module, including the
      boundary that the registry owns emit policy and payload validation, not
      persistence or mutation-side side effects.

Definition of done: the registry exists, one family is on it, and a new
event has one obvious path through the registry.

### DX5.3c Socket Broadcast Registry Migration: Simple Events

- [x] Migrate `character-broadcast.ts` onto the registry.
- [x] Migrate `encounter-broadcast.ts` onto the registry.
- [x] Migrate `map-broadcast.ts` onto the registry.
- [x] Keep per-family adapters only where they preserve clearer imports.

Definition of done: simple campaign-room invalidation events go through the
registry with stable helper call sites.

### DX5.3d Socket Broadcast Registry Migration: Chat Routing

- [x] Migrate `chat-broadcast.ts` onto the registry without changing whisper
      recipient routing.
- [x] Add coverage for room-wide chat and whisper recipient routing.
- [x] Keep notification delivery and presence emits outside this leaf unless
      DX5.3a explicitly classifies them as registry-owned.

Definition of done: chat emits use the registry and whisper routing remains
explicit and behaviorally stable.

### DX5.3e Socket Broadcast Registry Migration: Combat Fan-Out

- [x] Migrate `services/encounter-combat/broadcast-helpers.ts` onto the
      registry only for its socket emissions; keep combat-chat persistence in
      the service layer.
- [x] Keep combat fan-out behavior explicit: encounter invalidation,
      character invalidation, and combat-chat persistence remain separately
      auditable.
- [x] Add focused coverage for the fan-out path.

Definition of done: combat action fan-out uses the registry for socket emits
without moving persistence or mutation-side side effects into the registry.

### DX5.3f Socket Broadcast Registry Cleanup

- [x] Remove now-unused per-family ad-hoc helpers.
- [x] Re-check the DX5.3a inventory and either migrate or intentionally park
      any remaining direct emits.
- [x] Keep presence, notification, and control/error events in their owning
      modules unless a prior leaf deliberately moved them.

Definition of done: domain mutation/chat broadcasts have one registry path, and
remaining direct emits are documented as intentionally outside that boundary.
Closed: every per-family adapter still has callers (kept as DX5.3c stable
adapters); presence, notification, and control/error emits stay in their owning
modules and are recorded as intentionally outside the registry boundary in the
parked inventory at `docs/agent_notes/finished_work/socket-emit-inventory.md`.

## Phase DX6: Client Refactors

Goal: reduce the onboarding cliff in large UI surfaces without hiding complexity
inside a new monolith.

### DX6.0 Client Path And Module Prep

- [x] Refresh the DX6 target paths against the current tree before splitting
      files.
- [x] Decide whether `components/vtt/drawer/MODULE.md` should exist before the
      drawer splits, and create it only if cross-file ownership rules are
      needed.
- [x] Run `bun run module:index` if module docs move or new module docs are
      added.

Definition of done: DX6 work starts with current paths and clear module-doc
ownership rules. Closed: DX6.1-DX6.3 target paths and line counts verified
against the tree (all match the roadmap); created
`packages/client/src/components/vtt/drawer/MODULE.md` to document drawer
rendering, cast-rail/strip coupling, and the boundary back to
`hooks/vtt-drawer/`, the drawer store, and `lib/drawer-perms.ts`; refreshed
`MODULE-INDEX.md`.

### DX6.1a Character Sheet Page Slices

Target: `packages/client/src/pages/character-sheet-page.tsx` (~692).

- [x] Split into data boundary, sheet layout, and focused section
      components.
- [x] Prefer narrow hooks/selectors before adding a broad facade.
- [x] Keep socket and optimistic update behavior covered by existing
      tests.

Definition of done: contributors can work on one sheet section without
loading the whole page orchestration.

### DX6.1b Level-Up Dialog Slices

Target: `packages/client/src/components/sheet/level-up-dialog.tsx` (~516).

- [x] Split along wizard state, option presentation, and
      mutation/validation boundaries.
- [x] Prefer narrow hooks/selectors before adding a broad facade.
- [x] Keep wizard test coverage (`renderWizard()`) green.

Definition of done: a level-up step can be modified without touching
unrelated wizard state.

### DX6.1c Ability Scores Component Split

Target: `packages/client/src/components/sheet/ability-scores.tsx` (~434),
with paired test
`packages/client/src/components/sheet/ability-scores.test.tsx` (~611).

- [x] Split the component along rendering / interaction / mutation
      boundaries.
- [x] Split `ability-scores.test.tsx` along the same seams so the test
      reduction lands with the source change rather than as a separate
      pass.
- [x] Keep optimistic-update and socket behavior covered.

Definition of done: ability-score behavior changes touch one focused
component and its co-located test.

### DX6.2a Monster Stat Block Drawer Slices

Target: `packages/client/src/components/vtt/drawer/monster-stat-block-drawer.tsx`
(~679).

- [x] Split into smaller presentational and action components.
- [x] Keep `hooks/vtt-drawer/MODULE.md` as the data-flow contract.
- [x] Create or update `components/vtt/drawer/MODULE.md` if the split leaves
      cross-file ownership rules; follow `docs/module-docs.md`.

Definition of done: the stat-block surface is easy to trace from row to
hook to server mutation.

### DX6.2b Stats Tab Slices

Target: `packages/client/src/components/vtt/drawer/tabs/stats-tab.tsx` (~516).

- [x] Split into smaller presentational and action components.
- [x] Keep `hooks/vtt-drawer/MODULE.md` as the data-flow contract.
- [x] Update `components/vtt/drawer/MODULE.md` if component ownership or
      test seams changed.

Definition of done: stats-tab changes touch focused display/action components
instead of the whole tab body.

### DX6.2c Actions Tab Slices

Target: `packages/client/src/components/vtt/drawer/tabs/actions-tab.tsx` (~505).

- [x] Split into smaller presentational and action components.
- [x] Keep `hooks/vtt-drawer/MODULE.md` as the data-flow contract.
- [x] Update `components/vtt/drawer/MODULE.md` if component ownership or
      test seams changed.

Definition of done: drawer action changes are traceable from button to hook
to server mutation.

### DX6.2d Cast Rail Slices

Target: `packages/client/src/components/vtt/drawer/cast-rail.tsx` (~488),
with paired test
`packages/client/src/components/vtt/drawer/cast-rail.test.tsx` (~686).

- [x] Split into smaller presentational and action components.
- [x] Split `cast-rail.test.tsx` along the same seams so the test
      reduction lands with the source change.
- [x] Keep `hooks/vtt-drawer/MODULE.md` as the data-flow contract.
- [x] Update `components/vtt/drawer/MODULE.md` if component ownership or
      test seams changed.

Definition of done: casting flows are easy to trace from button to hook to
server mutation.

### DX6.3a Map Canvas Mechanics

Target: `packages/client/src/components/campaign/maps/map-canvas.tsx` (~511).

- [x] Decompose canvas rendering and overlay components along the existing
      `hooks/canvas-input/` write-boundary.
- [x] Keep Konva interaction tests green without moving pointer-write logic
      out of `hooks/canvas-input/`.
- [x] Preserve responsive behavior and stable canvas dimensions.

Definition of done: canvas rendering and overlays can be modified without
loading the broader map-detail orchestration.

### DX6.3b Map Toolbar Mechanics

Target: `packages/client/src/components/campaign/maps/map-toolbar.tsx` (~406).

- [x] Split tool-mode controls into focused toolbar sections.
- [x] Keep toolbar state reads/writes aligned with the existing map canvas
      store and `hooks/canvas-input/` ownership rules.
- [x] Preserve responsive toolbar behavior.

Definition of done: tool controls can be modified without loading canvas
rendering or map-detail orchestration.

### DX6.3c Map Detail Orchestration

Target: `packages/client/src/components/campaign/maps/map-detail-view.tsx`
(~565).

- [x] Land DX6.3a and DX6.3b first so canvas and toolbar are stable
      extraction points.
- [x] Pull orchestration out of the page component; keep route boundary
      and tRPC integration intact.

Definition of done: a small map-detail change no longer requires editing
the page-level orchestrator.

### DX6.3d Combat Map Surface Slices

Target: `packages/client/src/components/campaign/combat/combat-map-panel.tsx`
(~564).

- [x] Land DX6.3a-DX6.3c first; reuse the same shape for the combat surface.
- [x] Preserve combat-map interaction and turn-highlight tests.

Definition of done: combat-map changes follow the same contributor path as
the rest of the map UI.

## Phase DX7: Test Suite Shape

Goal: make tests easier to navigate while preserving regression coverage.

### DX7.0a Vitest Timing Capture

- [x] Determine the lowest-friction Vitest timing source for top slow files or
      cases without changing the default test command's behavior.
- [x] Persist enough timing output in the existing verification log/cache
      conventions for a later viewer to consume.
- [x] Keep this local-only; do not add CI gating.

Definition of done: the latest cached test run exposes parseable timing data
without adding a second logging surface. Closed: `scripts/verify.sh` now pairs
`--reporter=dot` with `--reporter=json --outputFile.json=$LOG_DIR/test-timings.json`
in both `--changed` and full modes, so each verify run leaves a parseable
sidecar (`numTotalTests`, per-file `startTime`/`endTime`, and per-test
`duration` in `testResults[].assertionResults[]`) alongside `test.log`. The
default `bun run test` script is untouched. `.husky/pre-commit` was left as-is
in this leaf (protected-files guard); DX7.0b's viewer should treat the timings
file as best-effort (a pre-commit-triggered run or changed-mode skip can leave
no timings), and the user can force a verify rerun to regenerate.

### DX7.0b Slow-Test Budget Viewer

- [x] Add a local, on-demand slow-test summary for Vitest (top 10 slowest
      files or cases) wired through the existing `bun run verify:logs`
      viewer; reuse the cached log/marker conventions rather than
      introducing a parallel surface.
- [x] No CI gating in this leaf — keep it a local-on-demand signal until
      the data justifies promotion. CI integration is a follow-up if the
      report proves useful.
- [x] Use the report to guide future DX7 splits instead of guessing from
      line counts alone.

Definition of done: a contributor can run one command and see the top-10
slowest tests against the current cached run, and slow-test growth is
visible before it becomes a default developer tax.
Closed: `bun run verify:logs slow-tests` reads the existing
`$MUSI_VERIFY_LOG_DIR/test-timings.json` sidecar, prints top-10 file and case
durations with wrapper/log context, and gives forced rerun guidance when the
timing sidecar is missing or corrupt: `FORCE_VERIFY=1 bun run verify:changed`
for changed-test timings, or `FORCE_VERIFY=1 bun run verify` when
changed-mode skipped Vitest. The report remains local-only and does not gate
CI or commits.

### DX7.0c Fixture Builder Inventory

- [x] Identify fixture files that have grown into broad object dumps,
      including the current client encounter/SRD fixture outliers.
- [x] Document the narrow builder shapes needed by the DX7.1 splits before
      those splits start.
- [x] Avoid broad fixture rewrites in this leaf; keep it as the inventory
      and extraction plan.

Definition of done: DX7 test splits know which setup should move into narrow
builders and which fixture defaults should stay untouched.
Closed: inventory parked at
`docs/agent_notes/finished_work/fixture-builder-inventory.md`. Outliers are
`packages/client/src/test/fixtures-encounter.ts` (460 lines, six
pre-baked `EncounterDetail` constants) and
`packages/client/src/test/fixtures-srd.ts` (347 lines, five frozen `as const`
arrays). Server-side setup-context helpers
(`encounter-test-helper.ts`, `spell-test-helper.ts`, `map-test-helper.ts`,
`inventory-test-helper.ts`) already follow the narrow-builder shape; DX7.1
splits should lift the in-file `makeXxxEncounter` helpers next to them
rather than fork new context shapes.

### DX7.1a Encounter Router Test Split

Target: `packages/server/src/routers/encounter.test.ts` (~2,328 lines).
Most encounter test splitting has already happened (`encounter-combat`,
`encounter-combat-concurrency`, `encounter-combat-spell`,
`encounter-combat-map`, `encounter-combat-concentration`, `encounter-map`).
This is the remaining outlier on the encounter side.

- [x] Split by workflow or procedure family.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep concurrency tests explicit and isolated.

Definition of done: a failure in encounter-router behavior points to a
focused file rather than a 2,000+ line suite. Closed: split into
`encounter.test.ts` (CRUD, ~356), participant tests split into
`encounter-participants-add.test.ts`, `encounter-participants-remove.test.ts`,
and `encounter-participants-update.test.ts`, `encounter-state.test.ts`
(setInitiative + transitionState, ~406), `encounter-turn.test.ts`
(rollAllInitiative + advanceTurn + combat logging, ~425), and
`encounter-character-stats.test.ts` (~204). `setupActiveBattle` and
`setupActiveWithLog` lifted into `encounter-test-helper.ts` as
`buildActiveBattle()` / `buildActiveBattleWithLog()`. The
remove-participant + activate concurrency case stays with the remove
participant coverage. Helper file at
252 lines, still well under the ~300-line peel-off threshold.

### DX7.1b Map Router Test Split

Target: `packages/server/src/routers/map.test.ts` (~1,134 lines).

- [x] Split by workflow or procedure family.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.

Definition of done: a failure in map-router behavior points to a focused
file rather than a 1,000+ line suite. Closed: split into `map.test.ts`
(core map create/get/list/update/delete, ~379), `map-token.test.ts`
(token create/update/delete, ~280), `map-layer.test.ts`
(layer create/update/delete, ~264), `map-token-move.test.ts` (~186), and
`map-character-enrichment.test.ts` (~100). Lifted the player-character setup
into `map-test-helper.ts` as `assignPlayerCharacter(ctx)`.

### DX7.1c Remaining Client Test Splits

`cast-rail.test.tsx` and `ability-scores.test.tsx` are split alongside
their source components in DX6.2d and DX6.1c. The remaining client
outliers do not have matching DX6 source refactors:

- `packages/client/src/components/campaign/combat/initiative-tracker.test.tsx`
  (~603) — source already decomposed inside
  `components/campaign/combat/initiative-tracker/`; this is a stale
  integration suite at the sibling level, not a giant component.
- `packages/client/src/hooks/character-sheet/use-character-stats.test.tsx`
  (~553) — hook test against a 169-line hook; split is test-only.
- `packages/client/src/hooks/canvas-input/use-canvas-input.test.ts`
  (~747) — 10 top-level describes covering distinct tool behaviors
  (measure, fog, drawing, template, place-token, target-pick, pointer
  resolution); source lives behind the `hooks/canvas-input/` write-boundary
  and is not in DX6 scope, so the split is test-only.

- [x] Split each by feature surface (e.g. rendering vs. interaction vs.
      mutation flows) so failures point to focused behavior files.
- [x] Extract only the narrow helpers needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep socket and optimistic-update tests explicit and isolated.

Definition of done: the remaining ~500+ line client test files follow the
same focused-file shape as the post-DX7.1a/b server tests.
Closed: split initiative tracker coverage into rendering, action controls, and
initiative-edit specs; split character stats hook coverage into stats-update
and adjust-HP specs; split canvas input coverage into state/pointer,
measure/fog, drawing/template, and token/target specs.

### DX7.1d Encounter Combat Router Test Split

Target: `packages/server/src/routers/encounter-combat.test.ts` (~1,497 lines).
Sibling files (`encounter-combat-concurrency`, `encounter-combat-spell`,
`encounter-combat-map`, `encounter-combat-concentration`) already split,
but `attemptAttack` alone runs ~737 lines inside this file.

- [x] Split by procedure family: `rollAllInitiative`, `advanceTurn`,
      `addCombatLog` / `listCombatLogs`, `attemptAttack`, and the combat-chat
      broadcast cluster.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep concurrency-sensitive tests explicit and isolated.

Definition of done: a failure in encounter-combat router behavior points to a
focused file rather than a 1,400+ line suite. Closed: `encounter-combat.test.ts`
dropped from ~1,497 lines to ~775 (attemptAttack only), with the rest moved
into `encounter-combat-initiative.test.ts` (~105),
`encounter-combat-turn.test.ts` (~199), `encounter-combat-logs.test.ts` (~343),
and `encounter-combat-chat.test.ts` (~177). `createEncounterWithMonsters`,
`rollAllInitiative`, `getEncounterDetail`, and `activateEncounter` lifted into
a new `encounter-combat-test-helper.ts` (~91 lines) so the encounter helper
file stays focused on encounter-shape setup.

### DX7.1e Auth Router Test Split

Target: `packages/server/src/routers/auth.test.ts` (~806 lines, 8 nested
describes: `register`, `login`, `refresh`, `logout`, `me`, `updateProfile`,
`changePassword`, `deleteAccount`).

- [x] Split by procedure family along the existing nested-describe seams.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep token/cookie boundary coverage explicit (refresh-cookie behavior,
      bearer-token issuance) so it is not lost during the split.

Definition of done: a failure in auth router behavior points to a focused
file rather than an 800+ line suite. Closed: `auth.test.ts` dropped from ~806
lines to ~240 (register only, including the timing side-channel guard with its
constants in-place); the rest split into `auth-login.test.ts` (~129 incl. login
timing guard), `auth-refresh.test.ts` (~87), `auth-logout.test.ts` (~57),
`auth-me.test.ts` (~46), `auth-update-profile.test.ts` (~96),
`auth-change-password.test.ts` (~103), and `auth-delete-account.test.ts`
(~160). No new builders: the split files import the existing auth test helpers
and constants they need directly, including `createTestUser`, `loginUser`,
`extractCookieValue`, `authHeader`, `TEST_PASSWORD`, and
`REFRESH_COOKIE_NAME` where applicable.

### DX7.1f Encounter Helpers Test Split

Target: `packages/server/src/utils/encounter-helpers.test.ts` (~747 lines,
8 top-level describes spanning builders, auth/lifecycle helpers, and
participant ordering mutations). DX5.2 already moved read-shape mapper
coverage into `packages/server/src/utils/encounter-query.test.ts`.

- [x] Split by helper family — at minimum, separate the builder tests
      (`buildParticipantUpdateData`, `buildCharacterStatsUpdate`,
      `buildAddParticipantData`) from auth/lifecycle tests
      (`assertEncounterDm`, `validateCharacterForCampaign`,
      `activateEncounter`) and participant ordering mutation tests
      (`lockTurnIndexForRemoval` / `reindexSortOrders`).
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.

Definition of done: a failure in an encounter helper points to a focused file
rather than a broad shared suite. Closed: `encounter-helpers.test.ts` dropped
from ~747 lines to ~195 (pure builder tests for `buildParticipantUpdateData`,
`buildCharacterStatsUpdate`, `buildAddParticipantData` only); auth and
lifecycle tests moved into `encounter-helpers-auth-lifecycle.test.ts` (~281,
covers `assertEncounterDm`, `validateCharacterForCampaign`, and
`activateEncounter`); sort-order tests moved into
`encounter-helpers-ordering.test.ts` (~70, covers `getMaxSortOrder` only);
the existing `encounter-participant-helpers.test.ts` remains the owner for
`lockTurnIndexForRemoval` + `reindexSortOrders` DB coverage. No new shared
builders: the split files inline only the small Prisma-direct setup helpers
they need, matching the existing pattern in `campaign-auth.test.ts` /
`encounter-combat-auth.test.ts`.

### DX7.1g Spell Casting Service Test Split

Target: `packages/server/src/services/spell-casting/spell-casting.test.ts`
(~975 lines, 3 top-level describes: `castNonCombatSpell`, `dropConcentration`,
`castCombatSpell`).

- [x] Split by service entry point along the existing top-level describes.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep concentration semantics covered explicitly across the split.

Definition of done: a failure in spell-casting service behavior points to a
focused file rather than a 900+ line suite. Closed: `spell-casting.test.ts`
dropped from ~975 lines to ~648 (castCombatSpell only). The other two service
entry points moved to `spell-casting-non-combat.test.ts` (~297, covers
`castNonCombatSpell` including ritual, cantrip, slot, and concentration
branches) and `spell-casting-drop-concentration.test.ts` (~53, covers
`dropConcentration`). Concentration semantics stay covered explicitly across
the split: leveled concentration, ritual concentration, and prior-spell
replacement live in the non-combat file; combat-side concentration set lives
in the combat file; and clear/no-op-when-not-concentrating lives in the
drop-concentration file. No new shared builders: each split file imports the
existing `setupSpellTestContext` / `setupEncounterTestContext` helpers, and the
combat-encounter setup helpers (`makeMonsterEncounter`,
`makeCharacterCasterEncounter`, `setupWizardCharacter`) stay inline in
`spell-casting.test.ts` because no other test file needs them.

### DX7.1h Combat Actions Service Test Split

Target: `packages/server/src/services/combat-actions/combat-actions.test.ts`
(~952 lines, 3 top-level describes: `executeAttack`, `advanceTurn`,
`rollAllInitiative`).

- [x] Split by service entry point along the existing top-level describes.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep race-sensitive behavior (turn advancement, initiative) covered
      explicitly across the split.

Definition of done: a failure in combat-actions service behavior points to a
focused file rather than a 900+ line suite. Closed: `combat-actions.test.ts`
dropped from ~952 lines to ~500 (executeAttack only). Turn-advance coverage
moved to `combat-actions-advance-turn.test.ts` (~360), including the compound
CAS, mid-round race, round-boundary race, and condition-tick race cases.
Initiative coverage moved to `combat-actions-roll-initiative.test.ts` (~115).
No shared builders were added; each split file keeps only the narrow encounter
setup it consumes.

### DX7.1i Level Up Service Test Split

Target: `packages/server/src/services/level-up/level-up.test.ts` (~930 lines,
one top-level describe with 10 nested clusters: HP methods, level choice
audit, class features, sequential/error cases, subclass selection, ASI/feats,
multiclass, sorcerer metamagic, concurrency, and the "Repro A" concurrency
case).

- [x] Split by nested describe cluster — at minimum, isolate the concurrency
      and "Repro A" clusters from the per-feature wizard coverage.
- [x] Extract only the narrow builders needed for the moved tests, following
      the DX7.0c inventory.
- [x] Keep the concurrency reproductions explicit so they remain easy to find.

Definition of done: a failure in level-up service behavior points to a focused
file rather than a 900+ line suite, and concurrency repros stay obvious.
Closed: `level-up.test.ts` dropped from ~930 lines to ~199 (HP methods, audit,
class-feature grant, and sequential/error coverage). Subclass, ASI/feat, and
multiclass/sorcerer coverage moved to focused sibling specs; concurrency
coverage moved to `level-up-concurrency.test.ts` (~197), including the base
double-level-up race, concurrent subclass-pick CAS race, and explicit "Repro A"
updateStats/ASI races. Shared setup lives in the narrow
`level-up-test-helper.ts` (~104).

### DX7.2 Fixture Builder Cleanup

- [x] Use the DX7.0c inventory and DX7.1 extractions to remove remaining
      broad fixture dumps.
- [x] Introduce or finish narrow builders for common character, encounter,
      campaign, and map states.
- [x] Keep default fixtures minimal and override-driven.

Definition of done: new tests can set up realistic state with fewer unrelated
fields. Closed: `packages/client/src/test/fixtures-encounter.ts` now exports
`buildParticipant`, `buildEncounterDetail`, and `buildEncounterSummary`; the
six pre-built `TEST_*_ENCOUNTER` constants and `TEST_ENCOUNTERS` summary list
are now expressed via builder calls so each entry only spells out the fields
it actually varies. `packages/client/src/test/fixtures-srd.ts` exports
`buildSpecies`, `buildSubspecies`, `buildTrait`, `buildClass`,
`buildClassFeature`, `buildSubclass`, `buildBackground`, `buildEquipmentOption`,
and `buildFeat`; the `TEST_SPECIES`, `TEST_CLASSES`, `TEST_BACKGROUNDS`,
`TEST_SUBCLASSES`, and `TEST_FEATS` arrays are now composed of builder calls
instead of fully spelled-out object literals. `TEST_CHARACTER_DETAIL` and the
secondary fixtures stay untouched per the DX7.0c inventory — they were already
override-driven.

## Phase DX8: Production Safety

Goal: add safety checks whose value increases as the project approaches real
data and larger contributor volume.

### DX8.1a Prisma Migration Safety Scanner

The repo already contains migrations that exercise the patterns this scanner
should recognize: `20260409120000_add_monster_spells_table` drops
`monsters.spellcasting` after a backfill, and
`20260408223838_convert_string_fields_to_enums` performs `ALTER COLUMN ... TYPE`
narrowing. Treat these as motivating examples and known intentional-risk
precedent: the scanner should surface them with actionable review guidance,
not silently treat the pattern as safe.

- [x] Add a migration preflight script that scans new Prisma SQL migrations for
      destructive operations such as column/table drops, type narrowing, and
      adding required columns without defaults.
- [x] Make the script warn with exact migration filenames and reviewed-risk
      guidance before considering any blocking mode.
- [x] Add focused tests for destructive-operation detection and intentional-risk
      migration precedent.

Definition of done: risky migration operations are detected locally with
actionable filenames and tested signal quality. Closed: `bun run
db:migration-safety` (`scripts/migration-safety-scan.sh`) walks
`packages/server/prisma/migrations/` (or any path passed as an argument), and
emits a `WARN: <file>:<line> — <rule>` per finding plus one-line risk guidance
and the offending statement, for the four detection rules `DROP TABLE`,
`DROP COLUMN`, `ALTER COLUMN ... TYPE`, and `ADD COLUMN ... NOT NULL` without
a same-line `DEFAULT`. The scanner is warn-only (always exits 0); DX8.1b
decides whether and how to gate. `scripts/tests/test-migration-safety-scan.sh`
covers each detection rule, the safe add-nullable + backfill + SET NOT NULL
counter-pattern, sandbox aggregation, and the two intentional-risk
precedents already in the migration history
(`20260408223838_convert_string_fields_to_enums` surfaces all six
`ALTER COLUMN ... TYPE` clauses; `20260409120000_add_monster_spells_table`
surfaces the `DROP COLUMN "spellcasting"`).

### DX8.1b Prisma Migration Safety Integration

- [x] Once DX8.1a's scanner produces no false positives across the existing
      migration history, surface it through `doctor` first; promote to CI
      or a pre-push hook only if local visibility proves insufficient.
- [x] Document accepted escape hatches for intentional destructive migrations.

Definition of done: risky migration operations are visible during review before
they can surprise a shared or production-like database. Closed: `doctor` now
runs `bash scripts/migration-safety-scan.sh` as a `migration safety` section
between the eslint-disable register and the summary, so doctor surfaces new
destructive operations as `WARN:` lines and a clean scan as a single `PASS:`
line. Acknowledgement allowlist at
`packages/server/prisma/migrations/.safety-acknowledged` (overridable for
tests via `MUSI_MIGRATION_ALLOWLIST=...`); listed migrations emit `INFO: ...
(acknowledged: <reason>)` instead of `WARN:` so already-reviewed history does
not re-flag every doctor run. The two intentional-risk precedents
(`20260408223838_convert_string_fields_to_enums`,
`20260409120000_add_monster_spells_table`) ship in the allowlist on landing.
Escape-hatch design captured in `docs/agent_notes/decisions-build.md`. Scanner
remains warn-only; promotion to a hard gate (CI / pre-push) is deferred until
local visibility proves insufficient.

### DX8.2a Structured Logging Contract

Pino is wired at the Fastify level (`packages/server/src/app.ts`), so HTTP
requests are auto-logged, but no router, service, or authz helper emits
business-event logs. The campaign/character/encounter-combat auth helpers
in `packages/server/src/utils/` decide allow/deny silently, and hot
mutation paths (auth login/refresh, character/encounter writes, socket
broadcasts) do the same. That makes incident response rely on stack
traces rather than a structured trail.

- [x] Define a small set of structured log fields (event, actor,
      campaignId/encounterId where applicable, outcome) and document them
      next to the pino setup in `app.ts`.
- [x] Define redaction and volume rules: never log access/refresh tokens,
      cookies, raw request bodies, or whisper content; keep hot paths to one
      business-event log per boundary.

Definition of done: business-event logs have a documented field contract,
redaction rules, and volume budget. Closed: `packages/server/src/app.ts` now
documents the Pino business-event contract next to logger setup: stable
`event`, narrow `actor`, relevant scope ids, `outcome`, and optional bounded
`reason` code. Logger config also redacts sensitive tRPC query parameters from
request log URLs and includes redaction paths for common token, cookie, raw
body/input, and chat/whisper content fields; `app.test.ts` covers the URL
redaction helper. Hot paths are limited to one business-event log at the
request, mutation, authz, or broadcast boundary.

### DX8.2b Structured Logging Context Plumbing

- [x] Add the minimal request-logger plumbing needed by auth/authz helpers.
- [x] Avoid forcing transaction-only helpers to depend on Fastify types; pass
      a narrow logger interface at decision boundaries.
- [x] Keep existing request behavior and tRPC context shape stable for callers
      outside the logging path.

Definition of done: the server context can pass a correlated, narrowly typed
logger to decision boundaries. Closed: `createContext()` now exposes a narrow
request logger backed by Fastify's per-request logger, authz helpers accept an
optional `AuthzLogContext` without importing Fastify types, and encounter-combat
plus upload decision boundaries can thread the correlated logger forward
without changing current auth behavior.

### DX8.2c Authz Decision Logs

- [x] Emit allow/deny logs from `campaign-auth.ts`, `character-auth.ts`,
      and `encounter-combat-auth.ts` at the decision boundary, using the
      Fastify request logger so requests stay correlated.
- [x] Preserve intentional `NOT_FOUND` responses for character ownership/access
      mismatches.
- [x] Add a focused test that the allow/deny path emits a log with the
      expected shape, so the contract doesn't silently drift.

Definition of done: campaign, character, and encounter-combat allow/deny
decisions are reconstructable from correlated logs without changing auth
semantics. Closed: `request-logger.ts` now exposes `logAuthzDecision` and a
typed `AuthzLogPayload`; `campaign-auth.ts` emits `authz.campaign.member` /
`authz.campaign.dm`, `character-auth.ts` emits `authz.character.owner` /
`authz.character.access`, and `encounter-combat-auth.ts` emits
`authz.encounter.combatant` at the decision boundary. Inner helpers were
refactored (`fetchCampaignMembership`, `verifyPlayerCanAttack`) so each
boundary emits exactly one allow/deny log per call. Reason codes:
`campaign_not_found`, `not_member`, `not_dm`, `character_not_found`,
`not_owner`, `not_owner_or_dm`, `encounter_not_found`,
`participant_not_in_encounter`, `participant_not_character`,
`not_attacker_owner`. NOT_FOUND character-access responses are unchanged;
deny logs add audit trail without leaking ownership through the response
shape. Contract coverage lives next to each helper
(`campaign-auth.test.ts`, `character-auth.test.ts`,
`encounter-combat-auth.test.ts`) backed by a shared `makeFakeLogger` test
helper.

### DX8.2d Mutation Boundary Logs

- [x] Emit one structured log per mutation boundary on the hottest paths
      (auth login/refresh, character create/update, encounter
      create/state transitions). Keep volume bounded — one log per
      committed mutation, not per inner call.
- [x] Include socket-broadcast outcomes only at the boundary where the emit is
      attempted; do not log per inner helper call.

Definition of done: an incident can be reconstructed from logs alone
across the auth/authz/mutation boundary without turning hot paths into
high-volume log streams. Closed: `request-logger.ts` now exposes
`logMutation` (info on success, warn on failure) and `logBroadcast` (info
on success/skipped) with typed `MutationLogPayload` /
`BroadcastLogPayload`. Hot mutation boundaries emit exactly one
business-event log per committed call: `auth.login` and `auth.refresh` in
`routers/auth.ts`; `character.create`, `character.updateStats`, and
`character.adjustHp` in `routers/character.ts`; `encounter.create` and
`encounter.state.transition` in `routers/encounter.ts`. Failures use a
low-cardinality reason code (`invalid_credentials`, `invalid_refresh`,
`invalid_transition`); successes carry `actor` plus the relevant scope
ids. Socket-broadcast outcomes are logged only at the boundary where the
emit is attempted: registry-owned broadcasts log through `broadcast()` and
`broadcastToUsers()` in `socket/broadcast-registry.ts`, with a required
per-event `logFields(payload)` scope extractor. Per-family helpers pass the
optional logger through to that registry boundary. `emitCharacterUpdate`
keeps its targeted pre-registry `no_campaign` skip log because the campaign
membership lookup happens before the registry call. Contract tests live in
`utils/request-logger.test.ts`, `routers/mutation-logging.test.ts`,
`socket/broadcast-registry.test.ts`, and `utils/character-campaign.test.ts`.
