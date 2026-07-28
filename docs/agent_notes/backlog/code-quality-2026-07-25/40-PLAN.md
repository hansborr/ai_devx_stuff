# 40-PLAN. Test payload factories: scheduling plan

Status: Planned — **shrinks leaf 40 from XL to three small slices plus one
opportunistic tidy; four of its ten steps are dropped permanently**; supersedes
the Proposed direction in
[`40-test-payload-factories.md`](./40-test-payload-factories.md)

Date: 2026-07-26 · Area: tests · Source leaf: 40 (XL)

Cross-model planning session: `consult codex` (own subagents across factory
design, blast radius, cost/benefit and framing, synthesized) and `consult cursor`
(Grok, "is this the right approach at all"). Both were asked independently. Where
they disagreed, the call and the reason are in
[Rejected alternatives](#rejected-alternatives--why). Every count below was
re-measured against `c69ce720`; `git diff 883d48bf..c69ce720` is empty for every
file this leaf names, so the leaf's line anchors are current.

## Verdict

**Leaf 40 is not one leaf and not three. It is three small independently-landable
slices, one opportunistic tidy, and four steps that should leave the backlog.**

Both consults returned "drop it as a coherent leaf" independently. The stated
cause — "test input is written as a literal at the point of use, and test
infrastructure is copied into the next sibling file rather than promoted" — is an
editorial theme over five unrelated situations (a client contract hole, four
near-duplicate server closures, a shared-schema payload repetition, a file-local
tuple DSL, and two large test files). They share no mechanism and no fix.

The leaf's own proposed three-leaf split (client fixture / server+shared payload
factories / lint-ratchet baseline suite) does not survive either: the
lint-ratchet third is dropped entirely, and the server and shared halves have
nothing to do with each other.

## Corrections to the leaf, verified

The leaf's counts are accurate. Its two load-bearing *mechanism* claims are not.

**1. `satisfies CharacterDetail` is the wrong mechanism for step 1 — and the
leaf's justification for it is factually wrong.**

The leaf says `satisfies` "supplies contextual typing, so the eight inline casts
… can be deleted". Measured, by editing `fixtures-character.ts` in a scratch
worktree and running `tsc -p packages/client/tsconfig.json --noEmit`:

| Variant | Result |
|---|---|
| `} satisfies CharacterDetail;` + bare `[]` / `null` | **compiles, exit 0** — no assignability errors, no nested drift |
| same, plus deleting all 7 `as unknown as CharacterDetail` | **compiles, exit 0** |
| probe `const _x: null = TEST_CHARACTER_DETAIL.campaignId` | **compiles** — so `campaignId` is still `null`, *not* `string \| null` |
| probe `const _y: never[] = TEST_CHARACTER_DETAIL.spells` | **compiles** — so `spells` is still `never[]` |

`satisfies` checks assignability; it does **not** widen the literal's own
property types. The eight casts exist precisely to give the null/empty fields a
row shape (the file says so at `:4-12`), and `satisfies` does not replace that
purpose — it just removes the check that nothing today depends on the row shape.
Codex caught this; the leaf and cursor did not.

**The mechanism that works is a narrowed annotation.** Also measured, `tsc`
exit 0 over the whole client project with every cast below removed:

```ts
export const TEST_CHARACTER_DETAIL: CharacterDetail & {
  stats: NonNullable<CharacterDetail["stats"]>;
} = { … };
```

This keeps `.stats.*` non-null (so the file's `:5-11` objection to a bare
`: CharacterDetail` annotation is satisfied, and that objection was correct as
written), restores real row types for every null/empty field, and deletes more
casts than the leaf claims — see slice 40.1.

**2. A typed `Partial<HomebrewMonsterData>` builder cannot express the payloads
step 5 is supposed to sweep.** Both consults raised this independently and it
holds on inspection: of the eight full literals the step wants to fold into a
builder, `homebrew.test.ts:647` passes `conditionImmunities: ["pizza"]`, `:675`
passes `damageResistances: ["taco"]`, `:731` passes `skills: { perception: 1.5 }`,
and `:703` passes `savingThrows: { cha: 999 }`. Those are *deliberately invalid*
values; a builder typed against the schema output rejects them at compile time.

So the leaf's primary framing of step 5 — "typing it needs one production line
first: export `monsterDataSchema`" — is not merely optional, it is **wrong**. The
builder must take `Record<string, unknown>` overrides, exactly like the existing
`packages/server/src/routers/homebrew-import.test.ts:40` precedent, and
`monsterDataSchema` stays private at `packages/shared/src/schemas/homebrew.ts:154`.

**3. The concurrency copy's extra `encounter.get` is not a persistence barrier.**
The leaf says it "may be relying on [it] as an implicit persistence barrier" and
forbids deleting it. `encounter-combat-concurrency.test.ts:91-107` reads the
encounter back, sorts `detail.participants` by `sortOrder`, then does
`sorted.find((p) => p.id === playerP.id)` — it finds by an id `addParticipant`
already returned and returns that same id. The sort is inert. It is a
read-after-write projection check, not a fence. (Contrast
`encounter-test-helper.ts:301-306`, where `makeActiveMonsterEncounter` re-reads
to obtain `round`/`currentTurnIndex`, which the mutations do not return — that
one is load-bearing.) The plan still leaves the block alone, but for the honest
reason: it is coverage nobody has argued should go, not a barrier.

**4. Nothing forces any of the file-size splits.** `eslint-config/test-configs.js:100-102`
sets `max-lines`, `local/max-lines` and `max-lines-per-function` to `"off"` for
unit-test files, and no test file appears in
`eslint-config/max-lines-exceptions.baseline.json`. Steps 6, 8 and 9 are pure
judgement calls with no gate behind them.

**5. Slice 40.1 is lint-ratchet-neutral.** `ratchet/local-type-assertion-boundary`
in `lint-ratchet.baseline.json` is a zero baseline (`items` is empty) — the rule
fires only on *unmarked* casts, so deleting marked casts moves no count. The
three ratchets that do record these files
(`no-real-time-in-package-tests`, `testing-library-no-node-access-client-tests`,
`no-direct-git-exec-scripts`) are untouched by any slice here.

**6. Smaller count corrections.** Step 10's `"accepts valid input"` is **18**
across the 16 `*-inputs.test.ts` files, not 20 (`"rejects empty campaignId"` is
12, as stated); excluding `encounter-inputs.test.ts` as the caveats require, they
fall to **15** and **11**. The Archmage payload at `homebrew.test.ts:177` has 26
top-level fields, so "21-to-22-field" is not uniform. The concurrency block is
exactly 17 lines, not "~15".

## Step disposition

| Step | Call | Reason |
|---|---|---|
| 1. Contract-check the client fixture | **Keep, mechanism changed** → 40.1 | Real contract hole; but use the narrowed annotation, not `satisfies` (correction 1). |
| 2. Delete the seven double casts | **Keep, expanded** → 40.1 | Plus 15 of the 16 downstream `NonNullable<CharacterDetail["stats"]>` casts, which the leaf missed. |
| 3. Promote byte-identical server helpers | **Halved** → 40.3 | Keep `buildFeatData` and the `OriginColumns`/`CLEARED_ORIGIN`/`readOrigin` cluster. Drop `createMapForCampaign` and `errorOf` permanently — both consults, independently. |
| 4. `createActiveEncounterWithPlayerAndMonster` | **Keep** → 40.4 | Real duplication (~44 shared lines), and routing it through `createAndActivateEncounter` adds the status assertions the two open-coded copies lack. Leave the concurrency re-read inline; do **not** add an opt-in flag. |
| 5. Typed monster payload builder | **Keep, retyped** → 40.2 | `Record<string, unknown>` overrides, local to the suite. No production export (correction 2). |
| 6. Split `homebrew-inputs` out | **Keep as a second commit** in 40.2 | Module ownership, not factory work; ~213 lines of motion, no duplication removed. Cheap while already in the file. |
| 7. Objectify the lint-ratchet tuple | **Drop** | File-local fixture DSL with no external contract. 43 `current([…])` call sites against 85 already-wrapped ones (`oneTestBaseline` 58, `complexityBaseline` 16, `maxLinesBaseline` 11). No gate, no coverage change. |
| 8. Split the lint-ratchet baseline suite | **Drop** | See the ruling below — this is where the consults split. |
| 9. Relocate `makeMockContext` | **Drop** | The leaf itself concludes "the honest default is to leave it where it is". 120 lines, one consumer, no gate (correction 4). Both consults agreed. |
| 10. Sweep the `*-inputs.test.ts` titles | **Drop** | Shared English test titles are not shared payload shapes. Real counts 15/11 after the caveats' own exclusion (correction 6). |

### Step 8 ruling: dropped, with the conditions to revisit

Codex wanted step 8 carved out as a standalone M. Cursor dropped it. **Call:
drop**, on four grounds the consults surfaced between them:

- **No gate forces it** (correction 4), so the only argument is navigation.
- **The file is already the output of a deliberate re-homing.**
  `baseline.test.ts:39-43` records that these suites were moved here from
  `scripts/lint-ratchet/baseline.test.ts` under leaf 12, with an explicit split
  rule ("every ratchet, registry, baseline, and current here is a synthetic
  fixture — the Musi-bound suites … stay adapter-side"). Splitting again by a
  *different* axis contradicts a recorded decision without new evidence.
- **A ~205-line shared fixture preamble** (`:45-249`: `baseRatchet`,
  `thirdPartyRatchet`, `coreRatchet`, `maxLinesRatchet`, `complexityRatchet`,
  `fixtureRuleSourceHashes`, `current`, `oneTestBaseline`, `maxLinesBaseline`,
  `complexityBaseline`, the characterization cases) is shared by all nine
  describes. The split must either duplicate it or extract it into a new
  fixture module — a new coupling surface, for zero coverage change.
- **It touches a generated harness surface.** `scripts/tests/test-lint-ratchet.sh:8`
  carries `# smoke-subjects: tools/lint-ratchet/src/kernel/baseline.test.ts`,
  projected into `scripts/path-policy/path-policy-smoke-subjects-data.ts:655`.
  Splitting the file without updating that header and re-running
  `bun run test:scripts:subjects` silently stops the new files from selecting the
  focused smoke suite. Codex found this; neither the leaf nor cursor did.

Revisit only if someone is already deep in that file for behavioural reasons, or
if a `local/max-lines` cap is ever turned on for test files. If it is ever done,
codex's constraint stands: do **not** move the `lint ratchet rule source hash
binding` describe (`:2424`) into `rule-source.test.ts` as the leaf suggests —
that sibling tests `rule-source.js` directly, and five of the six binding tests
exercise baseline parse/format/build contracts.

## Slices

Four slices. Each is one agent session. All four are independently landable.

| # | Scope | Done criteria | Verification |
|---|---|---|---|
| **40.1** | **Contract-check the client character fixture (S).** In `packages/client/src/test/fixtures-character.ts`, annotate `export const TEST_CHARACTER_DETAIL: CharacterDetail & { stats: NonNullable<CharacterDetail["stats"]> } = { … }` and delete the eight inline casts (`campaignId` `:29`, `conditions` `:113`, `spellSlots` `:114`, `spells` `:121`, `features` `:136`, `levelChoices` `:144`, `weaponMasteries` `:152`, `metamagics` `:153`) together with the `type-assertion-boundary: test` block comment at `:4-12`. The `CharacterCondition`, `ChoiceData` and `CharacterWeaponMastery` type imports become unused — delete them; the file ends with one `import type { CharacterDetail }`. Then replace all seven `TEST_CHARACTER_DETAIL as unknown as CharacterDetail` with a direct reference (`cast-rail.test.tsx:17`, `cast-rail-slot-picker.test.tsx:12`, `cast-rail-concentration.test.tsx:14`, `tabs/stats-tab.test.tsx:15`, `tabs/spells-tab.test.tsx:15`, `tabs/actions-tab.test.tsx:27`, `sheet/asi-step.test.tsx:49`), and delete 15 of the 16 `… .stats as NonNullable<CharacterDetail["stats"]>` casts: `cast-rail.test.tsx:338,365,399,554`, `tabs/stats-tab.test.tsx:73,86,99,113,126,150,168,293,307`, `tabs/spells-tab.test.tsx:284`, `tabs/actions-tab.test.tsx:287`. **Keep `cast-rail-concentration.test.tsx:90`** — it spreads a genuinely nullable `base.stats` parameter, and removing it is the one variant that fails to compile. Leave `asi-step.test.tsx:196` (`… } as unknown as CharacterDetail` over a *different*, hand-built object) alone. | `grep -rn "as unknown as CharacterDetail" packages/client/src` returns exactly one hit (`asi-step.test.tsx:196`); `grep -rn 'NonNullable<CharacterDetail\["stats"\]>' packages/client/src` returns exactly one (`cast-rail-concentration.test.tsx:90`); `fixtures-character.ts` contains no `type-assertion-boundary` marker; no consumer test changed an assertion | `bun run typecheck` then `bun run test -- packages/client/src/components/vtt/drawer/cast-rail.test.tsx packages/client/src/components/vtt/drawer/cast-rail-slot-picker.test.tsx packages/client/src/components/vtt/drawer/cast-rail-concentration.test.tsx packages/client/src/components/vtt/drawer/tabs/stats-tab.test.tsx packages/client/src/components/vtt/drawer/tabs/spells-tab.test.tsx packages/client/src/components/vtt/drawer/tabs/actions-tab.test.tsx packages/client/src/components/sheet/asi-step.test.tsx` |
| **40.2** | **Shared homebrew monster payload + suite ownership (M, two commits).** *Commit 1:* add a file-local `buildMonsterPayload(overrides: Record<string, unknown> = {}): Record<string, unknown>` to `packages/shared/src/schemas/homebrew.test.ts`, modelled on `packages/server/src/routers/homebrew-import.test.ts:40`. Do **not** export `monsterDataSchema`, do **not** add a `HomebrewMonsterData` type, and do **not** put the builder in `packages/shared/src/test/parse-helpers.ts` until a second suite needs it. Collapse the five `const base` range-rejection cases (`:251`, `:278`, `:306`, `:335`, `:363`; payloads at `:252`, `:280`, `:308`, `:337`, `:364`) and sweep the eight full literals at `:145`, `:177`, `:219`, `:647`, `:675`, `:703`, `:731`, `:759`. Keep each rejection as its own named `it` where the name states the rejected field — prefer named `it`s over an opaque `it.each`. Leave the partial at `:247` (`{ name: "Incomplete" }`) alone. Leave the two *positive* full payloads readable as full payloads if collapsing them hides what is accepted. *Commit 2:* create `packages/shared/src/schemas/homebrew-inputs.test.ts` and move the seven describes at `:817`, `:831`, `:844`, `:865`, `:902`, `:1095`, `:1167` into it with the `./homebrew-inputs.js` import block. Content-only move, no assertion changes. | Assertion count unchanged in both commits (`grep -c "expect(" ` before/after across the two files sums equal); `grep -n "export const monsterDataSchema" packages/shared/src/schemas/homebrew.ts` returns nothing; `homebrew.test.ts` imports only `./homebrew.js` after commit 2 | `bun run test -- packages/shared/src/schemas/homebrew.test.ts` (commit 1); `bun run test -- packages/shared/src/schemas/homebrew.test.ts packages/shared/src/schemas/homebrew-inputs.test.ts` (commit 2) |
| **40.3** | **Server micro-promotions (XS, opportunistic — do not spend a standalone session if nobody is in these files).** Promote `buildFeatData` (`homebrew-import.test.ts:29` ⇔ `homebrew-export.test.ts:22`, byte-identical) into `packages/server/src/test/homebrew-test-helper.ts`. Promote the origin cluster — `interface OriginColumns` (`encounter-map.test.ts:531` ⇔ `map-token.test.ts:294`), `CLEARED_ORIGIN` (`:538` / `:301`) and `readOrigin` (`:545` / `:333`) — into `packages/server/src/test/map-test-helper.ts`; the interface and the const must travel with the function or it will not compile. Do **not** promote `createMapForCampaign` or `errorOf` (see Rejected alternatives). | Each promoted symbol has exactly one definition (`grep -rn -E "(function\|const\|interface) (buildFeatData\|readOrigin\|OriginColumns\|CLEARED_ORIGIN)" packages/server/src` returns four lines, all under `packages/server/src/test/`); `createMapForCampaign` and `errorOf` still have two definitions each | `bun run test -- packages/server/src/routers/homebrew-import.test.ts packages/server/src/routers/homebrew-export.test.ts packages/server/src/routers/encounter-map.test.ts packages/server/src/routers/map-token.test.ts` |
| **40.4** | **Active player-plus-monster encounter builder (S).** Add one builder to `packages/server/src/test/encounter-test-helper.ts` — **not** `encounter-combat-test-helper.ts` (`packages/server/src/test/MODULE.md:64-70` reserves that file for `encounterCombat`-router-specific builders, and this one goes only through `encounter.create` / `addParticipant` / `setInitiative` / `transitionState`). Build it as a thin wrapper over the private `createAndActivateEncounter` (`:131-175`), in the shape of `buildActiveBattle` (`:216`), taking an encounter-name parameter and returning `{ encounterId, playerParticipantId, monsterParticipantId }`. Route both `encounter-hp-attribution.test.ts:46` and `encounter-combat-concurrency.test.ts:41` through it. **Leave `encounter-combat-concurrency.test.ts:91-107` inline and unchanged** — do not delete it, and do not express it as an opt-in flag on the helper. Add the new builder to the encounter-builder table at `MODULE.md:40-47` as its Test Seams section (`:58-60`) requires; see [`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md), then run `bun run module:index`. | Both suites green; `createAndActivateEncounter` still private; the concurrency file still contains its `encounter.get` block; the MODULE.md table has a sixth builder row | `bun run test -- packages/server/src/routers/encounter-hp-attribution.test.ts packages/server/src/routers/encounter-combat-concurrency.test.ts` — run the concurrency file **at least five times in a row**, not once (it is a race suite; read [`docs/CONCURRENCY.md`](../../../CONCURRENCY.md) first) |

### Dependency edges

- **`40.1 ∥ 40.2`** — different packages, no shared file. Either order.
- **`39 → 40.3`.** Leaf 39's step 2 changes `setupHomebrewTestContext`'s
  signature in `packages/server/src/test/homebrew-test-helper.ts` and its step 4
  reworks the two-actor block in the same module. Land 39 first and add
  `buildFeatData` onto the settled file. The `map-test-helper.ts` half of 40.3 is
  untouched by leaf 39 and could go earlier, but there is no reason to split the
  slice.
- **`39.6 → 40.4` (soft).** Leaf 39's step 6 sweeps `useTestApp()` through ~90
  server test files, including both files 40.4 edits. Nothing is
  semantically blocked, but running them concurrently guarantees a rebase.
  Prefer 40.4 after the sweep has settled.
- `40.4` does not depend on `40.3` and does not touch `homebrew-test-helper.ts`.
- No other live leaf in this pack touches these modules. Leaf 06 step 9
  (`prepare-test-db.ts`, `test-database-url.ts`) is disjoint. Leaf 19 step 4's
  `srd-weapon-sync.test.ts` work was dropped by
  [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md), so it is not an edge.

### Index reconciliation (whichever slice lands first applies these)

1. `00-index.md`, "Read this first": leaf 40 is no longer XL and no longer one of
   the "exceptions that name their own split". Point its row at this file and
   mark it S/M.
2. `00-index.md`, "Do not start with": remove 40 from the XL list.
3. `40-test-payload-factories.md`: add a Status pointer to this plan and record
   that steps 7-10 are dropped permanently, so they are not re-scheduled from the
   leaf.

## Operational risks

- **40.1's mechanism is the whole slice.** If the narrowed annotation is replaced
  with a bare `: CharacterDetail`, `stats` widens to nullable and dozens of
  consumer tests that dereference `TEST_CHARACTER_DETAIL.stats.*` break — the
  file's `:5-11` comment is right about that, and only about that. If it is
  replaced with `satisfies`, the suite still compiles today but the null/empty
  fields silently become `null` and `never[]`, which is a quieter version of the
  hole the slice is closing. Use the intersection annotation.
- **40.1 changes no runtime behaviour.** Every edit is type-level. A red test
  after this slice means the fixture was already drifting from `CharacterDetail`,
  which is the finding — fix the fixture, do not re-add a cast.
- **40.2 must not lose a rejection.** The eight swept literals include four
  deliberately invalid values (`["pizza"]`, `["taco"]`, `{ cha: 999 }`,
  `{ perception: 1.5 }`). A builder whose default payload itself fails to parse
  would make every one of those assert the wrong field and still pass. Assert
  once, in the same commit, that the bare `buildMonsterPayload()` output *parses
  successfully* — that is the invariant the whole slice rests on.
- **40.4 touches a race suite.** `encounter-combat-concurrency.test.ts` is
  driven through real P2034 retry sequences. Routing its setup through
  `createAndActivateEncounter` changes *how* the mutations are issued (it uses
  `injectTrpcMutation` with status labels rather than bare `app.inject`), which
  is a diagnostics improvement but is not a no-op. Run it repeatedly.
- **40.3 is the slice most likely to be net-negative if over-applied.** Two of
  the leaf's four candidates were already borderline by its own admission and are
  dropped here; do not re-add them because the module now exists.
- **Do not touch `packages/shared/src/schemas/encounter-inputs.test.ts`** — the
  leaf's caveat holds and both consults endorsed it. Its repeated 4-6 line
  payloads *are* the test inputs.
- **Do not "assert CAS properly" or replace the fake Prisma in
  `rest-service.test.ts`.** With step 9 dropped that file is out of scope
  entirely, but the caveat is worth carrying: the comments at `:281-285` and
  `:521-523` deliberately record that the version-CAS SQL shape belongs to
  `updateCharacterStatsLocked` and is covered against real Postgres in
  `character-stats-mutations.test.ts`.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **Scheduling leaf 40 as an XL, or as its own three leaves** | Both consults independently returned "drop it as a coherent leaf". What survives is three small slices and one opportunistic tidy across four unrelated areas. |
| **`satisfies CharacterDetail` for the fixture (the leaf's step 1)** | Measured: it compiles, but leaves `campaignId: null` and `spells: never[]` — it does not supply the row shapes the eight casts exist for, which is the exact claim the leaf makes for it. The intersection annotation does both. |
| **A bare `: CharacterDetail` annotation** | Widens `stats` to nullable and breaks every `TEST_CHARACTER_DETAIL.stats.*` consumer. The file's own comment is correct here. |
| **Exporting `monsterDataSchema` / adding `HomebrewMonsterData`** | Enlarges the shared package's public surface for a test-only need, and still cannot express the four deliberately-invalid override payloads. Both consults rejected it. If typing `HOMEBREW_DATA_SCHEMAS` is the real goal, that is leaf 24's territory. |
| **Putting `buildMonsterPayload` in `packages/shared/src/test/parse-helpers.ts`** | One consumer. Promote it when a second suite needs it; a package-level test API with one caller is the same mistake as step 9. |
| **`it.each` over the collapsed rejection cases** | The rejected field is the subject of each test. An `it.each` table moves it out of the test name into a fixture row, which is a readability regression in a schema-boundary suite. Named `it`s over a shared builder get the deduplication without that cost. |
| **Promoting `createMapForCampaign`** | It is a two-line delegation to the already-shared `createMap`, and both copies close over `app` and `ctx` (`encounter-map.test.ts:31-33`). Promoting it means passing both at every call site — strictly noisier than the closure it replaces. Both consults dropped it. |
| **Promoting `errorOf`** | A seven-line `JSON.parse` wrapper with two definitions and three call sites. It duplicates a `type-assertion-boundary: test` marker, which is the only real argument for moving it, and that is not enough to justify a new shared API. Both consults dropped it. Revisit only as part of a designed typed tRPC-error reader. |
| **Deleting the concurrency `encounter.get` block as "identical"** | It is not a persistence barrier (correction 3), but it is still a read-after-write projection assertion nobody has argued should go. Leaving it inline costs nothing; deleting it inside a helper-promotion commit is exactly the kind of quiet coverage loss the leaf warned about, even if its stated reason was wrong. |
| **An opt-in `{ rereadParticipants: true }` flag on the new builder** | Teaches a false synchronisation semantic to every future caller. Both consults rejected it; the leaf offered it as option (b). |
| **Putting the new builder in `encounter-combat-test-helper.ts`** | `packages/server/src/test/MODULE.md:64-70` reserves that file for `encounterCombat`-router builders. This one uses only the generic `encounter.*` procedures. |
| **Objectifying `CurrentPathEntry` (step 7)** | A file-local fixture DSL with no external contract, already hidden behind named wrappers at 85 of its call sites. 43 raw `current([…])` sites of test-only motion, no coverage change, no gate. |
| **Splitting `baseline.test.ts` (step 8)** | See the [step 8 ruling](#step-8-ruling-dropped-with-the-conditions-to-revisit). Codex wanted it as a standalone M; dropped on four grounds, the decisive two being the recorded leaf-12 re-homing decision the file documents against itself and the generated smoke-subject surface the split silently invalidates. |
| **Relocating `makeMockContext` (step 9)** | 120 lines, one consumer, no gate forcing it, and a deliberately inferred unnameable return type that would have to cross a module boundary. The leaf reaches the same conclusion in its own caveats. |
| **Sweeping the `*-inputs.test.ts` titles (step 10)** | 15 `"accepts valid input"` and 11 `"rejects empty campaignId"` after the caveats' own exclusion, across unrelated schemas with different required companion fields. Shared English is not a shared shape. |
| **Treating leaf 40 as evidence that `packages/*/src/test/` is under-used** | The premise does not survive: `packages/server/src/test/` has 20 helper modules with a MODULE.md that already governs additions, and the leaf's own promotion candidates reduced to two. The repo reaches for shared test material; these were four closures and one contract hole. |
