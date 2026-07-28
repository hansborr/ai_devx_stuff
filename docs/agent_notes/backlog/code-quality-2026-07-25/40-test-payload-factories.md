# 40. Test inputs are inline literals and positional tuples instead of typed factories, and the suites holding them outgrew their modules

Status: Proposed — not promoted
Theme: typed test fixtures · Area: tests · Severity: medium · Size: XL (an epic — split into three leaves before scheduling; see Scope / caveats)

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Every package in this repo already has a home for shared test material —
`packages/shared/src/test/parse-helpers.ts`, `packages/server/src/test/` (~20
helper modules including `encounter-test-helper.ts` and
`rest-test-helper.ts`), `packages/client/src/test/`. The convention exists and is
documented. It just is not being reached for. The result is a consistent, single
failure mode across three packages and the lint-ratchet tool: **test input is
written as a literal at the point of use, and test infrastructure is copied into
the next sibling file rather than promoted.**

Concretely, a 21-to-22-field monster payload is retyped as a fresh literal 13
times in one shared schema suite; four helper functions are duplicated verbatim
across sibling server router specs and a fifth is a near-copy; the client's
character fixture is built with eight inline casts and then double-cast at seven
call sites because it was never made contract-checked; and the lint-ratchet
baseline suite passes an eight-position, six-optional tuple around so callers
write `[[path, 1, 7, undefined, undefined, undefined, undefined, fingerprint]]`.

The cost is not aesthetic. When the monster schema gains a required field, 13
literals must be edited by hand and the diff hides which one is actually under
test. When a helper's semantics change, the copies drift silently. When
`CharacterDetail` gains a field, the client fixture keeps compiling because
`as unknown as` erases the check, and the tests keep passing against a shape
production no longer has.

Two suites have additionally grown past the module they cover:
`packages/shared/src/schemas/homebrew.test.ts` (1215 lines) tests two production
modules because `homebrew-inputs.test.ts` was never created, and
`tools/lint-ratchet/src/kernel/baseline.test.ts` (2761 lines) holds nine
top-level describes over one facade whose owning modules are already separate
files in the same directory.

## Evidence

- `packages/shared/src/schemas/homebrew.test.ts:251-392` — **five** consecutive
  `it`s (`ability scores above 30` `:251`, `maxHp above MAX_HP` `:278`,
  `initiativeModifier outside ±30` `:306`, `xp above SRD CR-30 max` `:335`,
  out-of-range spellcasting DC/attack bonus `:363`), each opening with its own
  `const base = { … }` restating the same 21-field monster shape and differing in
  one value. ~140 lines where `buildMonsterPayload(overrides)` + `it.each` would
  need ~25. The immediately preceding `it` at `:246` is **not** one of them — it
  is the deliberate `validateHomebrewData("monster", { name: "Incomplete" })`
  missing-fields case and must stay a bare partial literal.
- `validateHomebrewData("monster", …)` appears 18 times file-wide, but only **13**
  full monster payloads are actually written out: eight inline literals (`:145`,
  `:177`, `:219`, `:647`, `:675`, `:703`, `:731`, `:759`) plus the five `const base`
  literals above (passed directly at `:275`, `:303`, `:331`, `:360`, `:387`). The
  remaining five call sites reuse an existing `base` by spread (`:332`, `:388`,
  `:389`, `:390`) or are the intentional partial at `:247`. Thirteen literals is
  the real edit cost of a schema change, not eighteen.
- **The builder pattern this leaf proposes already exists in the repo**, one
  package over: `packages/server/src/routers/homebrew-import.test.ts:40` defines
  `buildMonsterData(overrides)` over the same monster shape, and `:29` defines
  `buildFeatData(overrides)`. Step 5 is adopting a local precedent, not inventing
  a convention.
- `packages/shared/src/schemas/homebrew.ts:154` — `const monsterDataSchema =
  z.object({ … })` is module-private. The exported `HOMEBREW_DATA_SCHEMAS`
  (`:225`) is typed `Record<HomebrewEntryType, z.ZodType>`, whose output is
  `unknown`, and `validateHomebrewData` (`:247`) takes `data: unknown`. There is
  no exported handle on the monster input shape today.
- `packages/shared/src/schemas/homebrew.test.ts:10-36` — imports both
  `./homebrew.js` and `./homebrew-inputs.js`. No `homebrew-inputs.test.ts` exists
  on disk, so the input-schema describes at `:817`, `:831`, `:844`, `:865`,
  `:902`, `:1095`, `:1167` are homeless tenants in the wrong file.
- `packages/shared/src/test/parse-helpers.ts` — the existing shared-package test
  home a monster builder would live in.
- `packages/server/src/routers/encounter-combat-map.test.ts:32` ⇔
  `packages/server/src/routers/encounter-map.test.ts:31` — `createMapForCampaign`,
  byte-identical.
- `packages/server/src/routers/homebrew-export.test.ts:22` ⇔
  `packages/server/src/routers/homebrew-import.test.ts:29` — `buildFeatData`,
  byte-identical.
- `packages/server/src/routers/encounter-map.test.ts:545` ⇔
  `packages/server/src/routers/map-token.test.ts:333` — `readOrigin`. The bodies
  differ only in indentation (the `encounter-map.test.ts` copy is nested one
  block deeper), so a naive `diff` will not call them equal. Each returns a
  locally declared `interface OriginColumns` — duplicated at
  `encounter-map.test.ts:531-536` and `map-token.test.ts:294-299` — and each file
  carries an identical `CLEARED_ORIGIN` const beside it (`:538` / `:301`).
- `packages/server/src/routers/encounter-map.test.ts:770-776` ⇔
  `packages/server/src/routers/map-token.test.ts:417-423` — `errorOf`, a
  seven-line tRPC-error-envelope parser, identical down to its
  `type-assertion-boundary: test` marker.
- `packages/server/src/routers/encounter-hp-attribution.test.ts:46` ⇔
  `packages/server/src/routers/encounter-combat-concurrency.test.ts:41` —
  `createActiveEncounterWithPlayerAndMonster`. **Not** a clean duplicate. The two
  share the create-encounter / two-`addParticipant` / two-`setInitiative` /
  `transitionState` body and differ in the encounter name (`"HP Attribution"` vs
  `"Race Cond"`), but the concurrency copy then adds a further ~15 lines
  (`encounter-combat-concurrency.test.ts:91-107`): a `GET /trpc/encounter.get`,
  a `sortOrder` sort of `detail.participants`, and two `find`s, returning the
  ids read back from the persisted row rather than the ids `addParticipant`
  returned. Same values, but a real extra round-trip that the concurrency suite
  may be relying on as an implicit persistence barrier.
- `packages/server/src/test/encounter-test-helper.ts:131-175` —
  `createAndActivateEncounter`, a module-private generic substrate that already
  does create-encounter / `addParticipant` loop / `setInitiative` loop /
  `transitionState` and backs `createActiveEncounter` (`:181`),
  `buildActiveBattle` (`:216`), `makeActiveMonsterEncounter` (`:276`), and
  `buildActiveBattleWithLog` (`:314`).
- `packages/server/src/test/MODULE.md:64-70` — "generic encounter setup + the
  active-battle builders live in `encounter-test-helper.ts`; builders/wrappers
  specific to the `encounterCombat` router (`createEncounterWithMonsters`,
  `rollAllInitiative`, `activateEncounter`) live in
  `encounter-combat-test-helper.ts`". `:40-47` is the encounter-builder table;
  `:58-60` requires new builders to be added to it.
- `packages/client/src/test/fixtures-character.ts:4-12` — a
  `type-assertion-boundary: test` block comment covering eight inline casts;
  `:113` is `conditions: [] as CharacterCondition[]`, with the same pattern at
  `spellSlots` (`:114`), `spells`, `features`, `levelChoices`,
  `weaponMasteries`, `metamagics`, and `campaignId: null as string | null` at
  `:29`.
- `TEST_CHARACTER_DETAIL as unknown as CharacterDetail` — **seven** double casts
  across seven files, one apiece. Six are under
  `packages/client/src/components/vtt/drawer/`: `cast-rail.test.tsx:17`,
  `cast-rail-slot-picker.test.tsx:12`, `cast-rail-concentration.test.tsx:14`,
  `tabs/stats-tab.test.tsx:15`, `tabs/spells-tab.test.tsx:15`,
  `tabs/actions-tab.test.tsx:27`. The seventh is outside that subtree:
  `packages/client/src/components/sheet/asi-step.test.tsx:49`.
- `packages/shared/src/schemas/character.ts:300-313` (`characterDetailSchema`)
  and `:95-111` (`characterSchema`) — the fixture's top-level keys already match.
- `packages/server/src/services/rest-service.test.ts:131` — `makeMockContext`
  JSDoc; `:139-246` is a ~106-line mutable fake Prisma: three mutable snapshots
  (`:141-143`), hand-rolled optimistic-concurrency CAS (`:151-152`), version
  bumping (`:164`), `updateMany` dispatch by inspecting `args.where.id`
  (`:187-192`), and `rebuildTx()` (`:233`) to simulate a re-read on transaction
  retry. Driven through P2034 sequences at `:650-695`. File is 818 lines.
- `makeMockContext` has exactly one consumer — `rest-service.test.ts` itself, at
  `:233`, `:264`, `:303`, `:314`, `:324`, `:341`, `:357`, `:382`, … — and carries an
  `@typescript-eslint/explicit-function-return-type` suppression at `:139`
  because it "returns a bag of `vi.fn()` mocks plus captured state". Its return
  type is deliberately inferred and unnameable.
- `packages/server/src/test/rest-test-helper.ts` is 74 lines of **real**-database
  setup: `cleanDb()`, `createTestUser`, `mintAccessToken`, `prisma.character.create`.
  It shares no substrate with a fake-Prisma emulator.
- `packages/server/src/services/level-up/level-up-test-helper.ts` — the existing
  precedent for a service-local test helper that lives beside its service rather
  than in `packages/server/src/test/`.
- `packages/server/src/services/rest-service.test.ts:261`, `:511`, `:751` — the
  file is already cleanly partitioned into `executeShortRest`, `executeLongRest`,
  `getCharacterForRest`.
- `packages/server/src/services/rest-service.test.ts:281-285` and `:521-523` —
  deliberate comments stating the version-CAS SQL shape is intentionally not
  asserted here because it belongs to `updateCharacterStatsLocked` and is covered
  against real Postgres in `character-stats-mutations.test.ts`.
- `packages/server/src/services/rest-service.ts:173` — `planHitDiceSpend` is
  `async`, unexported, does a `tx.characterClass.findMany` read at `:176`, and
  rolls `randomInt(1, cc.class.hitDie + 1)` per hit die at `:194`.
- `tools/lint-ratchet/src/kernel/baseline.test.ts:133` — `type CurrentPathEntry =
  readonly [...]`, eight positions of which six are optional. 2761 lines total.
- `tools/lint-ratchet/src/kernel/baseline.test.ts:1650` —
  `[[messagePath, 1, 7, undefined, undefined, undefined, undefined, fingerprint]]`;
  `:233` — `[[path, perFunction.length, perFunction[0]?.line, undefined, perFunction]]`.
- `tools/lint-ratchet/src/kernel/baseline.test.ts` describes at `:564`, `:605`,
  `:1484`, `:1746`, `:2002`, `:2146`, `:2338`, `:2424`, `:2516` — nine top-level
  concerns over one facade. Named wrappers already hide the tuple at most call
  sites (`oneTestBaseline` `:200`, `maxLinesBaseline` `:208`, `complexityBaseline`
  `:224`).
- `tools/lint-ratchet/src/kernel/` — `baseline-compare.ts`,
  `baseline-update.ts`, `baseline-hash.ts`, `registry-validation.ts`,
  `rule-source.ts`, `metrics-parse.ts` already exist as separate modules, with an
  established sibling per-module test convention (`baseline-merge.test.ts`,
  `metrics-parse.test.ts`, `message-identity.test.ts`, …).
  `rule-source.test.ts` is one of those siblings and already exists: 449 lines,
  importing `./baseline.js`.
- `packages/shared/src/schemas/*-inputs.test.ts` — 16 files, 6203 lines;
  `"accepts valid input"` appears 20 times and `"rejects empty campaignId"` 12
  times across them.

## Proposed direction

Ordered smallest-payoff-per-risk first. Each step is one commit; TDD applies in
the ordinary sense here (the tests already exist — the refactor must leave the
suite green with the same number of assertions, so run the focused file before
and after each step).

1. **Make the client character fixture contract-checked.** In
   `packages/client/src/test/fixtures-character.ts`, change the declaration to
   `export const TEST_CHARACTER_DETAIL = { ... } satisfies CharacterDetail;`.
   `satisfies` supplies contextual typing, so the eight inline casts
   (`conditions`, `spellSlots`, `spells`, `features`, `levelChoices`,
   `weaponMasteries`, `metamagics`, `campaignId`) and the entire
   `type-assertion-boundary: test` block comment at `:4-12` can be deleted. Fix
   whatever nested drift `satisfies` surfaces — that is the finding's point, not
   a side effect.
2. **Delete the seven double casts.** With the fixture checked, replace
   `TEST_CHARACTER_DETAIL as unknown as CharacterDetail` with a direct reference
   in `packages/client/src/components/vtt/drawer/`: `cast-rail.test.tsx:17`,
   `cast-rail-slot-picker.test.tsx:12`, `cast-rail-concentration.test.tsx:14`,
   `tabs/stats-tab.test.tsx:15`, `tabs/spells-tab.test.tsx:15`,
   `tabs/actions-tab.test.tsx:27`; plus
   `packages/client/src/components/sheet/asi-step.test.tsx:49`, which is not
   under `vtt/`. Confirm against
   [`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker)
   that no marker remains orphaned.
3. **Promote the byte-identical server helper duplicates** into
   `packages/server/src/test/`: `buildFeatData` (→ `homebrew-test-helper.ts`),
   `readOrigin` and `createMapForCampaign` (→ `map-test-helper.ts`), and
   `errorOf` (→ `map-test-helper.ts`, or `trpc-helpers.ts` if you prefer it
   beside the other envelope readers). That is eight definition sites across five
   files (`encounter-map.test.ts` holds three of them); update all of them.
   `readOrigin` returns a locally declared `interface OriginColumns`
   (`encounter-map.test.ts:531-536`, `map-token.test.ts:294-299`) — promote the
   interface with it or the helper will not compile, and take the identical
   `CLEARED_ORIGIN` const (`:538` / `:301`) at the same time.
   `createMapForCampaign` is a two-line delegation to the already-shared
   `createMap` and `errorOf` is a `JSON.parse` wrapper, so those two are the
   weakest of the four — the same objection this leaf raises against
   `getCharacterData` in the caveats applies, except that `errorOf` also
   duplicates a `type-assertion-boundary` marker. Skipping either is a
   defensible call.
4. **Handle `createActiveEncounterWithPlayerAndMonster` separately, and only if
   the concurrency suite stays green.** The two copies are not equivalent: the
   `encounter-combat-concurrency.test.ts` version ends with an
   `encounter.get` + sortOrder re-read (`:91-107`) that the
   `encounter-hp-attribution.test.ts` version does not have. Either (a) promote
   the shared prefix to `packages/server/src/test/encounter-test-helper.ts` with
   an encounter-name parameter and leave the re-read inline in the concurrency
   suite, or (b) put the re-read behind an opt-in flag. Build it on the private
   `createAndActivateEncounter` substrate at `encounter-test-helper.ts:131-175`,
   which already does the create / `addParticipant` / `setInitiative` /
   `transitionState` sequence — the new builder should be a thin participant-shape
   wrapper like `buildActiveBattle` (`:216`), not a fifth open-coded copy. Do
   **not** promote one copy and delete the other's re-read as "identical" — that
   quietly removes a round-trip from a race-condition suite. Read
   [`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) before choosing, and run
   `encounter-combat-concurrency.test.ts` repeatedly, not once.
5. **Add a typed monster payload builder.** Put
   `buildMonsterPayload(overrides)` in `packages/shared/src/test/` beside
   `parse-helpers.ts`, modelled on the existing
   `homebrew-import.test.ts:40` `buildMonsterData(overrides)`. Typing it needs
   one production line first: export `monsterDataSchema`
   (`packages/shared/src/schemas/homebrew.ts:154`) and add
   `export type HomebrewMonsterData = z.infer<typeof monsterDataSchema>` beside
   it, then type the builder
   `(overrides?: Partial<HomebrewMonsterData>) => HomebrewMonsterData`. Do
   **not** reach for `homebrewMonsterDisplaySchema` (`:313`) — that is the
   display projection, not the input shape. If exporting the schema is unwanted,
   the builder returns `Record<string, unknown>` like `homebrew-import.test.ts:40`
   and this step buys deduplication only, not type-checking. Then collapse the
   five consecutive range-rejection `it`s at `homebrew.test.ts:251-392` into one
   `it.each` over `buildMonsterPayload({ <field>: <bad value> })`, and sweep the
   remaining eight full-payload literals (`:145`, `:177`, `:219`, `:647`, `:675`,
   `:703`, `:731`, `:759`). Leave the partial literal at `:247` alone — the
   missing-fields test is *about* the payload being incomplete.
6. **Split `homebrew-inputs` out of `homebrew.test.ts`.** Create
   `packages/shared/src/schemas/homebrew-inputs.test.ts` and move the describes at
   `:817`, `:831`, `:844`, `:865`, `:902`, `:1095`, `:1167` into it, taking the
   `./homebrew-inputs.js` import block (`:20-36`) with them. `homebrew.test.ts`
   is then a single-module suite.
7. **Replace the lint-ratchet tuple fixture with an object.** In
   `tools/lint-ratchet/src/kernel/baseline.test.ts`, turn `CurrentPathEntry`
   (`:133`) into a named object type and update the wrappers (`oneTestBaseline`
   `:200`, `maxLinesBaseline` `:208`, `complexityBaseline` `:224`) plus the
   handful of raw positional call sites such as `:233` and `:1650`. Read
   [`docs/guides/lint-ratchet.md`](../../../guides/lint-ratchet.md) first.
8. **Split the lint-ratchet baseline suite by concern**, one new file per
   existing owning module, following the established sibling convention
   (`baseline-compare.test.ts`, `baseline-update.test.ts`,
   `baseline-hash.test.ts`, `registry-validation.test.ts`, and a
   structural-parsing file). Keep every new file importing the public
   `./baseline.js` facade. Do **not** create a `rule-source.test.ts` — that
   sibling already exists
   (`tools/lint-ratchet/src/kernel/rule-source.test.ts`, 449 lines, already
   importing `./baseline.js`). Fold the `lint ratchet rule source hash binding`
   describe (`baseline.test.ts:2424`) into that existing file instead, carrying
   the fixtures it depends on (`oneTestBaseline` `:200`, `baseRatchet` `:45`,
   `fixtureRuleSourceHashes` `:115`) rather than assuming a bare cut-paste of the
   describe block will compile.
9. *(Optional, and only if a file-size limit forces it.)* If
   `rest-service.test.ts` must shrink, move `makeMockContext` (`:127-246`,
   including the `MockContextOpts` interface at `:127-129` that must travel with
   it) to a service-local
   `packages/server/src/services/rest-service.test-helper.ts`, following the
   `services/level-up/level-up-test-helper.ts` precedent. **Do not
   move it to `packages/server/src/test/rest-test-helper.ts`.** That module is 74
   lines of real-Postgres setup (`cleanDb`, `createTestUser`, `prisma.character.create`)
   and shares no substrate with a mutable fake-Prisma emulator; putting a
   single-consumer mock factory there relocates 106 lines without giving anyone a
   reusable seam, and forces its deliberately inferred, unnameable return type
   (see the `explicit-function-return-type` suppression at `:139`) across a module
   boundary. Since the helper has exactly one consumer, the honest default is to
   leave it where it is — file size is the only win here.
10. *(Optional follow-on; small.)* Sweep the
    16 `packages/shared/src/schemas/*-inputs.test.ts` files for the repeated
    `"accepts valid input"` (20 sites) and `"rejects empty campaignId"` (12 sites)
    shapes. Schedule only after step 5 proves the builder pattern.

## Scope / caveats

- **Do not annotate the client fixture as `: CharacterDetail`.** The file's own
  comment at `:5-11` says annotation "widens `stats` to nullable
  (`characterStatsSchema` is `.nullable()`) and breaks dozens of consumer tests
  that dereference `TEST_CHARACTER_DETAIL.stats.*`". That is true — of an
  annotation. It is **not** true of `satisfies`, which keeps the narrow inferred
  literal type so `.stats.id` still resolves while checking assignability. The
  comment was written against a different mechanism and does not defend the
  current design; step 1 must use `satisfies`, and the comment gets deleted, not
  respected.
- **Do not touch `packages/shared/src/schemas/encounter-inputs.test.ts`.** It
  covers a single production module — `:5-22` is one import statement pulling
  only `./encounter-inputs.js` (329 lines) — and its repeated literals are 4-6
  line schema-boundary payloads where the literal *is* the test input; a
  builder-with-overrides would hide which field is under test. Leave it alone.
- **Do not promote `getCharacterData`** (`character-level-up.test.ts:35` ⇔
  `character-multiclass-level-up.test.ts:36`). It is byte-identical, but it is a
  three-line `JSON.parse` wrapper; adding it to an 84-line shared helper module
  buys nothing and costs an import.
- **Do not promote `createActiveEncounterWithMonsters` or `makeSecondWindActive`
  — they are not duplicates.** `encounter-combat.test.ts:37` is a six-line
  delegation to the existing shared `createEncounterWithMonsters` +
  `activateEncounter`, while `encounter-combat-spell.test.ts:38` is a ~35-line
  bespoke "Spell Battle" builder with different monster stats and an explicit
  `setInitiative`/`transitionState` sequence. `mutation-logging.test.ts:45`
  hardcodes `uses: 0, maxUses: 2` and queries directly; `character-updates.test.ts:23`
  parameterises `{uses, maxUses}` and delegates to `findSecondWind`. Realistic
  scope is the four candidate promotions in step 3 plus one negotiated one
  (`createActiveEncounterWithPlayerAndMonster`, step 4), and two of the four
  (`createMapForCampaign`, `errorOf`) are themselves borderline.
- **Step 4's builder belongs in `encounter-test-helper.ts`, not
  `encounter-combat-test-helper.ts`.** `packages/server/src/test/MODULE.md:64-70`
  reserves the combat file for builders/wrappers specific to the
  `encounterCombat` router; `createActiveEncounterWithPlayerAndMonster` goes only
  through `encounter.create` / `encounter.addParticipant` /
  `encounter.setInitiative` / `encounter.transitionState`, which is the generic
  file's territory and where its private substrate already lives.
- **Refresh `packages/server/src/test/MODULE.md` at the end of steps 3 and 4.**
  Its Test Seams section (`:58-60`) requires a new builder to be added to the
  encounter-builder table at `:40-47`, and step 4's builder must respect the
  split rule at `:64-70`. See
  [`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md).
- **Do not try to "assert CAS properly" in `rest-service.test.ts`, and do not
  delete the fake-Prisma to replace it with a real DB test.** The comments at
  `:281-285` and `:521-523` deliberately state that the version-CAS SQL shape
  belongs to `updateCharacterStatsLocked` and is covered against real Postgres in
  `character-stats-mutations.test.ts`. The emulator exists to let the code path
  run, not to assert concurrency semantics — that division is already correct.
  Preserve those comments verbatim if step 9 happens at all. Read
  [`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) before going further than a
  file move.
- **Do not attempt "test pure planning directly" for rest-service.**
  `planHitDiceSpend` (`packages/server/src/services/rest-service.ts:173`) is
  `async`, unexported, reads `tx.characterClass.findMany` at `:176`, and rolls
  `randomInt` at `:194` — it is not pure and cannot be tested in isolation as
  written. Extracting it is a production refactor and is out of scope here; step
  9 must stop at (optionally) relocating the mock.
- **Do not "untangle" `rest-service.test.ts` by rest phase.** It is already
  partitioned into exactly those three top-level describes at `:261`, `:511`,
  `:751`. The only win available is file size.
- **Keep the lint-ratchet split pointed at the facade.** The suite exercises
  `./baseline.js` deliberately; split by concern but do not let the new files
  reach into `baseline-compare.ts` et al. directly, or the split converts a
  behavioural suite into a set of unit tests that no longer guard the public
  surface. The tuple win is also smaller than the type suggests — named wrappers
  already hide it at most call sites, so raw positional-hole calls are localized.
- **Step 10 is small.** `"accepts valid input"` appears 20 times and
  `"rejects empty campaignId"` 12 times across the 16 `*-inputs.test.ts` files
  (33 and 21 if you widen the grep to every file under
  `packages/shared/src/schemas/`, which is out of scope here). Treat it as a
  small follow-on, not a peer of the `homebrew.test.ts` work.
- **Size is XL, and this should be split before scheduling, not after.** Ten
  steps span three packages (`client`, `server`, `shared`) plus
  `tools/lint-ratchet`, and step 8 alone is a 2,761-line, nine-describe test
  split. Nothing here is a single reviewable unit.
  The natural break is three leaves: **client fixture** (steps 1-2),
  **server/shared payload factories** (steps 3-6, 10), and **lint-ratchet
  baseline suite** (steps 7-8). Step 9 is optional and belongs with whichever
  leaf, if any, is already touching `rest-service.test.ts`. These share the
  leaf's cause but not its files, and they can become their own leaves without
  losing coherence.
- **Sequence after leaf 39.** Step 3 adds `buildFeatData` to
  `packages/server/src/test/homebrew-test-helper.ts`, whose
  `setupHomebrewTestContext` signature leaf 39's step 2 changes (it drops the
  `_app` parameter there and in `setupRestContext` and `setupSpellTestContext`),
  and leaf 39's step 4 refactors the two-actor block in the same modules. Land
  leaf 39 first and rebase these promotions onto the settled signatures.
  `map-test-helper.ts` and `encounter-test-helper.ts` are untouched by leaf 39,
  so steps 3's map promotions and step 4 can proceed in either order.
- No other leaf in this pack touches these helper modules. Leaf 06's step 9 edits
  `packages/server/src/test/prepare-test-db.ts` and `test-database-url.ts`, and
  leaf 19's step 4 reaches `packages/server/src/test/srd-weapon-sync.test.ts` —
  both disjoint from the fixtures here, so those can land in either order.
