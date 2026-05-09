# Fixture Builder Inventory

DX7.0c deliverable for the DX7.1 test splits. Identifies which fixture files
have grown into broad object dumps, sketches the narrow builder shapes the
DX7.1 splits will reach for, and parks the fixtures that should stay
unchanged.

The inventory itself is recoverable via `wc -l packages/**/test/fixtures-*.ts`
and re-grepping for the exported symbols. What is durable here is the
outlier classification, the per-leaf builder targets, and the explicit list
of fixtures we are deliberately leaving alone.

Re-list before reusing this inventory:

```sh
wc -l packages/client/src/test/fixtures-*.ts
wc -l packages/server/src/test/*.ts
```

## Outliers — broad object dumps

These are the fixture files that have grown past a small, override-driven
default. They are the ones DX7.1 should carve narrow builders out of.

### `packages/client/src/test/fixtures-encounter.ts` (460 lines)

One `EncounterSummary[]` plus six `EncounterDetail` constants, each
spelling out a full participant list inline:

- `TEST_ENCOUNTERS` — three `EncounterSummary` entries (setup / active / resolved).
- `TEST_ENCOUNTER_DETAIL` — three-participant setup encounter.
- `TEST_ACTIVE_ENCOUNTER` — three-participant active encounter with
  initiative rolled.
- `TEST_COMBAT_ENCOUNTER` — three-participant active encounter with
  conditions, low/zero HP, and death-save state.
- `TEST_PAUSED_ENCOUNTER` — two-participant paused encounter.
- `TEST_RESOLVED_ENCOUNTER` — single-participant resolved encounter.
- `TEST_RESOLVED_ENCOUNTER_WITH_XP` — five-participant resolved encounter
  with `characterLevel` / `challengeRating` set for XP math.

Reusable mechanic already in place: a small `p()` participant-merge helper
plus a `DEFAULTS` `Pick<EncounterParticipant, …>` object covering the
"always zero / always null" fields. That defaults block stays — it is the
narrow seam the new builders should compose with.

Why it matters for DX7.1: the client tests in DX7.1c (`initiative-tracker`)
and the encounter card / panel tests already lean on these constants for
both presentation and turn-highlight assertions. Splitting tests blindly
will widen the dependency surface unless they go through narrow builders.

### `packages/client/src/test/fixtures-srd.ts` (347 lines)

Five frozen `as const` arrays:

- `TEST_SPECIES` (3 entries) — full `traits` and `subspecies` arrays inline.
- `TEST_CLASSES` (3 entries) — full `features` and `subclasses` arrays
  inline, including subclass descriptions.
- `TEST_BACKGROUNDS` (2 entries) — full `equipmentOptions` arrays inline.
- `TEST_SUBCLASSES` (5 entries) — caster type and ability boundary fields.
- `TEST_FEATS` (2 entries) — minimal but still a fixed array.

Why it matters for DX7.1: each consumer needs a narrow slice (e.g.
`subclass-step.test.tsx` already inlines its own three-entry
`TEST_SUBCLASSES` with just `id` / `name` / `description` because the
shared fixture is over-spec'd for that test). Builders should expose only
the fields the consumer renders against.

## Secondary fixtures — leave defaults, prefer overrides

These files are larger than minimal but still composable: they expose a
default object plus consumer overrides via the surrounding test, and
nothing else in DX7.1 needs to slice them differently.

- `fixtures-character.ts` (145) — `TEST_CHARACTER_DETAIL` is referenced by
  ~26 tests; it is the canonical "level 3 fighter Thorn" baseline. Leave
  it alone; a level-up split that needs a different shape should override
  via spread, not fork the fixture.
- `fixtures-monster.ts` (218), `fixtures-spell.ts` (179),
  `fixtures-map.ts` (108), `fixtures-homebrew.ts` (128),
  `fixtures-campaign.ts` (143) — all sit between 100 and 220 lines but
  have one or two top-level constants. Builder extraction would not pay
  off in the DX7.1 scope.
- All remaining `packages/client/src/test/fixtures-*.ts` (under 100 lines)
  — leave untouched.
- `packages/server/src/test/fixtures.ts` (59) — already a builder layer
  (`createTestUser`, `createTestSession`, `getTestPasswordHash`). DX7.1
  splits keep importing it.
- `packages/server/src/test/character-fixtures.ts` (30) — already a
  builder (`createCharacter` plus `VALID_CREATE_INPUT`).

## Server test helpers — context builders, already narrow enough

Server-side setup is not a "fixture file" problem. The setup-context
helpers live next to the broader `fixtures.ts` and already follow the
narrow-builder shape DX7.1 wants:

- `setupEncounterTestContext` (`encounter-test-helper.ts`) — DM + player +
  campaign + character.
- `setupSpellTestContext` (`spell-test-helper.ts`) — wizard character with
  owner / other tokens.
- `setupMapTestContext` (`map-test-helper.ts`) — DM + player + campaign.
- `setupInventoryTestContext` (`inventory-test-helper.ts`) — owner /
  other + minimal SRD seed.
- `setupChat`, `setupNote`, `setupNpc`, `setupHomebrew` test helpers.

DX7.1a / d / b / e / f / g / h / i should keep importing these and lift
in-file `async function makeXxxEncounter(...)` helpers next to them
instead of forking new context shapes.

`encounter-test-helper.ts` is 163 lines today; DX7.1a / b / d / f together
target lifting roughly six helpers into it. If the file approaches the
~300-line range during the splits, peel `encounter-combat-test-helper.ts`
off rather than letting one file own every encounter-shaped builder — that
decision belongs to whichever DX7.1 leaf trips the threshold, not to this
inventory.

## DX7.1 builder targets

Each leaf below names the inline helpers the split will lift, and the
intended landing site. DX7.1 should land each builder in the smallest
file the moved tests will share — typically the existing
`*-test-helper.ts`.

### DX7.1a Encounter Router Test Split (`encounter.test.ts`, 2,328)

- Lift `setupActiveBattle` (line 1882) and `setupActiveWithLog` (2024)
  into `encounter-test-helper.ts` as `buildActiveBattle()` /
  `buildActiveBattleWithLog()` so the combat-log split can share them.
- Otherwise the file already leans on `setupEncounterTestContext`,
  `createEncounter`, `addParticipant`, `createActiveEncounter`,
  `authHeader`, `trpcData`. No new shared builder needed.

### DX7.1b Map Router Test Split (`map.test.ts`, 1,134)

- Lift the inline `createPlayerCharacter` (line 881) into
  `map-test-helper.ts` as `assignPlayerCharacter(ctx)` so the token-move
  split can share it.
- Keep `setupMapTestContext`, `createMap`, and `MapResult` where they are.

### DX7.1c Remaining Client Test Splits

`initiative-tracker.test.tsx`, `use-character-stats.test.tsx`,
`use-canvas-input.test.ts`. The fixture pressure is concentrated in
`fixtures-encounter.ts`:

- Add narrow builders next to `fixtures-encounter.ts` (or in a new
  `test/builders/encounter.ts`) that compose the existing `p()` helper
  with the existing `DEFAULTS` block:
  - `buildEncounterDetail({ state, round?, currentTurnIndex?, mapId? }, participants)`.
  - `buildParticipant({ name, type, characterId?, monsterId?, … })` —
    re-exporting the existing `p()` mechanic with a public name.
  - `buildEncounterSummary({ state, name, participantCount?, mapId? })`.
- Keep `TEST_ACTIVE_ENCOUNTER` / `TEST_COMBAT_ENCOUNTER` /
  `TEST_PAUSED_ENCOUNTER` / `TEST_RESOLVED_ENCOUNTER` exported as
  builder-composed defaults during the split so existing imports keep
  working; DX7.2 cleanup can decide whether to delete the constants.
- For `use-character-stats.test.tsx`, no new builder — the test reuses
  `TEST_CHARACTER_DETAIL` and overrides per-test inline.
- For `use-canvas-input.test.ts`, no new fixture builder — the file
  already factors `createMockStage` and `renderCanvasInput` locally; the
  DX7.1c split moves them with their tests.

### DX7.1d Encounter Combat Router Test Split (`encounter-combat.test.ts`, 1,497)

- Lift inline `createEncounterWithMonsters`, `rollInitiative`,
  `getEncounterDetail`, and `activateEncounter` (lines 41–95) into
  `encounter-test-helper.ts`. The `attemptAttack` slice's
  `createActiveEncounterWithMonsters` (634) is a one-liner over those
  helpers — keep it inline in the moved file.
- Lift `setTurnToParticipant` (904) only if more than one of the split
  files needs it; otherwise keep it next to the test that uses it.

### DX7.1e Auth Router Test Split (`auth.test.ts`, 806)

- No new builders. The file already uses `createTestUser`, `loginUser`,
  `extractCookieValue`, `authHeader`, `TEST_PASSWORD`, and
  `REFRESH_COOKIE_NAME`. Keep the timing-side-channel regression cluster
  (register hash floor) intact in its own file with its constants
  in-place.

### DX7.1f Encounter Helpers Test Split (`encounter-helpers.test.ts`, 747)

- The inline `seedMinimalSrd`, `createCampaign`, `addMember`,
  `createEncounter` (lines 23–80) duplicate logic also present in
  `inventory-test-helper.ts`. Lift them into a small
  `encounter-helpers-test-helper.ts` or extend `encounter-test-helper.ts`
  with a `seedMinimalSrd` + `createCampaign` pair so the auth/lifecycle
  and participant-ordering splits share one seed path.
- Keep the builder tests (`buildParticipantUpdateData`,
  `buildCharacterStatsUpdate`, `buildAddParticipantData`) calling the
  helpers directly — no fixture object to extract there.

### DX7.1g Spell Casting Service Test Split (`spell-casting.test.ts`, 975)

- Lift `makeMonsterEncounter` (385) and `makeCharacterCasterEncounter`
  (476), plus the `setupWizardCharacter` (444) Prisma upgrade, into
  `spell-test-helper.ts` as `buildMonsterCasterEncounter` /
  `buildCharacterCasterEncounter` / `upgradeToWizard`.
- Keep the `FIREBALL` / `ACID_SPLASH` / `ALARM` / `DETECT_MAGIC` /
  `ALTER_SELF` / `FIRE_BOLT` spell-id constants where they are; they
  are local naming, not shared fixture state.

### DX7.1h Combat Actions Service Test Split (`combat-actions.test.ts`, 952)

- Lift `makeMonsterEncounter` (42) and `makeCharacterTargetEncounter`
  (99) into `encounter-test-helper.ts` (or a new
  `combat-actions-test-helper.ts` if shape drift forces it). Both expose
  `MonsterEncounter` / `CharacterTargetEncounter` interfaces — keep those
  alongside the builders so the moved tests can `import type`.
- Keep `customAttackInput` (161), `expectOneFulfilledOneConflict` (516),
  and the concurrency `makeThreeMonsterEncounter` (528) /
  `makeTwoMonsterEncounter` (573) inline with the concurrency test.
- Keep the `lowRng`, `HIGH_AC`, `LOW_AC`, `HIGH_ATTACK_BONUS` constants
  in their tests — they are local tuning, not shared state.

### DX7.1i Level Up Service Test Split (`level-up.test.ts`, 930)

- Lift `BASE_INPUT`, `MULTICLASS_SCORES`, `createFighterCharacter`, and
  `levelTo` (lines 24–78) into a `level-up-test-helper.ts`. The
  per-cluster `levelToAsi` (479, 794) and `createSorcerer` (665) are
  one-liners on top — keep them inline in their split file.
- Keep `createDeferred` and `waitForQueryBlockedBy` (80–116) with the
  concurrency cluster; they have no other consumer.

## DX7.2 cleanup hooks

After DX7.1 lands, DX7.2 should:

- Decide whether `fixtures-encounter.ts`'s pre-built `TEST_ACTIVE_*` /
  `TEST_COMBAT_*` / `TEST_PAUSED_*` / `TEST_RESOLVED_*` constants stay or
  are inlined into the moved tests via the builders introduced in
  DX7.1c.
- Decide the same for `fixtures-srd.ts`: shrink each `as const` array to
  a single canonical entry plus a builder, or delete the array entirely
  if every consumer has narrowed.
- Pick up any inline helper from DX7.1a–i that ended up shared by more
  than one split file but did not move during the split itself.

## What stays untouched

- `fixtures.ts` (server) — already a builder layer.
- `character-fixtures.ts` (server) — already a builder.
- All client fixture files under 200 lines that are referenced from a
  single test surface (`fixtures-note`, `fixtures-combat-log`,
  `fixtures-npc`, `fixtures-magic-item`, `fixtures-chat`,
  `fixtures-inventory`, `fixtures-map`, `fixtures-homebrew`,
  `fixtures-campaign`).
- `TEST_CHARACTER_DETAIL` — too widely shared (~26 callers) to break in
  DX7.1; override in tests, do not fork.
