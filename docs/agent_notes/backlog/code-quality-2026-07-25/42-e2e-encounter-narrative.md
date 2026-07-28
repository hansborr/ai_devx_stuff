# 42. The encounter combat E2E is one 22-test serial narrative whose tests repair shared state so the next test can pass

Status: Proposed — not promoted
Theme: e2e test isolation · Area: tests · Severity: medium · Size: XL

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`e2e/encounter-combat.spec.ts` is a single 779-line `test.describe` running in
`mode: "serial"`, with 22 tests sharing nine `let` bindings at describe scope:
four page-object handles built once in a 122-line `beforeAll`, and five
context/ID bindings, two of which (`encounterId`, `combatMapId`) are not
assigned until the third test. Because the tests are a narrative rather than
independent scenarios, ordinary Playwright guarantees do not apply: a failure
at test 7 cascades into skips through test 22, and any test can be broken by
an edit to a test that runs before it.

The smell is not inferred — the file documents it against itself. Two tests do
extra work whose only purpose is to leave the world as the *next* test expects,
each under a comment literally beginning `// Restore the serial-flow invariant:`.
One cycles the DM's turn pointer back to the player character through a
try/catch advance loop after asserting live sync; the other navigates the player
page back to the campaign detail view after visiting a standalone character
sheet. Neither assertion belongs to the test it lives in. They are cleanup for a
dependency the file structure created.

The cost is that the file is now the wrong shape for what it contains. A genuine
lifecycle chain (create → add participants → link map → roll initiative → start →
advance → pause/resume → end → player sees resolved) legitimately needs serial
ordering. But three concerns sitting inside the same chain are independent of it:
drawer-access authorization (2 tests), the six-test spell-casting block, and
sheet-side HP attribution (1 test). Those ~270 lines pay the full cost of serial
coupling — cascade skips, invariant-restoration tests, unreviewable ordering
constraints — for no benefit.

Three further tests sit outside both the lifecycle chain and the three
extractable blocks: the player's drawer weapon attack (`:452`), the DM's
structured Commoner Club attack (`:463`), and the combat-log assertion that
reads the first of those back (`:660`). Two of them depend on the turn pointer
that the first `Restore the serial-flow invariant` block re-establishes. Plan
against 22 = 10 lifecycle + 9 extractable + 3 remainder: extracting the three
blocks moves 9 tests, leaves 13 in this file, and does not on its own make the
restoration block deletable.

## Evidence

- `e2e/encounter-combat.spec.ts:53` — `test.describe("Encounter combat lifecycle")`,
  with `test.describe.configure({ mode: "serial" })` on the next line.
- `e2e/encounter-combat.spec.ts:56-67` — nine shared mutable bindings. Five carry
  data between tests: `let ctx` (assigned `:70`), `let dmCharacterId` (`:80`),
  `let playerCharacterId` (`:94`), `let encounterId = ""` (`:232`),
  `let combatMapId = ""` (`:243`). Four are page-object handles constructed at
  the tail of `beforeAll` (`:187-190`): `let dmEncounter`, `let playerEncounter`,
  `let dmDrawer`, `let playerDrawer` — stateless wrappers (`EncounterPO` and
  `VttDrawerPO` each take only a `Page`), so no test repairs them, but every
  extracted file must reconstruct all four against its own DM and player pages.
  The three `const` names at `:61-63` are shared but immutable.
- `e2e/encounter-combat.spec.ts:232` — `encounterId` is assigned inside the third
  test, then read by later tests at `:481`, `:484`, `:499`, `:503`, `:520`,
  `:532`, `:549`, `:570`, `:646`, `:654`.
- `e2e/encounter-combat.spec.ts:69-191` — 122-line `test.beforeAll` doing full
  two-browser DM/player setup.
- `e2e/encounter-combat.spec.ts:373-390` — `// Restore the serial-flow invariant:`
  block; after asserting the player view live-syncs, cycles the DM turn pointer
  back to the player character via a try/catch advance loop over four
  `TIMEOUT_SHORT` attempts, then re-asserts current participant on both pages.
- `e2e/encounter-combat.spec.ts:695-698` — second
  `// Restore the serial-flow invariant:` block; `await ctx.playerPage.goto(
  \`/campaigns/${ctx.campaignId}\`)` purely because "subsequent tests reload the
  player page expecting the campaign detail view".
- 22 sequential tests in the describe. The separable concerns (9 tests total):
  - drawer-access authorization — `:393-450`, 2 tests (`drawer access follows
    token ownership and DM visibility`, `player opens the drawer from the
    multi-token action-bar dropdown`);
  - spell casting — `:478-658`, 6 tests (Fire Bolt, Sacred Flame, Fireball, Fog
    Cloud, concentration-conflict cancel, ambiguous class-source);
  - HP attribution — `:670-699`, 1 test (`sheet-side HP adjust during combat
    surfaces an attributed combat-log entry`).
- The lifecycle chain that legitimately needs serial mode (10 tests): `:199`
  create, `:204` add participants, `:225` link map, `:292` player sees encounter,
  `:300` roll initiative and start, `:310` advance to player turn, `:336`
  live-sync, `:703` pause/resume, `:713` end + XP summary, `:719` player sees
  resolved.
- The 3 remaining tests, in neither group: `:452` `player attacks from the
  drawer against the monster`, `:463` `structured Commoner Club exposes one
  Attack control and reaches attemptAttack`, `:660` `combat log shows the drawer
  weapon action` (asserts the log entry produced by `:452`). 10 + 9 + 3 = 22.
- `packages/server/src/services/combat-actions/combat-actions.ts:57` —
  `if (!isDm && attackerSortOrder !== currentTurnIndex)` rejects the attack. The
  player weapon attack at `:452` calls `encounterCombat.attemptAttack` and
  asserts `resp.ok()` (`e2e/page-objects/vtt-drawer.po.ts:124-131`), so it only
  passes while the turn pointer is on the player character — which is exactly
  what the `:373-390` restoration block re-establishes. `:463` is a DM attack and
  bypasses the check; `:660` depends on `:452` having succeeded.
- `e2e/helpers/api.ts` — the encounter-related wrappers that exist today are
  `apiCreateCampaign`, `apiCreateMap`, `apiUpdateEncounter` (metadata/`mapId`
  only), `apiListEncounters`, `apiGetEncounter`, `apiCreateMapToken`,
  `apiListCombatLogs`. There is **no** wrapper for `encounter.create`,
  `encounter.addParticipant`, `encounter.setInitiative`,
  `encounter.transitionState`, `encounterCombat.rollAllInitiative`, or
  `encounterCombat.advanceTurn` — every one of those runs through the UI today
  (`EncounterPO`). All six exist server-side
  (`packages/server/src/routers/encounter.ts` and `…/encounter-combat.ts`);
  `encounter.setInitiative` sets one participant's value explicitly
  (`encounter.ts:231-233`), while `rollAllInitiative` rolls, so a deterministic
  seed needs the former.
- `docs/guides/add-e2e-test.md` — covers page objects, spec placement, fixtures,
  and selector preference only. It describes **no** scenario-seeding helper; the
  helper this leaf needs does not exist and is not documented anywhere.

## Proposed direction

Read [`docs/guides/add-e2e-test.md`](../../../guides/add-e2e-test.md) first for
page-object and selector conventions. Note that it does **not** describe a
scenario-seeding helper — that helper does not exist yet and step 1 is where it
gets built.

1. **Add the missing API wrappers, then build API-level scenario seeding for an
   active encounter.** `e2e/helpers/api.ts` today can create a campaign, a map,
   map tokens and characters, and can read encounters and combat logs, but it
   cannot create an encounter or start combat. Add five wrappers —
   `encounter.create`, `encounter.addParticipant`, `encounter.setInitiative`,
   `encounter.transitionState`, and `encounterCombat.advanceTurn` — following the
   existing `trpcMutate`/`trpcQuery` idiom in that file. Use `setInitiative` per
   participant rather than `encounterCombat.rollAllInitiative`: the seed needs a
   fixed initiative order, and rolling gives a random one, so no
   `rollAllInitiative` wrapper is needed. Then compose the five into one helper
   that creates campaign + DM/player characters + map + encounter and drives it
   to `active` with a known initiative order and a caller-chosen current
   combatant. The helper must also hand back the two browser pages, since each
   extracted file re-creates `EncounterPO`/`VttDrawerPO` for the DM and the
   player itself. This is the load-bearing step and it is new code, not a move:
   without it each extracted file re-pays the whole `beforeAll` and the UI
   encounter-setup tests that follow it, and total suite time multiplies instead
   of staying flat.
2. **Extract HP attribution** to `e2e/encounter-hp-attribution.spec.ts` (one
   test, `:670-699`). Smallest slice, and it directly deletes the second
   `Restore the serial-flow invariant` block at `:695-698` — the extracted file
   ends wherever it likes. Prove the seeding helper on this one before going
   further.
3. **Extract drawer-access authorization** to `e2e/encounter-drawer-access.spec.ts`
   (`:393-450`), seeded via step 1. These are authorization assertions and can run
   in parallel with everything else.
4. **Extract spell casting** to `e2e/encounter-combat-spell.spec.ts` (`:478-658`,
   the largest slice). Decide per test whether it needs the turn pointer on the
   player character; where it does, set that in the seed rather than inheriting
   it from a prior test.
5. **Give the surviving turn-dependent tests their own precondition before
   touching the first invariant-restoration block** (`:373-390`). After steps
   2-4 the file still holds `:452` (player weapon attack), `:463` (DM Commoner
   attack) and `:660` (its combat-log read). `:452` fails outright unless the
   player character is the current combatant — the server rejects a non-DM
   attack out of turn (`combat-actions.ts:57`). So either set the pointer
   explicitly at the start of `:452` using the step 1 advance wrapper, or move
   `:452`/`:660` into their own weapon-attack spec seeded with the pointer on
   the player. Only then does the live-sync test at `:336` get to end at its own
   assertion, which is what it was actually testing. If neither is done, keep the
   block — deleting it is a red suite, not a cleanup.
6. **Keep the lifecycle chain serial** in `e2e/encounter-combat.spec.ts`. After
   steps 2-4 it holds thirteen tests: the ten ordering-dependent lifecycle tests
   plus `:452`, `:463` and `:660` (fewer if step 5 moves the weapon pair out).
   Do not remove `mode: "serial"` from this file.

## Scope / caveats

- **Do not de-serialise the remaining lifecycle chain.** Create → participants →
  map → initiative → start → advance → pause/resume → end is a genuine state
  machine and its tests genuinely depend on order. The finding is that *three
  unrelated concerns are trapped inside it*, not that serial mode is wrong here.
- **Risk is medium and it is concentrated in exactly one place: removing serial
  ordering from e2e tests is where flakes get introduced.** Production code is
  untouched, so nothing user-facing can regress — but a test that passed only
  because a previous test happened to leave the encounter in a particular state
  will now fail intermittently, and it will look like a product bug. Land steps
  2-4 one at a time and let each sit through several CI runs before starting the
  next. Do not batch the extractions into one commit.
- **Do not extract before step 1 exists.** Splitting first and re-running setup
  per file is the failure mode that makes this refactor a net loss. Be precise
  about what that setup is: the 122-line `beforeAll` is mostly API calls already
  (`apiCreateCharacter`, five `apiLevelUpCharacter`s, inventory, spells) with a
  UI tail for member assignment and tab navigation — but the encounter itself is
  built by the first five *tests* through the browser, and it is that part each
  extracted file would otherwise have to re-run or reimplement.
- **The parallel unit is the spec file, which is why extraction pays at all.**
  `playwright.config.ts:31` sets `fullyParallel: false` with `workers: 4`
  (`:34`), so splitting the describe is what buys concurrency — and it is also
  why step 1 is load-bearing: four files each re-running a two-browser
  `beforeAll` is four times the setup on four workers, not free. Note that
  `mode: "serial"` is not what orders the lifecycle chain — `fullyParallel:
  false` already does — it is what turns a mid-chain failure into skips rather
  than fifteen confusing red tests. Each extracted file also needs its own
  `test.afterAll` calling `ctx.teardown()`, as the current file does at
  `e2e/encounter-combat.spec.ts:193-195`.
- **The two `// Restore the serial-flow invariant:` comments are the primary
  evidence.** Preserve their content as the specification of what the seeding
  helper must establish — the pointer position at `:373-390`
  and the player page's expected route at `:695-698` are precisely the
  preconditions the extracted files now have to set explicitly. Delete the blocks
  only after the corresponding precondition is expressed in the seed.
- **`encounterId` is written in the third test (`:232`) and read by ten later
  assertions.** Any partial extraction that leaves an API-reading test behind
  while moving its producer will silently pass `""` to `apiGetEncounter`. Check
  every reader listed in Evidence when moving a test.
- **The extraction does not leave a tidy ten-test lifecycle file.** Three tests
  (`:452`, `:463`, `:660`) sit outside both the lifecycle chain and the three
  extractable blocks. Estimate against 10 + 9 + 3, not 10 + 12 — those three are
  extra work that neither the lifecycle file nor the three extracted specs
  absorbs for free.
- **Size is XL, and step 1 is the reason.** Five new API wrappers plus a
  composed active-encounter seeding helper is new e2e infrastructure with its own
  correctness burden (initiative order, participant/token linkage, turn pointer),
  and it must be built and proven before any test moves. The extractions
  themselves are the cheap part.
- Independent of leaves 40 and 41; no sequencing dependency in either direction.
- **Sequencing with leaf 47.** Step 1 adds five wrappers to `e2e/helpers/api.ts`,
  which leaf 47 retypes end-to-end. Land leaf 47 first so the new wrappers are
  written against the inferred `AppRouter` types rather than hand-written
  signatures that then have to be re-typed.
