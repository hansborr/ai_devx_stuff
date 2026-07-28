# 42-PLAN. Encounter combat E2E: scheduling plan

Status: Planned — **shrinks leaf 42 from XL to two S slices plus one gated
carve-out; the four-way spec extraction is dropped, and the `00-index.md`
constraint on `e2e/encounter-combat.spec.ts` is upheld, not overturned**;
supersedes the Proposed direction in
[`42-e2e-encounter-narrative.md`](./42-e2e-encounter-narrative.md)

Date: 2026-07-26 · Area: tests (e2e) · Source leaf: 42 (XL)

Cross-model planning session: `consult codex` (own subagents across e2e
architecture, isolation risk, wall-clock cost and framing, synthesized) and
`consult cursor` (Grok, "is there a fundamentally better shape for this test
suite"). Both were asked independently. Where they disagreed, the call and the
reason are in [Rejected alternatives](#rejected-alternatives--why). Every count
below was re-measured against `c69ce720`; `git diff 883d48bf..c69ce720` is empty
for `e2e/`, so the leaf's line anchors are current.

## Verdict

**Do not extract. Leaf 42's diagnosis is right and its remedy is not worth an
agent-week.**

Both consults returned that independently — codex "drop leaf 42 as an XL
refactor, do not do step 1 and stop", cursor "demote to seed-helper-only after
leaf 47; do not extract". They disagreed only on whether the seeding helper
should be built now on spec. That disagreement is resolved below: it is carved
out behind a demand gate.

What replaces the leaf is two small in-place slices that take the *measurable*
costs the leaf is actually complaining about — a deterministic ~15-second dead
wait inside one restoration block, and a cross-test cleanup that belongs to its
consumer — plus one slice the leaf never considered that is the largest single
wall-clock lever available in `e2e/` today.

`00-index.md`'s constraint ("Do not split `e2e/encounter-combat.spec.ts` … before
reusable API seeding exists") is **upheld**. This plan does not split the file at
all, so the constraint is not reached. The lifecycle stays serial, all 22 tests
stay in one file.

## Corrections to the leaf, verified

**1. The turn-pointer dependency is wider than the leaf says.** The leaf cites
only `combat-actions.ts:57` and concludes that two of the three "remainder" tests
depend on the restored pointer. The same rule applies to non-DM *combat spells*:
`packages/server/src/services/spell-casting/spell-casting.ts:25-32`
(`assertCasterTurnFastPath`, called at `:92`) throws `FORBIDDEN` /
`NOT_PARTICIPANT_TURN` on `!isDm && casterSortOrder !== currentTurnIndex`. Both
consults found this independently. **Five** tests depend on the pointer the
`:373-390` block re-establishes, not two:

| Test | Why |
|---|---|
| `:393` drawer access | asserts `expectCurrentParticipant(playerCharName)` at `:399` |
| `:452` player weapon attack | `combat-actions.ts:57` |
| `:478` Fire Bolt | combat cast → `spell-casting.ts:25-32` |
| `:517` Sacred Flame | combat cast |
| `:541` Fireball | combat cast |

`:589` Fog Cloud, `:616` concentration-cancel and `:638` ambiguous-source Fire
Bolt go through `castSpell.cast` and do **not** need the pointer.

**2. Five API wrappers cannot produce the claimed scenario — a sixth is
mandatory.** Both consults found this independently and it is verifiable:
`participant-action.ts:185` calls `validateCharacterForCampaign`, which at
`packages/server/src/utils/encounter-helpers.ts:53-65` rejects any character
whose `campaignMember.campaignId` is not the encounter's campaign. So a character
participant cannot be added over the API until the character is assigned to a
campaign member. `campaign.assignCharacter` exists at
`packages/server/src/routers/campaign.ts:225` and has **no** wrapper in
`e2e/helpers/api.ts`. Without it the seed helper still has to run the Members-tab
UI at `encounter-combat.spec.ts:173-180`, and remains hybrid — which removes most
of its reason to exist.

**3. The extraction is not wall-clock-neutral, and the leaf's own framing of why
is incomplete.** `playwright.config.ts:31,34` sets `fullyParallel: false` with
`workers: 4`, so the parallel unit is the spec file — the leaf has that right.
What it misses is the **irreducible per-file cost**: `setupDmAndPlayer`
(`e2e/helpers/campaign-setup.ts:83`) ends with two `browser.newContext()` and two
full UI logins (`:116`, `:120`), and a shared Playwright `storageState` is
explicitly prohibited (`e2e/MODULE.md:40-44`, decision recorded in
`docs/agent_notes/backlog/testsuite-audit/03-e2e-userpage-relogin-instead-of-storagestate.md`).
Every extracted spec re-pays that, plus its own character creation, five
`apiLevelUpCharacter`s and spell setup. An API seed removes only the
encounter-creation chain (`:199-306`). Four rich files means four campaigns and
eight browser contexts against the same four workers, which are already shared
with 20 other spec files. Splitting trades a shorter possible critical path for
substantially more total setup work, and no committed timing data exists either
way.

**4. The second restoration block protects exactly one test.**
`:695-698` (`playerPage.goto('/campaigns/${ctx.campaignId}')`) exists for
`:719 player sees resolved encounter`, which does `reload()` then
`playerDetail.clickTab("Encounters")` at `:720-721`. `:703` and `:713` are
DM-only. That makes it a one-line fix in the consumer, not seeding infrastructure.

**5. The first restoration block burns a deterministic ~15 seconds.** The loop at
`:379-386` iterates four `TIMEOUT_SHORT` attempts; `TIMEOUT_SHORT` is `5_000`
(`e2e/helpers/timeouts.ts:4`). The encounter has four participants (`:210-214`:
DM character, player character, Goblin Warrior, Commoner). Having just advanced
one step past the player, returning to them takes three advances — i.e. **three
guaranteed 5-second failed waits** before the fourth check succeeds. The loop
also has **zero slack**: a fourth required advance would fall out of the loop and
fail at `:387`. Codex found both facts.

**6. Minor.** The `beforeAll` spans `:69-191`, which is 123 physical lines, not
122. The file is 779 lines (`wc -l`), as the leaf says.

## Step disposition

| Step | Call | Reason |
|---|---|---|
| 1. Five wrappers + composed active-encounter seed | **Carve out behind a demand gate** | Needs a sixth wrapper (correction 2) and has no consumer once the extractions are dropped. See the ruling below. |
| 2. Extract HP attribution | **Drop** | Worst economics in the pack: a complete active scenario, two browser contexts and two UI logins for one test. Its only stated win — deleting the `:695-698` block — is delivered by slice 42.1 for one line. |
| 3. Extract drawer authorization | **Drop** | Two tests. The parallelism gain does not repay a duplicated two-browser setup, and both tests assert against the restored turn pointer (correction 1). |
| 4. Extract spell casting | **Drop** | The block is itself an ordered browser narrative: `:524`, `:551`, `:595` and `:628` each open a token drawer inheriting the route and drawer cleanup from their predecessor, and `:642-645` permanently levels the sorcerer so it must stay after the combat Fire Bolt. Moving six tests to a default-mode file would not make them isolated. |
| 5. Give the turn-dependent remainder their own precondition | **Reshape** → 42.1 | Optimise the restoration in place. Do not build seeding infrastructure whose only purpose is to delete a comment. |
| 6. Keep the lifecycle serial | **Keep as a standing constraint** | Already true, and the landed `testsuite-audit` leaf 04 (Done 2026-07-19) names `encounter-combat` explicitly among the specs to leave serial. |

### Step 1 ruling: carved out behind a demand gate

This is where the consults split. Cursor: build the seed helper (≈M) after leaf
47 and stop — "it is the unlock for the *next* combat e2e". Codex: do not build
it — "speculative infrastructure with no second consumer".

**Call: carve it out, scope it, and gate it on demand rather than scheduling it.**

- Codex is right that shipping an unused two-browser scenario builder is
  speculative, and the leaf's own justification for it ("without it each
  extracted file re-pays the whole `beforeAll`") evaporates once the extractions
  are dropped.
- Cursor is right that it is the correct shape for the *next* combat e2e, and
  that writing it after leaf 47 is much cheaper than writing it before.

So: **do not schedule it. Build it when a second consumer appears** — a new
combat e2e spec, or a decision to revisit extraction with timing data in hand.
When that happens, these constraints apply and are not re-litigable:

- Six wrappers, not five: `encounter.create`, `encounter.addParticipant`,
  `encounter.setInitiative`, `encounter.transitionState`,
  `encounterCombat.advanceTurn`, **and `campaign.assignCharacter`**
  (correction 2). No `rollAllInitiative` wrapper — the seed needs a fixed order.
- Land after leaf 47 so the wrappers infer from `AppRouter` rather than being
  hand-typed and then re-typed.
- Layer it. A single helper that returns two pages plus four page objects
  over-provisions every consumer: HP attribution needs two pages but only a DM
  encounter PO and a player sheet PO; the spell tests need the player browser and
  DM API credentials; only drawer authorization needs all four.
- The monster seed must carry explicit HP/AC and the SRD `monsterId`
  (`packages/shared/src/schemas/encounter-inputs.ts` is the input contract) — the
  Commoner's structured Club versus the Goblin Warrior's ambiguous actions is
  load-bearing for `:463` and `:638`.

## Slices

Two slices. Each is one agent session. Both are independently landable and
neither splits a spec file.

| # | Scope | Done criteria | Verification |
|---|---|---|---|
| **42.1** | **Make the two serial-flow invariants cheap and locally owned (S).** Keep all 22 tests and `test.describe.configure({ mode: "serial" })`. (a) Rewrite the restoration loop at `e2e/encounter-combat.spec.ts:379-386` so it *reads* the current participant and advances until it is `playerCharName`, instead of spending three guaranteed 5-second `expect(...).toContainText` failures (correction 5). `EncounterPO.currentParticipantName()` is already used at `:353`, `:354`, `:360`, `:364`, `:368` and `:389`; poll that, or read the initiative list once per iteration, and keep a bounded attempt count with a clear failure message. Keep the two closing assertions at `:387-390` — the DM/player convergence check is the part of the block that is a real assertion. Keep the `// Restore the serial-flow invariant:` comment and its explanation; the mechanism changes, the documented precondition does not. (b) Delete the second restoration block at `:695-698` entirely and give `:719 player sees resolved encounter` its own precondition: replace its `ctx.playerPage.reload()` at `:720` with `await ctx.playerPage.goto(\`/campaigns/${ctx.campaignId}\`)` before `clickTab("Encounters")`. That is the only test the block protects (correction 4). | 22 tests still present and passing; `grep -c "Restore the serial-flow invariant" e2e/encounter-combat.spec.ts` returns 1; the file's wall clock drops by roughly 15s; no test body outside `:373-390` and `:695-721` is touched | `bun run e2e -- e2e/encounter-combat.spec.ts` — run it **three times** and compare the reported durations against a pre-change baseline run on the same machine |
| **42.2** | **Stop paying two full UI logins per multi-browser spec (S).** In `e2e/helpers/campaign-setup.ts`, replace `loginViaUi(dmPage, …)` (`:116`) and `loginViaUi(playerPage, …)` (`:120`) in `setupDmAndPlayer` with `loginViaApi(dmContext, …)` / `loginViaApi(playerContext, …)` before each page is created, mirroring exactly what `e2e/fixtures.ts:14-33` already does for `userPage`: API login onto the *context*, then `page.goto(...)` raced against `page.waitForResponse(r => r.url().includes("auth.refresh"))` with an `ok()` assertion, because the client re-hydrates its access token from the cookie at mount. `loginViaApi` is exported from `e2e/helpers/auth.setup.ts:24` and already imported by the fixture. Update the now-wrong `// --- Browser login (required for session cookies) ---` comment at `:113` — the API login sets the same cookie. Five specs benefit immediately: `encounter-combat`, `campaign-chat`, `campaign-notes`, `campaign-npcs`, `dice-roller`. *Optional second commit:* the same swap in `setupUserWithCharacter` (`:68`), which additionally needs an explicit `goto("/dashboard")` before its `getByRole("link", …).click()` at `:71` — that benefits `spell-rest` and `character-sheet`. **Do not** touch `e2e/auth-refresh.spec.ts` — it is the login-subject spec and `e2e/MODULE.md:43` reserves `loginViaUi` for exactly that. | All five consumer specs green; `grep -rn "loginViaUi" e2e/` shows it only in `auth.setup.ts` (definition + `registerAndLogin`), `auth-refresh.spec.ts`, `campaign-collab.spec.ts` and `notifications.spec.ts`; suite wall clock measurably lower | `bun run e2e -- e2e/encounter-combat.spec.ts e2e/campaign-chat.spec.ts e2e/campaign-notes.spec.ts e2e/campaign-npcs.spec.ts e2e/dice-roller.spec.ts` — twice, since this changes an auth path shared by every one of them |

### Dependency edges

- **`42.1 ∥ 42.2`** — different files (`encounter-combat.spec.ts` versus
  `helpers/campaign-setup.ts`), no shared symbol. Either order, but they both
  change the same spec's wall clock, so land them separately and measure
  separately or you cannot attribute the change.
- **`47` is no longer a prerequisite.** With the wrapper work carved out, neither
  slice touches `e2e/helpers/api.ts`, so `47 → 42` no longer holds. Leaf 47 and
  these two slices are fully independent. The dependency returns only if the
  carved-out seeding work is ever revived.
- **42.2 reaches outside leaf 42's stated surface** and that is deliberate: it is
  the only measured lever on the per-file setup cost the leaf's whole argument
  turns on, and it has an immediate consumer today rather than a hypothetical
  one. No other leaf in this pack owns `e2e/helpers/campaign-setup.ts`; leaf 47
  owns `e2e/helpers/api.ts` only.

### Index reconciliation (whichever slice lands first applies these)

1. `00-index.md`, "Read this first": leaf 42 is no longer XL. Point its row at
   this file and mark it S.
2. `00-index.md`, "Do not start with": remove 42 from the XL list.
3. `00-index.md`, sequencing line: drop `47→42`.
4. `00-index.md`, "Constraints on future proposals": the
   `e2e/encounter-combat.spec.ts` row stays, and should be strengthened — this
   plan drops the split rather than performing it, so the row's "Leaf 42 owns the
   split" clause should become a pointer to this file's step-1 demand gate.
5. `42-e2e-encounter-narrative.md`: add a Status pointer to this plan and record
   that steps 2-4 are dropped permanently, so they are not re-scheduled from the
   leaf.

## Operational risks

- **42.2 is the riskier of the two and the risk is auth, not tests.** The client
  boots without an in-memory access token and re-hydrates from the `musi_refresh`
  cookie at mount; `e2e/fixtures.ts:22-33` documents this and waits for the
  `auth.refresh` response before proceeding. If the wait is omitted,
  `setupDmAndPlayer`'s consumers get intermittent unauthenticated first renders
  that look like product bugs. Copy the fixture's shape exactly. The fallback is
  two lines — revert to `loginViaUi`.
- **42.2 must not weaken per-context session isolation.** `loginViaApi` posts to
  the *client* origin so the cookie lands on the same host the page loads from
  (`auth.setup.ts:20-53` explains why, and throws if the cookie is missing).
  Each context gets its own `musi_refresh` and its own session row, which is the
  whole reason a shared `storageState` was rejected. Do not hoist the login above
  the per-context boundary.
- **42.1's restoration loop has zero slack today** (correction 5). Whatever
  replaces it must fail with a message naming the expected and actual current
  participant, not time out silently — the current form would already break if a
  fifth participant were ever added.
- **Do not delete the `// Restore the serial-flow invariant:` comment in 42.1(a).**
  It is the specification of a precondition five later tests depend on
  (correction 1). Only its *mechanism* changes.
- **Do not de-serialise anything.** `testsuite-audit` leaf 04 (Done, 2026-07-19)
  already adjudicated which e2e specs may opt into per-file parallel mode and
  explicitly excluded `encounter-combat`. `mode: "serial"` here is what turns a
  mid-chain failure into skips rather than fifteen confusing red tests;
  `fullyParallel: false` is what orders it.
- **e2e is off the per-commit path** (`e2e/MODULE.md:45-46`). Both slices must be
  verified by running the specs directly; `verify:changed` will not cover them.
- **Neither slice touches production code**, so nothing user-facing can regress.
  A red spec after either slice is a test-infrastructure defect, not a product
  bug — but it will not look like one, which is why 42.2 names a two-line revert.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **Scheduling leaf 42 as an XL, i.e. steps 1-4 as written** | Both consults independently returned "do not extract". Nine tests move, three tests are left homeless between the lifecycle and the extracted blocks, four new spec files each re-pay a two-browser setup that cannot use `storageState`, and the wall-clock outcome is unknown in the losing direction. |
| **Building the seeding helper now anyway (cursor's position)** | Correct shape, no consumer. With the extractions dropped, step 1 ships an unused two-browser scenario builder whose correctness burden (initiative order, participant/token linkage, turn pointer, monster action fidelity) is paid up front and validated by nothing. Carved out behind a demand gate instead of dropped, because cursor is right that it is what the *next* combat spec should be built on. |
| **Overturning the `00-index.md` constraint** | Nothing here needs to. The constraint forbids splitting before reusable seeding exists; this plan does not split at all. The constraint's reasoning also survives review intact — the serial structure is deliberate and the shared mutable `let`s are real. |
| **Extracting HP attribution as a "cheap proof" of the seed** | It is the *worst* economics in the set, not the best: one test, full active scenario, two contexts, two UI logins. Its only advertised win is deleting `:695-698`, which slice 42.1 does by moving one line into the consuming test. |
| **Extracting the six spell tests** | They are browser-ordered independently of the turn pointer: `:524`, `:551`, `:595`, `:628` each open a token drawer inheriting route and drawer cleanup from the previous test, and `:638`'s ambiguous-source case permanently levels the sorcerer, so it must run after the combat Fire Bolt at `:478`. A default-mode file would not isolate them; a serial file would reproduce the problem one directory over. |
| **Removing `mode: "serial"` from the lifecycle** | The leaf agrees, `00-index.md` agrees, and `testsuite-audit` leaf 04 already adjudicated it as Done. Not reopened. |
| **Playwright worker-scoped fixtures for the encounter** | Shares mutable combat state across whatever files a worker happens to receive, and buys little over the existing `beforeAll`. Both consults rejected it. |
| **A shared `storageState` / `test.use` auth state** | Explicitly prohibited: the server rotates `musi_refresh` on every refresh, so a shared cookie goes stale after the first context boots (`e2e/MODULE.md:40-44`, decision recorded in `testsuite-audit/03-*`). `test.use` configures options; it does not own database scenario state. |
| **A project-level `globalSetup` encounter seed** | `e2e/global-setup.ts` provisions the DB and the shared user. Putting a combat scenario there creates suite-wide mutable state shared by four workers — the opposite of what the leaf wants. |
| **A unique campaign and encounter per test** | Correct isolation, disproportionate cost: nine full encounter seeds where one narrative currently runs. Reconsider only if the file is ever genuinely split. |
| **Doing nothing at all** | The two things this file actually costs its readers are measurable and cheap to fix: ~15 seconds of guaranteed dead wait, and one cleanup statement living in the wrong test. Both consults independently arrived at some version of that residue. |
