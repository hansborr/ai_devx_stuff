# 39. Server test helpers grew by copy-paste: a 10-line lifecycle preamble in 90 files, a half-finished `_app` migration, and re-rolled fixtures beside the shared ones

Status: Done — landed 2026-07-26 (`ef649600`…`3a445eb4`, merge `70ed2540`); steps 5 and 7 were skipped as unjustified and should not be re-scheduled from this note. See [`00-index.md`](./00-index.md#landed)
Theme: Duplication and half-finished migrations in `packages/server/src/test/` · Area: tests · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/server/src/test/` has a shared-helper layer, but it was built one domain at a
time and each new domain copied the previous one rather than extending it. The result is
four symptoms of a single cause — the helper layer never grew a seam for the *common*
part, only for the per-domain parts:

**The lifecycle preamble is unshared.** 90 server test files under `packages/server/src`
open with the same block: `let app: FastifyInstance`, a `beforeAll` calling
`createTestApp()`, an `afterAll` calling `app.close()`, and — in 73 of them — a
`beforeEach` calling some `setupXTestContext(app)`.
`packages/server/src/test/app-helper.ts` is 14 lines and exposes only `createTestApp()` —
there is no hook-registering wrapper, so every file re-registers the hooks by hand. A
change to how the test app is built or torn down (say, adding a teardown step) is a
90-file edit today. The copies have already picked up cosmetic variants — two files write
`afterAll(async () => app.close())` where the other 88 write a block body — which is
exactly the kind of divergence a wrapper removes, but no file is missing its teardown.

**A migration was started and abandoned.** Three context helpers still take a
`_app: FastifyInstance` parameter they do not use, each guarded by a near-identical
three-line comment explaining that setup now mints tokens in-process and the parameter is
retained only to avoid touching call sites. A fourth helper,
`setupInventoryTestContext`, already dropped it. So the codebase simultaneously asserts
"we keep it so call sites stay unchanged" and demonstrates that dropping it is fine.

**Fixtures are re-rolled next to the shared ones.** `character-fixtures.ts` hand-rolls a
raw `app.inject` + envelope cast for `character.create` while `trpc-helpers.ts` exports
`injectTrpcMutation<T>` doing exactly that with a status assertion. Four helpers open with
a byte-similar two-user + two-token `Promise.all` block that differs only in the
`createTestUser` arguments, and the newest router test re-rolls the same shape inline. A
further ten helper modules re-export `trpcData`, giving eleven import paths for one
function — a consistency wart rather than duplicated implementation, since there is
exactly one `trpcData` body.

**A table in the module doc is malformed.** `packages/server/src/test/MODULE.md:40` has six
header columns; `:41` has five delimiter cells. A GFM delimiter row must match the header
row cell-for-cell, so the whole six-row builder table fails to parse as a table and
renders as a paragraph of pipe characters — including the last column, the one the prose
at `:37-38` explicitly tells readers to use to pick a builder.

The cost is concentrated: a newcomer writing the 91st server test copies the nearest
neighbour, which reproduces whichever variant they happened to land on.

## Evidence

- `rg -l 'app = await createTestApp\(\)' packages/server/src` → 90 files;
  `let app: FastifyInstance` → 90. `await app.close()` matches only 88 because
  `packages/server/src/services/spell-casting/spell-casting.test.ts:26` and
  `packages/server/src/services/spell-casting/spell-casting-concurrency.test.ts:64` use
  `afterAll(async () => app.close())`, which returns the promise rather than awaiting a
  statement. All 90 files close the app.
- `packages/server/src/routers/encounter-combat.test.ts:24-35` — the verbatim block
  (`let app` / `let ctx` / `beforeAll` / `afterAll` / `beforeEach`). Same block at
  `packages/server/src/routers/encounter-combat-spell.test.ts:20` and
  `packages/server/src/routers/encounter-combat-map.test.ts:19`.
- `packages/server/src/test/app-helper.ts:1-14` — 14 lines, exports only `createTestApp()`.
  No hook-registering wrapper exists anywhere, so `useTestApp()` is a genuinely new seam.
- The `beforeEach` half is **not** uniform: 73 of the 90 files register one at all, and
  they fan out across 14 distinct context setups. By file count,
  `setupEncounterTestContext` appears in 27, `setupMapTestContext` in 8,
  `setupSpellTestContext` in 6, `setupHomebrewTestContext` in 5,
  `setupInventoryTestContext` in 3, `setupRestContext` in 2, `setupVaultTestContext` in 1,
  plus seven more.
- Vestigial unused parameter, exactly three sites:
  `packages/server/src/test/homebrew-test-helper.ts:31`,
  `packages/server/src/test/rest-test-helper.ts:20`,
  `packages/server/src/test/spell-test-helper.ts:21` — each preceded by the
  "Setup mints tokens in-process (see mintAccessToken); the Fastify app is no longer needed
  here, but the parameter is retained so the … call sites … stay unchanged." comment.
- `packages/server/src/test/inventory-test-helper.ts:50` — `setupInventoryTestContext`
  takes only `options: CleanDatabaseOption = {}`, proving the migration is half-done.
- `packages/server/src/test/character-fixtures.ts:18-31` — `createCharacter` does a raw
  `app.inject({ method: "POST", url: "/trpc/character.create", … })`, never inspects
  `res.statusCode`, and unwraps with
  `(JSON.parse(res.body) as { result: { data: { id: string } } }).result.data.id` behind a
  `// type-assertion-boundary: test` marker at `:29`.
- `packages/server/src/test/trpc-helpers.ts:22-33` — `injectMutation` asserts
  `res.statusCode !== HTTP_OK` and throws `` `${args.label} failed: ${status} ${body}` ``;
  `:40-42` — `injectTrpcMutation<T>` wraps it.
  `packages/server/src/test/campaign-test-context.ts:139-147` — `createCampaign`, the
  exemplar consumer.
- `export { trpcData };` verbatim in eight files: `notification-test-helper.ts:4`,
  `note-test-helper.ts:10`, `npc-test-helper.ts:10`, `inventory-test-helper.ts:10`,
  `chat-test-helper.ts:11`, `encounter-test-helper.ts:15`, `spell-test-helper.ts:15`,
  `rest-test-helper.ts:74`, plus two combined re-exports that spell it
  `export { authHeader, trpcData };` — `map-test-helper.ts:12` and
  `homebrew-test-helper.ts:10`. Eleven module paths in total counting `trpc-helpers.ts:8`
  itself. Adoption is split toward the helper path: 26 test files import `trpcData`
  straight from `../test/trpc-helpers.js`, while 39 reach it through a domain helper
  (plus `encounter-combat-test-helper.ts`, which does the same) — usually inside an import
  statement that also pulls `setupXTestContext` and friends from the same module (e.g.
  `routers/rest.test.ts:10`, `routers/npc.test.ts:8`, `routers/encounter-map.test.ts:8-14`).
  Ten of those 39 go through the two combined re-exports (5 via `map-test-helper.js`,
  5 via `homebrew-test-helper.js`).
- Two-user/two-token setup block duplicated at `spell-test-helper.ts:28-35`,
  `rest-test-helper.ts:30-37`, `inventory-test-helper.ts:57-64`,
  `homebrew-test-helper.ts:38-45`. The four differ only in the `createTestUser` arguments
  (spell and rest pass `email`, inventory passes `email` + `displayName`, homebrew passes
  `displayName` only) and in local variable names; everything else — the two
  `Promise.all`s, the destructuring shape, the `mintAccessToken` pair — is byte-similar.
- `packages/server/src/routers/invite-preview.test.ts:29-40` — the newest instance of the
  pattern, written inline rather than through any helper: two `createTestUser` +
  `loginUser` pairs, then a raw `app.inject` on `/trpc/campaign.create` unwrapped with
  `trpcData<{ id: string }>(res.body)` and no status assertion.
- The five `prisma.character.create` sites are **not** a single fixture in five copies.
  `spell-test-helper.ts:37`, `rest-test-helper.ts:44`, and `inventory-test-helper.ts:66`
  each write a full six-ability `stats` block with different values and reach SRD rows
  three different ways (hardcoded `"species-human"`/`"class-wizard"` literals in spell and
  rest, the `SEEDED_SRD` constant in inventory). `encounter-test-helper.ts:40` and
  `map-test-helper.ts:37` write **no ability scores at all** (`stats: { create: { maxHp,
  currentHp } }`), resolve `species.id`/`background.id`/`classRow.id` from rows fetched at
  runtime, and then additionally `prisma.campaignMember.update(...)` to attach the
  character to the campaign. The five return values differ too (`characterId` alone,
  `{ownerToken, otherToken, characterId}`, a spread context, a bare `character.id`).
- `packages/server/src/test/fixtures.ts` — exports only `TEST_PASSWORD` (`:8`),
  `createTestUser` (`:23`), `createTestSession` (`:46`).
- `packages/server/src/test/MODULE.md:40` — `| Builder | File | State | Participants | Returns | Use when |`
  (six columns); `:41` — `| --- | --- | --- | --- | --- |` (five cells; confirmed with
  `cat -A`, no hidden sixth cell). The six data rows below all carry six cells, and the
  prose at `:37-38` directs readers to the last column.

## Proposed direction

Order matters here: the cheap fixes land first so the large sweep in step 6 is the only
commit anyone has to review carefully. **Only step 6 is mechanical.** Step 2 is a
compiler-checked signature change, step 3 deliberately changes failure behaviour, and
step 4 creates a new fixture API — none of those is a find-and-replace.

1. **Fix the MODULE.md table** — add the sixth delimiter cell at
   `packages/server/src/test/MODULE.md:41`. One-line commit. See
   `docs/guides/add-module-doc.md`.
2. **Drop the vestigial `_app` parameter** from `setupHomebrewTestContext`
   (`homebrew-test-helper.ts:31`), `setupRestContext` (`rest-test-helper.ts:20`), and
   `setupSpellTestContext` (`spell-test-helper.ts:21`), following the shape
   `setupInventoryTestContext` already has. Update the call sites (the compiler finds them
   all) and delete the three retention comments. Type-only change, no runtime behaviour.
3. **Rewrite `createCharacter` in `character-fixtures.ts:18-31`** to call
   `injectTrpcMutation<{ id: string }>` from `trpc-helpers.ts`, mirroring
   `campaign-test-context.ts:139-147`. This deletes the `:30` cast and its
   `type-assertion-boundary: test` marker at `:29` and, more importantly, adds the
   missing status assertion — today a failed `character.create` surfaces as an opaque
   destructuring error rather than `createCharacter failed: 4xx …`. This is a deliberate
   behaviour change: a suite that was silently tolerating a 4xx will now fail loudly. Run
   the full server suite on this commit alone, and fix whatever it exposes in the same
   commit rather than reverting the assertion.
4. **Consolidate only the part that is actually duplicated: the two-actor block.** Add a
   `createTwoActors(opts)` helper to `packages/server/src/test/fixtures.ts` returning
   `{ owner, other, ownerToken, otherToken }`, taking the per-domain `createTestUser`
   arguments as parameters, and route `spell-test-helper.ts:28-35`,
   `rest-test-helper.ts:30-37`, `inventory-test-helper.ts:57-64`, and
   `homebrew-test-helper.ts:38-45` through it. That is the one block where the four copies
   really are the same code. `invite-preview.test.ts:29-40` is a fifth candidate, but it
   mints its tokens through `loginUser` rather than `mintAccessToken`; convert it only if
   `createTwoActors` can express that without a mode flag.

   **Do not add a shared `createTestCharacter` over the five `prisma.character.create`
   sites.** As Evidence records, they diverge on ability scores (present in three, absent
   in two), on how SRD ids are obtained (literals / `SEEDED_SRD` / runtime row lookups),
   on level and `hitDiceUsed`, on the trailing `campaignMember.update`, and on return
   shape. A helper covering all five would take every one of those as a parameter and
   would be a signature pass-through — the same anti-pattern the caveats already reject
   for `useTestApp()`'s `beforeEach` half. If a narrower seam is wanted, the honest one is
   a `createSpellcasterCharacter`-style helper shared by `spell` and `rest` only (those
   two differ solely in `level`/`hitDiceUsed`/HP constants), and even that is optional.
5. *(Optional, and not part of the duplication case.)* Delete the ten `trpcData`
   re-exports and point their consumers at `trpc-helpers.ts` directly. Be honest about the
   trade: there is only one `trpcData` implementation, so this removes no duplicated code.
   It buys one import path instead of eleven, at the cost of adding a second import
   statement to 39 test files (plus `encounter-combat-test-helper.ts`) that currently pull
   `trpcData` alongside their `setupXTestContext` from one module. Schedule it as a tidy-up
   if and when someone is already editing those files; do not spend a standalone commit on
   it, and do not let it block the rest of this leaf.
6. **Introduce `useTestApp()` in `packages/server/src/test/app-helper.ts`** — a wrapper that
   registers the `beforeAll`/`afterAll` pair and returns a handle exposing the app. Adopt it
   in a handful of files first, confirm the suite is green, then sweep the remaining 90.
   Expect this to remove roughly six of the ten duplicated lines per file. Do the sweep as
   its own commit with no other change in it. Normalising the two expression-bodied
   `afterAll`s is a side effect of the sweep, not a bug fix.
7. **Only after step 6 has settled**, consider per-domain `useEncounterContext()` /
   `useMapContext()` wrappers for the `beforeEach` half, starting with
   `setupEncounterTestContext` (27 files) since it is the only one with enough sites to pay
   for the indirection. Treat this as optional.

## Scope / caveats

- **`useTestApp()` cannot cover the `beforeEach`.** The `beforeEach` half fans out across
  14 distinct context setups, and 17 of the 90 files have no `beforeEach` at all. Only the
  app `beforeAll`/`afterAll` pair is truly universal. Do not design a single wrapper that
  tries to take a context factory as a parameter and cover both halves — that produces a
  helper with 14 call shapes, which is worse than the duplication it replaces. Step 7
  keeps them separate on purpose.
- **The same objection kills a five-site `createTestCharacter`.** It is the reason step 4
  is narrowed to the two-actor block. A helper whose parameter list is the union of five
  divergent `prisma.character.create` payloads is a signature pass-through, not a seam.
- **Do not delete `trpcData` itself** if you do the optional step 5. It is the real
  implementation at `trpc-helpers.ts:8`, carries a deliberate
  `@typescript-eslint/no-unnecessary-type-parameters` suppression and a
  `type-assertion-boundary: test` marker, and both must survive verbatim. Only the
  re-export lines go: the eight verbatim `export { trpcData };` lines, plus the `trpcData`
  specifier removed from `export { authHeader, trpcData };` in `map-test-helper.ts:12` and
  `homebrew-test-helper.ts:10` (keep `authHeader` in both — deleting those two lines
  whole breaks the five `map-test-helper.js` and five `homebrew-test-helper.js` consumers
  that import `authHeader` from them).
- **Preserve the existing test assertions and field values verbatim** when consolidating in
  step 4. `createTwoActors` must keep each caller's current `createTestUser` arguments
  (spell and rest pass `email`, inventory passes `email` + `displayName`, homebrew passes
  `displayName` only), not normalise them. A silent user or name change would move
  assertions in tests that were not otherwise touched, which is exactly the kind of diff
  that erodes trust in the sweep.
- The two "half-finished migration" observations (step 2) and the fixture work (steps 3-4)
  are genuinely the same cause as the lifecycle sweep — a helper layer built per-domain —
  so they belong in one leaf. The MODULE.md delimiter fix (step 1) does not; it is bundled
  purely because it is a one-line change in the same directory. Split it out if that is
  cleaner to schedule.
- **Only step 6 is mechanical.** Steps 1-5 are independently landable and individually
  small; step 6 is the only one with real size, and must not be bundled with anything
  else — a 90-file mechanical diff is only reviewable when it is mechanical.
- Follow `AGENTS.md`'s TDD and conventional-commit conventions; the server suite is the gate
  for every step here, so run the focused files you touch as you go rather than deferring to
  `verify:changed`. Step 6 registers `afterAll` teardown on behalf of 90 files, so read
  `docs/CONCURRENCY.md` before changing anything about how the test app or DB is torn down
  between files — server tests share a database.
- Refresh `packages/server/src/test/MODULE.md` at the end of steps 2, 4, and 6; its helper
  map at `:22-33` names `app-helper.ts` (`:22`), `character-fixtures.ts` (`:25`), the
  per-domain helpers (`:26-27`), and `fixtures.ts` (`:33`), and will be stale after each —
  step 4 adds `createTwoActors` to `fixtures.ts` and step 6 adds `useTestApp()` to
  `app-helper.ts`. See `docs/guides/add-module-doc.md`.
- **Sequence against leaf 40.** Both leaves rewrite `packages/server/src/test/`: leaf 40's
  step 3 adds promoted helpers to `map-test-helper.ts`, `homebrew-test-helper.ts`, and
  `encounter-combat-test-helper.ts`, and its step 9 sits next to `rest-test-helper.ts` — three
  of which this leaf's step 2 and step 4 also edit. Land **this leaf first**: leaf 40 adds
  functions to those modules, while this leaf changes their existing signatures, so doing
  it the other way round means rebasing leaf 40's additions onto changed setup contracts.
  No other leaf in this pack touches these files.
