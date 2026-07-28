# UX/UI Audit — Implementation Roadmap

Date: 2026-04-15
Revalidated: 2026-04-27 — every item re-checked against current HEAD. File paths/line numbers on shipped items struck; partial items re-scoped to what remains; see "Revalidation summary" below.
Source: `SUMMARY.md` → "Suggestions — recommended action plan" (28 items) + honorable mentions + backend follow-ups.
Method: Each item investigated by a subagent against the live codebase. File paths and line numbers verified at time of writing.

## Revalidation summary (2026-04-27, corrected 2026-07-25)

**Shipped since audit (15)**: 1.1, 1.2, 1.3, **1.4**, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, **2.4**, 2.13, **2.14**, and the axe-core half of 3.7.
**Partial — remaining work scoped inline (6)**: 1.5, 2.1, 2.5, **2.9**, **3.4**, 3.7.
**Stale paths — still valid, line numbers refreshed (1)**: 2.10.
**Untouched (still valid)**: 2.2, 2.3, 2.6, 2.7, 2.8, 2.11, 2.12, 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.9.

> **Caution — treat the 2026-04-27 revalidation as unverified.** Four of the
> corrections above were already on `main` when that pass ran and it still
> classified them as open: 1.4 (`07cae114`, 2026-04-16), 2.9's Collections
> surface (`78159665`, 2026-04-19), 2.14 (`351a30ab`, 2026-04-20), and 2.4
> (`39e4292e`, 2026-04-25). The 2.4 case is the clearest tell:
> `VERIFICATION.md:66` asserts that `attack-roll-dialog.tsx:26` "still pins
> `mode: "custom"`" — text last written 2026-04-23, two days before the file
> was deleted outright — and the revalidation carried that assertion forward
> instead of re-checking the tree. That pass therefore looks like a re-read of
> these documents rather than a live-tree check.
>
> **If you are using this roadmap as an execution backlog, re-verify each item
> against `main` before promoting it.** Assume any "Now"/"Untouched" claim here
> may describe files or symbols that no longer exist.

This document is a **rough roadmap**, not a commitment. It is ordered by phase (quick wins → medium → larger) and, within phases, by user-visible impact. Every item lists the touched files, the current state, a concrete change list, and an S/M/L complexity estimate.

Notes on the complexity scale:
- **S** — ≤ 0.5 day. One file, one helper, or a targeted search-and-replace.
- **M** — 1–3 days. Multiple files, schema change, or new UI component.
- **L** — ≥ 1 week. Cross-package, backend schema + UI + tests, or structural refactor.

---

## Phase 1 — Quick wins (≤ 1 day each)

These fix trust-breaking or on-ramp issues cheaply and unblock subsequent work.

### 1.1 Character sheet "Unknown" skeleton (top-11 #1) — **Shipped**
- `use-srd-lookups.ts:10` exports `SRD_LOOKUP_FALLBACK = "—"` and every `"Unknown"` fallback has been replaced with it (e.g. `sheet-header.tsx:25`). `CharacterSheetContent` (`character-sheet-page.tsx:468`) and the outer page (`:672`) now render `<SheetSkeleton />` while `srd.isLoading` / `characterQuery.isLoading`, so the fallback em-dashes no longer flash before data resolves.
- The batched-tRPC 404-on-reload race (token refresh at the Fastify adapter) is a separate investigation, not part of the audit. Tracked under Open questions below if it needs a home.

### 1.2 Mobile hamburger nav (top-11 #3) — **Shipped**
- Landed as `MobileNavMenu` in `packages/client/src/components/app-header.tsx:40-82` using a Radix `Sheet` (not `Popover` as originally specced — `Sheet` is the better fit for a full-height drawer on mobile). Menu button `sm:hidden`; contains Campaigns, Homebrew, Magic Items, Settings, Logout.

### 1.3 Mutation-feedback sweep (top-11 #10, partial #9) — **Shipped**
- Success toasts: `campaign-settings-panel.tsx:52` (`toast.success("Settings saved.")`), `create-campaign-dialog.tsx:91` (`toast.success("Campaign created!")`), `invite-panel.tsx:25` (`toast.success(successMessage)`).
- The shared Phase 6.5 primitive (`lib/trpc-error.ts`, `lib/toast-messages.ts`) covers the generic error branch. Combat-flow mutations now route through it directly — see `hooks/vtt-drawer/use-weapon-attack.ts:75` (`attemptAttack`) and the rest of `hooks/vtt-drawer/use-*.ts`. The earlier `lib/combat-mutation-error.ts` / `components/campaign/use-combat-mutations.ts` layer that preferred server `error.message` and ran a hard-fail `close` side-effect was removed when those flows moved onto the shared primitive; the gap that previously had its own follow-up note is gone with it.
- Open follow-up if a consumer's copy actually reads awkwardly: the `NOT_FOUND` catalog string at `packages/client/src/lib/toast-messages.ts:4` is `Couldn't ${action} — not found.`, which is natural for "update HP" but reads oddly for verbs like "save note" or "create encounter". Several non-HP consumers already use `onTRPCError` (`use-weapon-attack`, `use-feature-use`, `use-drop-concentration`, `use-confirm-cast`) without anyone reporting awkward copy in practice. Reword the catalog entry — or add a per-entry override hook to `OnTRPCErrorOptions` — only when a real consumer's `NOT_FOUND` toast looks wrong. Don't preempt.

### 1.4 Invite copy-code / URL paste (area #Onboarding) — **Shipped**
- The two-button split landed in `07cae114` ("accept pasted invite URLs and split copy-code vs copy-link"), dated 2026-04-16 — i.e. *before* the 2026-04-27 revalidation that still listed this item as open. `invite-panel.tsx:54` is `handleCopyCode` (copies `invite.code`, toast "Code copied") and `:58` is `handleCopyLink` (copies the `/join/<code>` URL, toast "Link copied").
- Server-side URL-strip (`extractInviteCode` in `campaign-inputs.ts`) was already done.

### 1.5 Copy rewrite — empty states, error states, Zod messages (top-11 #11) — **Partial (S remaining)**
- **Done**: user-facing `.min(1)` calls in shared schemas now carry `{ message: "…" }` (see `campaign-inputs.ts:16, 47`; `note-inputs.ts:20, 38`). Remaining `.min(1)` sites are numeric / internal transforms that don't surface to users.
- **Remaining**: rewrite the 6 empty-state strings (`pages/dashboard-page.tsx`, `pages/campaigns-page.tsx`, `components/campaign/notes-panel.tsx`, `encounters-panel.tsx`, `maps-panel.tsx`, `components/sheet/inventory-panel.tsx`) in dark-fantasy voice; rewrite inline error-state strings in `invite-panel.tsx` and `encounter-detail-view.tsx`. Line numbers stale — grep the string to find it.

### 1.6 Motion-safe skeleton animation (area #Theme) — **Shipped**
- All skeleton sites now use `motion-safe:animate-pulse`; zero raw `animate-pulse` remain outside tests.

### 1.7 Wizard species subspecies validator (honorable mention) — **Shipped**
- `STEP_VALIDATORS.species` at `wizard-state.ts:262` now reads `s.speciesId !== "" && (!s.speciesHasSubspecies || s.subspeciesId !== "")`. Next button disables via `wizard-navigation.tsx:33` on `!canAdvance`.

### 1.8 "Link character tokens" rename + toast (area #Combat) — **Shipped**
- Shipped in commit `3339077`. `encounter-map-link.tsx:76` title is "Link character tokens"; `:49` emits "No character tokens to link — all PCs are already placed." on the 0-count branch.

### 1.9 Dashboard heading + primary CTA + hide-for-DM (top-11 #11 / area #Dashboard) — **Shipped**
- `pages/dashboard-page.tsx:207` ships `<h1>Your Tables</h1>` (covered by `dashboard-page.test.tsx:104`). The Campaigns CTA at `:210-212` is the default `Button` (primary variant). The DM-only CTA + `pickDmCampaign` persona logic at `:196-216` swaps in `<DmOnlyCta />` for DMs and hides the Characters panel.

### 1.10 `campaign.assignCharacter` auth (backend #5) — **Shipped**
- `campaign.assignCharacter` / `campaign.unassignCharacter` now call `assertCampaignMember` for the membership gate and `assertCharacterOwner` for the ownership gate. Non-owners attempting to assign someone else's character now get `NOT_FOUND` (matches the house-style info-leak rule on characters from `CLAUDE.md`), not `FORBIDDEN`. The redundant `findUnique({ where: { id: characterId } })` existence check was dropped — `assertCharacterOwner` already does it, and the P2002 catch still handles race-condition double-assignment. The `CampaignMember` update switched from `where: { id: membership.id }` (a local variable that no longer exists) to `where: { campaignId_userId: {...} }` (the composite unique), so we don't need to thread a membership id out of the helper.

### 1.11 `notification.markRead` single-query (backend #6) — **Shipped**
- `notification.markRead` now runs `updateMany({ where: { id, userId }, data: { read: true } })`; `count === 0` throws `NOT_FOUND` covering both missing and cross-user cases (no more `FORBIDDEN` info leak). A single `findUnique` after the update gets the row for `mapNotification`. Test `returns FORBIDDEN for another user's notification` renamed + updated to assert `404` and that the victim's row is untouched.

### 1.12 Login timing oracle (backend #2) — **Shipped**
- `services/auth-service.ts:12-59` implements `verifyPasswordOrDummy()` with a cached `DUMMY_PASSWORD_PLACEHOLDER` hash; both missing-user and wrong-password paths hit bcrypt before throwing `UNAUTHORIZED`.

---

## Phase 2 — Medium investments (1–3 days)

Grouped by domain. These close headline feature gaps and install infrastructure the rest of the roadmap leans on.

### 2.1 Encounter homebrew monsters UNION (medium #15, reference implementation) — **Partial**
- **Done**: adding a homebrew monster to an encounter works end-to-end (see `encounter.ts` homebrew-monster branch and the `homebrew-monster-tab.tsx` sibling view).
- **Remaining**: the intended UNION reference — `encounter.listAvailableMonsters(campaignId)` with `{source, collectionId?, collectionName?}` discriminator — has not shipped; the client still reaches SRD and homebrew through two separate tabs. Deliver the UNION before mirroring the pattern to spells / magic items in Phase 3.

### 2.2 Destructive-action ergonomics: AlertDialog + ConfirmDialog (top-11 #8) — **M**
- **Files**:
  - New: `packages/client/src/components/ui/alert-dialog.tsx` (shadcn CLI).
  - New: `packages/client/src/components/common/confirm-dialog.tsx` + `typed-confirm-dialog.tsx`.
  - Migrate: `delete-character-dialog.tsx`, `campaign/delete-confirm-dialog.tsx`, `campaign/end-encounter-dialog.tsx`, `homebrew/delete-collection-dialog.tsx`, `homebrew/delete-entry-dialog.tsx`, `pages/settings-page.tsx:184-216`.
  - Replace `window.confirm()`: `campaign/map-toolbar.tsx:72, 144`.
  - Upgrade: invite revoke in `campaign/invite-panel.tsx:69-77` is currently an instant-delete — move to an undo-toast pattern instead.
- **Reversibility ladder** (ux-expert): instant + undo-toast (revoke, clear condition) → confirm (end encounter, reset fog) → typed-confirm (delete campaign/account/collection).

### 2.3 Wizard equipment persistence (medium #16) — **M**
- **Files**: `packages/client/src/components/character-create/steps/equipment-step.tsx:84-109`; `pages/character-create-page.tsx:80-107`; `packages/shared/src/schemas/character-inputs.ts:28-87`; `packages/shared/src/schemas/srd.ts:114-128`; `packages/server/src/services/starting-equipment-service.ts:50-68`.
- **Now**: equipment step only reads `background.equipmentOptions`; `CreateCharacterInput.startingEquipment` exists; `createStartingInventory()` runs server-side if array is populated.
- **Change**: add `classEquipment` to `Class` schema, seed class equipment; extend wizard state; render class + background options side-by-side in equipment-step; merge into `startingEquipment` on submit. Also fix the "Starting Gold: 0 gp" display.

### 2.4 Attack / Cast Spell dialog mode toggle (medium #17, top-11 #6) — **Shipped**
- The `mode: "custom"` pin is gone with the dialog itself: `39e4292e` ("remove legacy combat dialogs", 2026-04-25) deleted `attack-roll-dialog.tsx`. The VTT drawer replaced it — `hooks/vtt-drawer/use-weapon-attack.ts:99` sends `mode: "character"` with a selected `weaponItemId`, and casting runs through `use-confirm-cast.ts` / `cast-spell-dialog.tsx`.
- Note the dating: the deletion landed two days *before* the 2026-04-27 revalidation, which still listed 2.4 as untouched. See the caveat under the revalidation summary.
- Still open from the original change list: the monster-attacker path (v1 regex-parse of `monster.actions[]`) is superseded by the structured v2 schema tracked in 3.4.

### 2.5 Map fit-on-mount + token-drag-separates-from-pan + place-token wiring (top-11 #5, medium #18) — **Partial**
- **Done**: token-drag-separates-from-pan shipped (commit `7f54bea`, "stop token drag from hijacking map viewport") — `onMouseDown` gates Stage drag correctly.
- **Remaining**: (a) `fitToBounds(mapWidth, mapHeight, containerSize)` helper + call on mount — grep shows zero occurrences; (b) port placement-slice subscription from `map-detail-view` into `combat-map-panel`; (c) optional middle-click / space+drag alternate pan.

### 2.6 Per-route `errorComponent` (medium #19) — **M**
- **Files**: 17 route files under `packages/client/src/routes/` — zero currently define `errorComponent`.
- **Change**: create a shared `ErrorFallback` component; set it on `root-route.ts` and each protected route. Investigate whether a single root-level fallback is enough before fanning out.

### 2.7 Tooltip primitive + wire condition badges / map toolbar / spell & feat rows (medium #13) — **M**
- **Files**: no tooltip component exists. Wiring targets: `components/campaign/token-condition-icons.tsx`, `components/campaign/map-toolbar.tsx:55-207` (30+ icon buttons still using `title=`), `components/sheet/spell-row.tsx`, feat rows.
- **Change**: shadcn Tooltip; migrate `title=` attributes. Condition tooltips should include SRD one-liner (the condition selector already has the data).

### 2.8 Sheet dual-mount consolidation (medium #20) — **M**
- **Files**: `packages/client/src/components/sheet/sheet-body.tsx:88-95`; `desktop-sheet-layout.tsx`; `mobile-sheet-tabs.tsx`.
- **Now**: ~21 children mount twice; duplicate `data-testid`s in the DOM.
- **Change**: single responsive tree with `useIsDesktop()` branching for layout-only differences; verify no duplicate testids post-refactor. Run the sheet perf profile before/after.

### 2.9 Campaign IA — Combat CTA + state-grouped encounter cards + Collections surface (areas #Campaign IA, #Homebrew) — **Partial (M remaining)**
- **Done**: the Collections surface shipped in `78159665` ("link homebrew collections to campaigns (phase 7c m1)", 2026-04-19) — `campaign-settings-panel.tsx:235` renders `<CampaignHomebrewSection campaignId={campaign.id} />`. This too predates the 2026-04-27 revalidation.
- **Files** (remaining): `components/campaign/encounters/encounters-panel.tsx`; `components/campaign/encounters/encounter-card.tsx` (note the path moved into `encounters/`).
- **Remaining**:
  - Group encounters by state (setup / active / paused / resolved) with collapsed resolved. `encounters-panel.tsx` still renders a flat list.
  - Add "Start combat" (setup) and "Resume" (paused) buttons on encounter cards — DM-only. `encounter-card.tsx` still only renders the state badge (`:15-18`).

### 2.10 Magic Items route redirect (area #Dashboard & IA) — **S** (paths refreshed 2026-04-23)
- **Now**: `/compendium/magic-items` renders directly; the `/magic-items` alias route hasn't been registered. Magic Items **is** in the mobile nav (from 1.2) but not the desktop header.
- **Change**: register the `/magic-items` alias route that `<Navigate>`s to `/compendium/magic-items`; add Magic Items to the desktop header nav list. Grep for route registrations in `packages/client/src/routes/` — file layout may have shifted.

### 2.11 Rate limiter → Redis (backend #7) — **M**
- **Files**: `packages/server/src/trpc/rate-limit.ts:40-85`; Redis client already instantiated at `config/redis.ts` and used by Socket.io.
- **Change**: accept optional `redis` param; use `INCR ${key} EX ${windowSec}`; fall back to in-memory when no Redis (dev mode).

### 2.12 Inventory DM auth symmetry (backend #3) — **M**
- **Files**: `packages/server/src/routers/inventory.ts:110-210`.
- **Now**: `update` uses `assertCharacterOwnerOrAccess`; `create` / `list` / `delete` use `assertCharacterOwner`. Decision on `docs/authorization.md` intent needs confirmation — see open questions.
- **Change** (if confirmed): unify on `assertCharacterOwnerOrAccess`; add optional `campaignId` to inputs.

### 2.13 Homebrew collection link visibility (backend #4) — **Shipped**
- `packages/server/src/utils/homebrew-helpers.ts:83+` defines `assertCollectionReadAccess`: author pass-through, public pass, private reject, `"campaign"` visibility re-checks linked campaigns the caller has access to. Used by `homebrew-campaign.ts` link/list paths.

### 2.14 Output-schema coverage expansion — **Shipped**
- `351a30ab` ("auto-enforce output schemas on every app-router mutation", 2026-04-20) removed `HOT_PATH_PROCEDURES` — the constant no longer exists anywhere in the tree. `app-router.output-coverage.test.ts:40` now declares `QUERY_OUTPUT_ALLOWLIST` as an **empty** set, so every query in the app router is enforced, and mutations are enforced automatically.
- Dating again predates the 2026-04-27 revalidation; see the caveat under the revalidation summary.

---

## Phase 3 — Larger investments (≥ 1 week)

### 3.1 Character spells + magic items UNION (larger #21) — **L**
- **Files**: `components/sheet/add-spell-dialog.tsx:114-193`; `packages/server/src/routers/character-spell.ts:37-100`; `packages/server/src/routers/magic-item.ts:1-154`.
- **Change**: add `character.listAvailableSpells(characterId, campaignId)` and `inventory.listAvailableMagicItems(campaignId?)` mirroring the Phase 2 monster UNION. Also define structured validation for homebrew spell / magic-item JSON (currently generic JSON).

### 3.2 Combat-focus mode on character sheet (larger #22) — **L**
- **Files**: `packages/client/src/hooks/character-sheet/use-character-sheet-socket.ts:43-52`; `packages/server/src/services/encounter-combat/turn-action.ts:29`.
- **Now**: sheet subscribes to `character:updated`; there is no `encounter:turn-changed` event.
- **Change**: emit `encounter:turn-changed` from `fanOutBroadcasts` with `{ encounterId, round, currentTurnIndex, currentParticipantId }`; the sheet subscribes when `campaignId && encounterId` and auto-enters focus mode on own-turn.

### 3.3 Dashboard redesign — "Next up" strip + persona panels (larger #23) — **L**
- **Files**: `pages/dashboard-page.tsx:109-162`; may need new endpoints for pending invites and aggregated encounter state.
- **Change**: "Active now" / "Next session" / "Pending invites" / "News from the table" strip above the fold. Sort campaigns by `nextSessionDate`. Empty-state CTA instead of hidden section.

### 3.4 Structured monster attack schema v2 (larger #24) — **Partial (M remaining)**
- **Done**: the schema shipped in `62ef5499` ("structure safe attack actions", 2026-07-20). `packages/shared/src/schemas/monster.ts:69-76` adds optional `attackBonus`, `damageDice` (validated dice notation), `damageBonus`, and `damageType` to `monsterActionSchema` (flat fields, not a nested `attack` object as originally specced). The client form-data layer follows at `components/homebrew/monster/monster-action-form.ts`.
- **Remaining**: the homebrew monster editor UI — `monster-form-fields.tsx` renders no `attackBonus` / `damageDice` / `damageBonus` / `damageType` inputs, so the structured fields are round-tripped but not editable. Also still open: reseeding SRD monsters with structured actions.

### 3.5 Token auto-spawn for monsters (larger #25) — **L**
- **Files**: `packages/server/src/routers/encounter-map.ts:70-113` (model on `autoLinkTokens`).
- **Change**: new `encounter.spawnTokensForUnmappedParticipants` — find participants without tokens, `mapToken.create` at offset grid positions. Pair with a combined "Populate tokens" UX that runs link + spawn.

### 3.6 Theme token coverage + ESLint palette ban + Konva theme extraction (larger #27) — **L**
- **Files**: ~15 components use raw Tailwind palette (`text-amber-500`, `bg-amber-500/20`, hex `#1a1a2e` in `map-canvas.tsx:17`); HP bar colors inconsistent between `hp-adjuster.tsx:28-31` (semantic tokens) and `participant-stats.tsx` (raw palette); Toaster, input aria-invalid, and parchment texture are all missing.
- **Change**: add tokens for accent/emphasis, map bg, rarity, difficulty, HP state; replace all raw-palette usages; add an ESLint `no-restricted-syntax` rule banning `/(bg|text)-(red|amber|blue|…)-\d{3}/` in `.tsx`; extract Konva colors from CSS variables; theme react-hot-toast via `toastOptions`; add 3%-opacity parchment noise to `.bg-card`; style `Input[aria-invalid=true]`.

### 3.7 Accessibility pass — axe-core + wizard radiogroups + DialogDescription (larger #28) — **Partial (L remaining)**
- **Partial state**: 2 radiogroups detected (`equipment-step`, `level-up`) — arrow-key handling still missing. `DialogDescription` coverage is now 64/263 Dialog usages (revised count from 120/180 in the original audit; the gap widened because new dialogs shipped without descriptions). ~~No axe-core in Playwright yet.~~ axe-core shipped in `d49d3ca9` ("add runtime axe a11y smoke", 2026-06-22) — `e2e/a11y.spec.ts:1` imports `AxeBuilder` from `@axe-core/playwright`.
- **Remaining**: fix top-k violations, add arrow-key navigation to both radiogroups, bulk-add `DialogDescription` with a codemod + manual review.

### 3.8 Technical-debt cleanup — **M** (split across ≥ 2 PRs)
- **CharacterCard button-in-link** (`character-card.tsx:41-86`): extract buttons outside the `<Link>`; use parent div wrapper to get row-click-to-navigate without invalid HTML.
- **`as`-cast consolidation** (5 sites in `invite-panel.tsx`, `campaigns-page.tsx`, `dashboard-page.tsx`, `homebrew-page.tsx`, `collection-detail-page.tsx`): introduce `asServerResult<T>()` at one boundary or — better — pull Zod-from-server types so the casts disappear.
- **Denormalize class/species names**: dashboard fetches `character.list` + `srd.listClasses` + `srd.listSpecies` (see `dashboard-page.tsx:112-121`); extend server `character.list` response with `className` / `speciesName` and drop the client-side maps.
- **Shared `error-messages` catalog** + `formatFieldErrors` code-lookup fallback.
- **Rename "Private" / "DM Only"** by audience ("Only me", "All DMs", "Visible to party"); hide "All DMs" until multi-DM. Note: `noteVisibility` enum uses camelCase `dmOnly` at `packages/shared/src/schemas/note.ts:9` — rename enum keys in the same change.

### 3.9 Combat polish — conditions duration + keyboard token movement — **M**
- **Files**: `components/campaign/condition-toggle-popover.tsx:68-89`; `services/combat-actions/turn-transaction.ts:57-68`; `hooks/canvas-input/use-canvas-input.ts:113-122`.
- **Changes**: default condition durations per 5e rules instead of permanent-by-blank; add arrow / WASD listener on map canvas (1 cell, Shift = 5 cells) when a token is selected in Select tool.

---

## Cross-cutting: invariants to adopt

These are not roadmap items per se, but landing them changes what "done" means for everything above.

1. **Every mutation completes in the UI** — toast or navigation on success; toast on error, branched by `error.data.code`. Ship a `useToast()` + `onTRPCError` helper in Phase 2 when the pattern count justifies it.
2. **Reversibility ladder** — instant+undo / confirm / typed-confirm — applied consistently to destructive actions.
3. **Output schemas on hot-path procedures** — enforced by the coverage test; widen the test as new hot paths emerge.
4. **No raw palette classes** — enforced by ESLint rule (Phase 3.6).
5. **Sources of truth respected** — SRD PDF for rules claims; `packages/shared/rules/*` for logic; `docs/authorization.md` for auth matrix. Keep audit findings from drifting into "conventional wisdom" — re-verify before acting on items written more than a month ago.

---

## Open questions (block certain items; resolve first)

- **Inventory DM access** (blocks 2.12): should `list` / `create` / `delete` be `assertCharacterOwnerOrAccess` like `update`? Default assumption is yes based on `docs/authorization.md`.
- **Homebrew collection creation gating** (blocks 2.13 UX framing): players can create collections today — intentional?
- **Combat log writability for players** + server-side event stream for player-visible actions (blocks parts of 3.2 and a broader combat-log redesign).
- **Cleric subclasses / Divine Order choice** — seed gap vs modeling gap? (Out of scope for UX but touches level-up UI.)

---

## Recommended execution order

Updated 2026-04-27 to reflect what's already shipped. Original sequencing was "ship all Phase 1 first" — that's largely happened.

1. **Next up (small)** — close the Phase 1 remainder: 1.4 (two-button Copy), 1.5 (empty-state copy rewrite — the Zod portion is done), 2.10 (magic-items alias). Each is hours; bank them before starting any medium item. (1.1 + 1.9 shipped 2026-04-27 revalidation; 1.10 + 1.11 shipped 2026-04-23.)
2. **Unblock-play mediums** — 2.3 (wizard equipment), 2.4 (attack/cast mode toggle), 2.5 (fit-to-bounds + combat-map placement wiring), 2.1 (complete the monsters UNION reference impl). 2.2 (AlertDialog infra) should land early in this group so later destructive-action sites can reuse it.
3. **Infra & IA** — 2.6 (errorComponent), 2.7 (Tooltip primitive), 2.8 (sheet dual-mount consolidation), 2.9 (Campaign IA), 2.11–2.14 (backend symmetry + output-schema coverage).
4. **Larger bets** — Phase 3, starting with the UNION-pattern siblings (3.1) and the theme/a11y passes (3.6 + 3.7).

Re-validate again after the next 5–6 items ship; drift has already happened once and will again.
