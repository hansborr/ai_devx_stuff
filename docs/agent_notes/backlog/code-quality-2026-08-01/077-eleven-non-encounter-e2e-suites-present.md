# 77. Eleven whole-file serial E2E suites present shared-state workflow narratives as 77 nominally independent tests

Status: Not started
Theme: e2e test isolation · Area: e2e · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Eleven of the 21 e2e spec files — over half the area — are whole-file
`test.describe.configure({ mode: "serial" })` groups whose 77 `test()` entries
are largely steps of one workflow over state built once in `beforeAll`:
campaign-lifecycle walks a single shared campaign from empty state through
creation, rename, and deletion across seven ordered tests; inventory
progressively creates, edits, equips, attunes, and deletes one item set;
campaign-collab threads an invite → join → membership → revoke story through
fifteen `let` bindings at describe scope. The titles read as independent
contracts, but the structure gives them narrative semantics, and that costs
contributors three ways:

- **Failures suppress contracts.** Serial mode skips every remaining test in
  the group after one failure, so a broken step 3 turns steps 4-8 into skips —
  the report says nothing about whether those contracts still hold, and a
  single regression reads as a mass outage of the suite.
- **Prerequisites live in source order.** What a test needs is whatever the
  tests above it happen to have left behind — a `sheet` page object assigned
  inside an earlier test, a campaign created two tests up. Nothing in the test
  body states the dependency, so reordering, deleting, or focusing a test is a
  hazard the file gives no warning about.
- **The suites overstate their granularity.** 77 named tests suggest 77
  independently runnable checks; in practice many are mid-story frames.
  (Not all: some tests create their own immediate prerequisites — inventory's
  "add an item" creates the item it asserts — so the defect is the group-level
  skip cascade and the substantial shared-state dependency, not a blanket
  inability to run anything alone.)

Genuinely independent contracts are trapped inside the same serial groups —
campaign-chat's "empty input disables send button" needs a campaign, not the
preceding message exchange — paying cascade-skip costs for no isolation
benefit, while the typed API-seeding substrate that could stand them up
directly already exists in `e2e/helpers/`. The encounter-combat suite has the
same shape but is excluded: keeping it serial is a recorded decision
(CQ25-162).

## Evidence

- 12 spec files declare whole-describe serial mode
  (`grep -rn 'mode: "serial"' e2e/*.spec.ts`): campaign-chat.spec.ts:5,
  campaign-collab.spec.ts:17, campaign-lifecycle.spec.ts:9,
  campaign-notes.spec.ts:6, campaign-npcs.spec.ts:6,
  character-data-integrity.spec.ts:9, character-sheet.spec.ts:9,
  dice-roller.spec.ts:5, inventory.spec.ts:9, notifications.spec.ts:15,
  spell-rest.spec.ts:8, and encounter-combat.spec.ts:54. Excluding
  encounter-combat leaves the 11 groups in scope.
- Re-derived test counts per serial group: campaign-chat 7, campaign-collab
  10, campaign-lifecycle 7, campaign-notes 8, campaign-npcs 6,
  character-data-integrity 8, character-sheet 7, dice-roller 5, inventory 7,
  notifications 5, spell-rest 7 — total 77.
- `e2e/campaign-lifecycle.spec.ts:17-24` — `beforeAll` builds one shared
  `page`, `campaignName`, and page objects; seven ordered tests at `:30-70`
  run empty state (`:30`) → create (`:35`) → rename via settings (`:62`) →
  delete (`:70`) against that one campaign.
- `e2e/inventory.spec.ts:37-80` — seven tests progressively create ("add an
  item", `:41`), edit (`:61`), equip (`:69`), attune (`:74`), and delete
  (`:80`) one shared inventory.
- `e2e/character-data-integrity.spec.ts:27` — the first test creates the
  character; the second assigns the shared `sheet` page object at `:39`; the
  six tests at `:43-73` consume it, so a create-step failure skips all
  proficiency/feature assertions. The separate non-serial "Wizard validation"
  describe at `:78` is outside the serial group and outside the 77.
- `e2e/campaign-collab.spec.ts:19-37` — fifteen `let` bindings at describe
  scope (two browser contexts, users, `campaignId`, `inviteCode`); ten tests
  at `:91-162` thread invite-create → join → member-list → character-assign →
  revoke through them.
- `e2e/campaign-chat.spec.ts:55`, `:60` — "empty input disables send button"
  and "chat input clears after sending" are order-independent contracts riding
  the same serial narrative as the DM/player message exchange at `:32-50`.
- Seeding substrate already in place: `e2e/helpers/api.ts:7` imports the
  server's `AppRouter` types (tRPC-typed `apiRegister`/`apiLogin`/
  `apiCreateCharacter`/`apiCreateInventoryItem`, `:114-202`);
  `e2e/helpers/campaign-setup.ts:50` `setupUserWithCharacter` and `:83`
  `setupDmAndPlayer` (returning `DmPlayerCampaign`, `:18`) compose them.
- `e2e/helpers/api.ts:12-21` — the documented origin split: token-
  authenticated data-seeding helpers use the direct server base URL, while any
  request whose `Set-Cookie` the page must later present goes through the
  client origin (host-scoped `musi_refresh` cookie).
- `playwright.config.ts:31` — `fullyParallel: false`; `:34` — `workers: 4`.
  Dropping a serial directive alone changes nothing; parallelism within a file
  requires an explicit `mode: "parallel"` opt-in
  (e.g. `e2e/wizard-validation.spec.ts:12`, the landed testsuite-audit leaf-04
  idiom).

## Proposed direction

Plan-first (this is the needs-split part): the fix is a per-suite triage, not
one sweep.

1. **Author a plan with an 11-row disposition table** — one row per suite
   giving (a) the scenario-vs-independent split of its tests, (b) the seeding
   helper each independent contract will use, (c) the suite's final mode
   directive. Classify each of the 77 tests as either a step in one genuine
   workflow or an independent contract that merely rides the shared
   `beforeAll` setup. Judge each row on the copyable pattern
   (scenario-with-steps vs seeded-independent), not on removing serial
   directives: keeping `serial` on a suite whose per-test seeding cost would
   be prohibitive is an acceptable outcome as long as the narrative is folded
   into scenarios. Land the work as per-suite or small-batch slices off that
   table.
2. **Collapse genuine narratives into scenario tests.** A real workflow
   (campaign-lifecycle's empty-state → create → rename → delete, inventory's
   equip/attune chain) becomes a single scenario `test()` whose former test
   titles become named `test.step()` calls. A mid-flow failure then fails one
   honestly-named scenario instead of cascade-skipping siblings, and the step
   names in the Playwright report preserve the executable-documentation value
   of the old titles.
3. **Seed independent contracts through the existing typed substrate.**
   Contracts that only need state to exist (character-data-integrity's
   sheet-reading tests, campaign-lifecycle's tab-navigation and badge checks,
   campaign-chat's input-behavior tests) get their own state via
   `e2e/helpers/api.ts` tRPC-typed calls and `e2e/helpers/campaign-setup.ts`
   (`setupUserWithCharacter`, `setupDmAndPlayer`/`DmPlayerCampaign`), then
   become ordinary standalone tests. Honor the `api.ts:12-21` contract:
   token-authenticated seeding goes to the direct server base URL; only flows
   whose `Set-Cookie` the page must present route through the client origin.
   Do not add extra full UI logins for seeding.
4. **Only then touch mode directives.** Once — and only once — a describe
   carries no cross-test mutable state, replace its
   `test.describe.configure({ mode: "serial" })` with an explicit
   `mode: "parallel"` opt-in per the testsuite-audit leaf-04 idiom
   (`docs/agent_notes/backlog/testsuite-audit/04-e2e-fullyparallel-serializes-independent-tests.md`).
   `fullyParallel` stays `false`, so dropping serial without the opt-in
   changes nothing; suites still mutating the single globally-seeded user's
   data must keep `serial` until their seeding is truly per-test. Verify each
   converted suite in isolation with `bun run e2e -- e2e/<suite>.spec.ts`.

Read `docs/guides/add-e2e-test.md` before editing the specs.

## Scope / caveats

- **CQ25-162 is a binding do-not-reopen constraint**: `encounter-combat.spec.ts`
  stays serial and is entirely out of scope. Its narrative decomposition was
  separately proposed as prior-pack leaf
  `docs/agent_notes/backlog/code-quality-2026-07-25/42-e2e-encounter-narrative.md`
  and not promoted; do not fold it in here.
- `wizard-validation.spec.ts` is out of scope on both ends: its top-level
  `mode: "parallel"` and its 2-test scoped `describe.serial` "Character
  creation with feat backgrounds" block (`:161`) were deliberately set by
  testsuite-audit leaf 04.
- The non-serial "Wizard validation" describe at the tail of
  `e2e/character-data-integrity.spec.ts:78` is not in the 77 and must not be
  touched.
- The global `fullyParallel` flag is out of scope; this leaf works strictly
  through per-file mode directives.
- No page-object or assertion-content changes — raw-locator cleanups in these
  same specs belong to
  [079-e2e-specs-bypass-page-objects-through-raw.md](./079-e2e-specs-bypass-page-objects-through-raw.md);
  avoid working the two concurrently in one spec file.
- **Risks** (fold into the plan's per-row judgment): scenario folding trades
  retry granularity — one flaky step now retries the whole workflow, and
  per-contract pass/fail reporting coarsens to step level. De-serializing a
  suite that still mutates shared server-side state (the globally-seeded
  user, campaign membership, spell-rest's slot/rest state, notification
  state) races under `workers: 4` — applying `mode: "parallel"` before
  seeding is truly per-test converts hidden ordering into intermittent
  failures. Naive per-test seeding that reintroduces full UI logins instead
  of token-auth API seeding materially inflates e2e wall time.
- Builds on two already-landed testsuite-audit leaves — 03 (per-context API
  login, Implemented 2026-07-19) and 04 (per-file `mode: "parallel"` opt-in,
  Done 2026-07-19, which named independent seeding as the prerequisite this
  leaf now supplies) — so there is no pending dependency, but reuse leaf 04's
  opt-in pattern rather than touching `fullyParallel`.
