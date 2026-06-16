# UX/UI Audit — Executive Summary

Date: 2026-04-14 / 2026-04-15
Team: `dm-auditor`, `player-auditor`, `ux-expert`, `ui-dev`, `backend-dev` (coordinated by `team-lead`).
Method: Live Playwright walkthroughs (DM and player personas) + code-level review (UX, UI, backend) + cross-validation between auditors.

Detailed findings:
- `findings/dm-perspective.md` (Playwright, 215 lines, 45 screenshots — 24 DM issues across two passes)
- `findings/player-perspective.md` (Playwright, 425 lines, ~34 screenshots — 24 player issues + live-combat follow-up pass)
- `findings/ux-review.md` (design lens, cross-synthesized with DM findings)
- `findings/ui-dev-review.md` (code audit, cross-checks against DM + backend)
- `findings/backend-investigation.md` (11 proactive cases + 11 triaged auditor cases)

---

## Headline verdict

**Musi has strong bones.** The authorization model, concurrency discipline, test coverage, design tokens, skip-link, shadcn adoption, and mutation-helper type safety are all above the median for apps this size. The backend is well-behaved and the UI scaffolding (loading/error/empty states per page) is the kind of thing most teams never build.

**The gaps are the last 20% — the part that makes a product feel finished and alive.** The top problems are not architectural; they are: data-race renders, silent successes, generic copy, mobile nav absence, homebrew-disconnected-from-play, and a combat UI that doesn't know it's in combat. All are fixable without rewrites.

---

## What went well

### Platform & correctness
- **Authorization primitives are disciplined.** `assertCampaignMember` / `assertCampaignDm` / `assertCharacterAccess` used consistently; `NOT_FOUND` (not `FORBIDDEN`) for character ownership failures is enforced server-wide. DM/player NPC-note redaction was verified live with role switching.
- **Optimistic-locking rails hold.** Mutation helpers (`utils/*-mutations.ts`) have no bypasses; locked delegates (`CharacterStats`, `EncounterParticipant`, `Encounter`, `CharacterSpellSlot`, `CharacterClass`) successfully reject direct `.update`/`.updateMany`/`.upsert` at type-check time.
- **Socket handlers are writeless and public procedures are SRD-only** — the `trpc-for-writes, socket-for-broadcasts` split holds.
- **Test suite is green** — 1519 server tests, 105 files, 107s, all pass.

### UX / UI craft
- **Visual identity lands on first contact.** Login and dashboard read "dark-fantasy tabletop tool" immediately (gold focus ring, Cinzel headings, charcoal palette).
- **Design tokens exist in full** — `--color-primary`, `--color-success`, `--color-warning`, `--color-destructive`, parchment variants — which makes consistency problems fixable rather than systemic.
- **Loading / error / empty / search-empty states exist separately** on the list-query trio (dashboard, campaigns, homebrew, collection detail). The baseline is rare.
- **shadcn + Radix adoption is consistent.** Every interactive surface uses the shared primitives — no ad-hoc styled divs.
- **Authorization-aware UI, not permission walls.** DM-only affordances conditionally render; players never hit "you don't have permission."
- **Wizard stepper is non-linear and keyboard-accessible.** Users can jump to any completed step without data loss.
- **Skip-to-main link** is present and works across the app.

### Combat & domain craft
- **Condition selector is best-in-class** — shows each condition's SRD one-liner, saving mid-combat rule lookups.
- **Dice display is clean and a11y-correct** — dropped dice labelled, aria-group label on the roll.
- **Homebrew monster form is SRD-complete.** CR → XP and proficiency-bonus auto-compute.
- **Action economy buttons reset at round boundaries** — automatic reaction reset was verified live.
- **XP summary on encounter end** is a small delight for DMs tallying session rewards.
- **Map toolkit is ambitious** — Select / Measure / AoE templates (cone/cube/sphere/line/emanation with 5e size presets) / Fog / Drawing layer / Zoom / Fit-to-screen. Cone and Measure renderings are visually polished.
- **Chat whisper ACL is correct.** Players see whispers they authored or received; DMs see all (documented behavior).
- **Token↔participant linkage is FK-typed with a unique constraint** — the data model is stronger than the current UI exploits.

---

## What went wrong — Top 11 priority issues

Selected across all five findings and ranked by user-visible impact × affected persona breadth.

### 1. **Character sheet renders "Unknown / Unknown 4 / Unknown" after a hard reload** (critical, player-blocking)
Source: player-auditor #1–#2, ui-dev finding #4 and #5 (`as`-cast boundary).
Root cause: `use-srd-lookups.ts` has no retry policy and the sheet has no `isLoading` guard; a batched tRPC request (`srd.*`, `inventory.list`, `characterSpell.list`) returns 404 during reload race. When the hook returns `undefined`, the code falls through to the literal string `"Unknown"`. The same race produces "Advance X from level 4 to level 5 as a Unknown." in the Level-Up dialog.
Fix: skeleton on sheet + level-up while `useSrdLookups().isLoading`, and remove the `"Unknown"` fallback — use `—` if it must render. Investigate why the batched URL 404s on reload but works on nav clicks (suspect token-refresh race at the Fastify tRPC adapter).

### 2. **Wizard equipment never lands in inventory, and starting gold lies** (critical, player trust-breaking)
Source: player-auditor #3, #5, #9; ux-expert top-5 #5.
Repro: Create a Cleric with Acolyte Option A (holy symbol, prayer book, etc.). Review step says "Starting Gold: 0 gp" despite 8gp being owed. Sheet shows "No weapons equipped" and empty Gear tab regardless of Option A vs B. There is no Cleric class equipment block in the wizard at all.
Files: `character-create/steps/equipment-step.tsx` (only reads `background.equipmentOptions`), and whatever persistence step is expected to write `inventory` rows — neither path emits them.
Fix: add a class-starting-equipment block alongside background, and wire the equipment choices to write real `inventory` rows on wizard submit. Also fix wizard species validator to require `subspeciesId` for species that have subspecies (player #4).

### 3. **Mobile navigation disappears entirely below 640px** (high, both personas, no workaround)
Source: dm #7, player #7, ui-dev "Areas for improvement", ux-expert top-5 #2.
`app-header.tsx:19-26` uses `hidden sm:flex` on the nav — Campaigns / Homebrew are dropped with no hamburger, no drawer, no bottom bar. Only route back is logo → dashboard → body-level button. Two taps for a frequent action at a viewport (375px / iPhone 13) every player uses.
Fix: add a `DropdownMenu` or drawer for mobile, surfacing Campaigns / Homebrew / Magic Items / Settings / Logout. Also fixes #4.

### 4. **Homebrew is disconnected from play on THREE surfaces** (high, breaks a headline feature)
Source: dm #2; backend D2 (expanded).
The Encounter Add-Participant Monsters tab, the character sheet Add-Spell dialog, and the Compendium Magic Items list all query SRD-only. A DM who authors a CR 2 homebrew monster cannot add it to an encounter. A player who authors a homebrew spell cannot cast it. The `campaignHomebrewCollection` join table exists; the data model is correct; the client simply never queries `homebrewEntry`.
Fix: add `encounter.listAvailableMonsters`, `character.listAvailableSpells`, `inventory.listAvailableMagicItems` procedures that UNION SRD + campaign-linked homebrew with a `{source: "srd"|"homebrew", collectionId?, collectionName?}` discriminator. One pattern, three applications. Backend-dev already has the response shape and owns the monster variant.

### 5. **Token drag pans the camera instead of moving the token** (critical for VTT, breaks the core interaction)
Source: dm pass-2 #1; ui-dev DM-Maps #1.
`map-canvas.tsx:141` has `Stage draggable={!input.isToolCapturing && !input.isInteractiveTool}` AND `token-shape.tsx:127` has the token `draggable`. In Select mode both are draggable — Konva lets the token receive the event and the Stage also claims the pan. The single most central VTT interaction doesn't work.
Fix: in `onMouseDown`, gate Stage drag on `e.target === e.target.getStage()` (pointer hit empty canvas, not a token), OR set `Stage.draggable=false` when the pointer hits a draggable node. Pair with middle-click / space+drag alternate pan.

### 6. **Attack and Cast Spell dialogs require manual entry every turn** (high, combat-pacing blocker — hits BOTH personas)
Source: dm pass-2 #4; player combat pass #6; backend D10.
The server's `attemptAttackInputSchema` is a well-designed discriminated union (`"character"` vs `"custom"`), but the client pins `mode: "custom"` (`attack-roll-dialog.tsx:26`) and always renders a blank form (name / bonus / dice / type / target). The player confirmation adds weight: a player's character has prepared spells, equipped weapons, known spell slots, and a proficiency bonus — none of which are enumerable in the dialog. The player is asked to be their own rulebook mid-turn. For a DM running 3 goblins × 4 PCs this is ~30 clicks per round; for a player it's "what's my attack bonus with a scimitar?" every swing. The Target control also defaults to **self**.
Fix: switch the dialog to a mode toggle. For character attackers default to a weapon dropdown from `character.inventory` (filter `itemType === "weapon"`) and, for the Cast Spell dialog, a prepared-spells dropdown. For monster attackers parse `monster.actions[]` (v1: regex on SRD prose — fragile but ships; v2: add structured `attack: { bonus, damageDice, damageBonus, damageType }` to `monsterActionSchema` and reseed). Keep "Custom" as escape hatch. Set target default to last-selected / nearest enemy, never self.

### 7. **Combat-linked map does not auto-create tokens for monster / NPC participants** (high, map/combat integration broken)
Source: dm pass-2 #2–#3.
`autoLinkTokens` is character-only (backend D6/D7 confirmed intentional decoupling). The button's icon-only "Auto-link character tokens" doesn't say this, and adding monsters to an encounter leaves the linked map empty — the DM runs two lists in sync manually. The separate "Place token on map" button in combat mode sets its active state but click handlers never wire `pendingTokenCell` into the combat view (wired only in the standalone map view — confirmed `combat-map-panel.tsx` is missing the consumer).
Fix: rename the existing button "Link character tokens" and ship a new `encounter.spawnTokensForUnmappedParticipants` endpoint with a sibling button (or a combined "Populate tokens"). Wire the place-token handler in combat view to open the participant picker. Backend-dev owns the new endpoint; ui-dev owns the wiring.

### 8. **Destructive confirmations use plain `Dialog`, not `AlertDialog`; three near-duplicate implementations exist** (high, a11y + fragile)
Source: ui-dev finding #3; dm #13 (Revoke); ux-expert tension #5.
Delete Character / Delete Campaign / Delete Collection / Delete Entry / Delete Account / End Encounter / Revoke Invite all use shadcn `Dialog`, not `AlertDialog`. Screen readers announce these as generic dialogs; Escape during typed-confirm dismisses silently. Three near-identical "are you sure?" components exist. Additionally `map-toolbar.tsx` uses native `window.confirm()` for Reset-fog and Clear-drawings — breaks the design system entirely.
Fix: add `components/ui/alert-dialog.tsx` (shadcn CLI), consolidate to one `<ConfirmDialog />` + one `<TypedConfirmDialog />`, and adopt a **reversibility ladder** (ux-expert): instant+undo-toast for reversible (revoke invite, clear condition), confirm for semi-destructive (end encounter, reset fog), typed-confirm for data loss (delete campaign, delete account, delete collection).

### 9. **Combat mutations fail silently — 403s land with no toast, no log entry, no dialog state change** (critical, trust-breaking mid-combat)
Source: player combat pass #7.
When `encounterCombat.castCombatSpell` returns `403 Forbidden` (e.g. out-of-turn cast), the Cast Spell dialog stays open, the combat log remains empty, and no toast surfaces. The user assumes "nothing happened" but the server actively rejected the action. Same pattern hits Attack. During a live session this is the worst possible failure mode — the player spends a reaction they didn't actually spend, believes they've acted, and the table falls out of sync.
Fix: every combat mutation's `onError` must render a toast with the error code + message, and the dialog should close (or surface an inline banner) on the codes the combat mutations actually emit — `FORBIDDEN` (out-of-turn / wrong-actor) and `CONFLICT` (lost optimistic-lock race, the single race-rejection code per `docs/CONCURRENCY.md`), with an inline banner for `BAD_REQUEST` (invalid input). The server does **not** emit `PRECONDITION_FAILED`, so do not branch on it. Server-side, ensure the error body carries a stable `code` + human-readable `message` so the client can branch rather than string-match.

### 10. **Silent success is the opposite bug of loud failure** (medium cross-cutting, papercut × everywhere)
Source: dm #4, #10; player #12; ux-expert "Cross-cutting observations"; ui-dev DM cross-check #2 & #8.
- Campaign Settings Save has no toast (`campaign-settings-panel.tsx` is missing a `toast.success`).
- Create Campaign doesn't navigate into the new campaign (`create-campaign-dialog.tsx:82-90` closes the modal but stops there).
- Assign Character on campaign members silently persists, no confirmation.
- `encounter-map-link.tsx:40` reports `"Auto-linked 0 tokens"` which reads like failure.
Fix: adopt one usability invariant — **every mutation completes in the UI, either via toast or route change, and every error surfaces a user-visible signal.** Ship a shared `useToast()` + `navigateToCreated` + `onTRPCError` helper, apply to every `onSuccess` / `onError` pair in an audit pass. Branch the 0-count toast.

### 11. **Copy is generic SaaS and leaks raw Zod on validation failure** (medium cross-cutting, brand dilution)
Source: ux-expert top-5 #1 and #5; dm #6 (raw Zod), #20 (Private vs DM Only); player #22–#23 (Character Vault vocabulary mismatch).
- Empty states across 5 pages read like a task manager: "No characters yet. Create your first character to get started." No voice, no scent of the product.
- Errors are identical robotic "Failed to load. Please try again." × 5 pages.
- "Too small: expected string to have >=1 characters" leaks from Zod v4's default when the shared schemas don't set `.min(1, { message: "..." })`.
- "Private" vs "DM Only" semantic overlap is confusing for solo DMs (ux-expert call: rename by audience — "Only me", "All DMs", "Visible to party" — and hide "All DMs" until a second DM joins the campaign).
- "Character Vault" is a feature name; the dashboard heading should be user-centric ("Your Tables" / "Home").
- `favicon.ico` 404s on every cold load.
Fix: ship a small `error-messages` catalog in shared, update shared schemas with user-facing messages, rewrite 6 empty-state strings and 5 error-state strings with thematic voice (quick wins < 1 day each per ux-expert).

### Honorable mentions that nearly made top 11

- **Sheet dual-mounts desktop + mobile layouts** at every viewport (`sheet-body.tsx:88-95`). Every panel's state, effects, and socket subscriptions mount twice; DOM has duplicate testids / progressbars. Major perf + correctness risk. Fix: gate via `useIsDesktop()` or consolidate to one responsive layout.
- **Theme-token drift** — 23+ components hardcode Tailwind palette (`bg-red-500`, `text-amber-500`, `#1a1a2e` in `map-canvas.tsx`) instead of using `--color-success`/`--color-warning`/`--color-destructive`/`--color-primary`. HP bar colors actually differ between `participant-stats.tsx:20-22` and `hp-adjuster.tsx:28-32`. Fix: add rarity/difficulty/HP-state tokens + ESLint rule banning raw palette.
- **No per-route error boundary** — one render exception blows away header + nav. Fix: set `errorComponent` on each TanStack route.
- **`CharacterCard` nests `<button>` inside `<Link>`** — invalid HTML + fragile `stopPropagation` wiring.
- **Conditions have no obvious duration control** — server's `DurationInput` exists but defaults to `null`/permanent with an `∞` placeholder; Frightened appears as "permanent" without a visible rounds input.
- **Resolved-encounter player view leaks DM-only metadata** — player sees `Captain Mordain (Fallen Garrison)` (faction parenthetical is DM worldbuilding) and `frightened (permanent)` after the fight ends.
- **"It's your turn" has no player-facing signal.** Initiative list gets a `Current` chip but no banner / toast / chime. In a voice-call session a player easily misses their turn.
- **Combat log renders as "No combat actions logged yet." even after Round 1 Turn 1.** Server may not be emitting events, OR log may be wiped on resolve. Needs investigation.
- **Invite "Copy code" button copies the full URL; Join modal rejects URL paste.** Guaranteed onboarding friction — fixed by two sibling buttons (Copy code / Copy link) + server-side URL-strip regex.
- **Character creation wizard lets Elf advance without picking a subspecies** — validator only checks `speciesId !== ""`.
- **Level-up ASI step offers fighting-style feats to Cleric** — feat filter is by `type`, not class eligibility.

---

## Cross-cutting themes

Patterns that recurred across two or more auditors:

### Data is sound; the client under-exploits it
Across the backend investigation (D6–D11) and the DM pass-2 findings, every Maps-and-Combat item was a client gap, not a server bug: server supports grid-resize, fog is a single shroud, attack schema is a discriminated union, token↔participant link is FK-typed. The server is ahead of the UI. This is a good position — next milestone should be explicitly framed as **"surface what we already have"** rather than new backend features.

### "Feels alive" is missing systematically
Skeleton is gray `animate-pulse` rectangles (no `motion-safe`), no parchment texture despite the design spec calling for it, no dice sound, anticlimactic join flow, no character-creation celebration moment. The design direction explicitly calls this out; the implementation hasn't picked it up yet. These are uniformly cheap to fix (≤ 1 day each).

### Mutation feedback and the "confidence signal gap"
Silent successes are a form of bug — users can't tell if their action landed. Multiple surfaces hit this: Settings Save, Assign Character, Create Campaign-no-redirect, zero-count auto-link toast. The fix is invariant-level, not per-form: every mutation completes in the UI via toast or navigation.

### Copy-quality is a leak class
Both developer-facing leaks (raw Zod, "Too small: expected string…") and generic-voice leaks ("Failed to load. Please try again."). A shared error-message catalog + per-code lookups would prevent whole categories. This is infra, not string editing.

### Destructive-action ergonomics are inconsistent
Revoke Invite is instant (wrong — should be undo-toast). End Encounter has confirm (right). Delete Campaign has confirm but no typed-guard (upgrade). Reset Fog uses `window.confirm()` (swap). Ship one reversibility ladder; migrate all sites.

### Authorization model exceeds UI vocabulary
"Private" vs "DM Only" — the code distinguishes them correctly but the UX muddles audience. Rename by audience, not access level. Hide "All DMs" until multi-DM. The feature is right; the label is not.

### Accessibility has bright spots and systemic gaps
Bright: skip-link, `aria-invalid` + `aria-describedby` on forms, focus-visible rings, aria-labels on icon buttons, aria-live on dice rolls.
Gaps: `animate-pulse` ignores reduced-motion; Radix warns "missing DialogDescription" on 9 dialogs; wizard radiogroups lack arrow-key nav; no Tooltip primitive so condition hints can't land; `Input` doesn't style `aria-invalid`; global Toaster defaults are unthemed.

### Homebrew is authored but not playable
Three places where the client queries SRD-only — encounter builder, spell picker, magic-item list — and one place where the campaign ↔ collection binding is not surfaced at all (no "Collections" tab or picker on Campaign Settings). The single most-requested fix across the audit.

### Dashboard is DM-hostile
Character Vault as H1 for someone whose primary job is running a campaign is the wrong framing. Behavior-derived (not toggle-based) persona emphasis: if `campaignsOwned > 0` show campaigns as primary; suppress Characters entirely when the DM has zero PCs.

---

## Areas for improvement

Grouped by surface area, linking to the originating findings.

### Onboarding / auth
- Preserve invite code through login/register (`join-page.tsx:41-50` drops it).
- Login timing oracle (backend #2) — run bcrypt on missing-user to equalize timing.
- Rate limiter is in-memory, per-instance (backend #7) — move to Redis when scaling out.

### Dashboard & IA
- Persona-derived dashboard: campaigns first when user owns any; hide Characters entirely when empty for DM-only users.
- Add a "Next up" strip (active encounter / next session / pending invites). `nextSessionDate` empty → render `Schedule next session →` CTA, not a hidden section.
- Move Campaigns to primary action; rename heading to user-centric.
- Add Magic Items to app-header nav (currently orphaned; `/magic-items` → 404, real path is `/compendium/magic-items` — add redirect).

### Campaign IA
- "Start / Resume combat" CTA on campaign header when an encounter is `active`.
- Collapse encounter cards by state (active above, paused middle, resolved dimmed below).
- Replace lucide neutral tab icons with game-icons.net equivalents where thematic.
- Add a Collections surface (either a tab or a picker in Settings → Content Sources) — closes the homebrew-to-play gap.

### Combat
- Combat-focus mode on the character sheet (auto-enable via socket when the character is in an active encounter).
- Attack / Cast Spell dialogs preloaded from stat block (see #6).
- Conditions: visible duration input + ticking on turn advance + expiry toast.
- Map: fit-on-mount, pan-on-empty / move-on-token contract, auto-populate tokens, DM-side fog at 35% opacity (warm charcoal, not gray).
- Keyboard arrow-key token movement (1 cell; Shift = 5 cells).

### Character sheet
- Skeleton during `useSrdLookups().isLoading` (fixes the "Unknown" bug).
- Mobile log-tab always present (not gated on `campaignId`).
- Inline-edit affordances on Personality fields (pencil icon / hover underline).
- Consolidate desktop/mobile to a single responsive layout (removes dual-mount).

### Homebrew
- Encounter / spell / magic-item surfaces UNION SRD with campaign-linked homebrew (backend D2 expanded).
- Standardize `getDescription` across homebrew entry types (monster cards currently show no preview while spells/magic items do).
- Gate homebrew collection creation — player currently can create; verify this is intentional (backend open question).

### Copy / tone / error handling
- Thematic rewrite of 6 empty-state strings and 5 error-state strings.
- Shared `error-messages` catalog; wire `formatFieldErrors` to fall back to per-code lookups.
- Every mutation emits success feedback (toast or navigate).
- Rename "Private" / "DM Only" to audience labels; hide "All DMs" until multi-DM.

### Theme / UI primitives
- Add parchment-noise CSS texture at 3% opacity on `.bg-card`.
- Add `motion-safe:` prefix to `animate-pulse` (5 occurrences).
- Add Tooltip primitive (shadcn) + wire to map toolbar, condition badges, spell-cast dialog, feat rows.
- Add AlertDialog primitive + `<ConfirmDialog />` wrapper.
- ESLint rule banning raw palette classes in `.tsx`.
- Theme react-hot-toast via `toastOptions` to match charcoal/parchment.
- Extract Konva colors from CSS variables so map respects theme.

### Accessibility
- Systematic axe-core pass.
- Wizard radiogroups: arrow-key navigation.
- Add `<DialogDescription>` to the 9 flagged dialogs.
- Style `Input[aria-invalid=true]` with `border-destructive`.
- Reduced-motion guard on skeleton animation.

### Technical debt
- Fix `CharacterCard` button-in-link.
- Set TanStack Router `errorComponent` per route.
- Consolidate `as`-casts at the tRPC boundary into a single `asServerResult<T>()` helper (or better, drop the casts via Zod-from-server shapes).
- Dashboard fetches `character.list` + `srd.listClasses` + `srd.listSpecies` separately — denormalize class/species names on the server.

---

## Suggestions — recommended action plan

### Quick wins (individually ≤ 1 day)
1. Add `isLoading` skeleton to sheet and level-up dialog (kills #1 Unknown bug).
2. Add mobile hamburger nav (fixes #3).
3. `toast.success` on Campaign Settings save + navigate-to-created on Create Campaign; `toast.error` on every combat mutation's `onError` (fixes parts of #9 and all of #10).
4. Invite: two sibling buttons (Copy code / Copy link) + URL-strip regex on `invite.join`.
5. Rewrite 6 empty-state + 5 error-state strings with voice.
6. `animate-pulse` → `motion-safe:animate-pulse`.
7. Wizard species validator: require `subspeciesId` when species has subspecies.
8. Rename "Auto-link character tokens" → "Link character tokens" + non-zero-branched toast.
9. Shared schemas: `.min(1, { message: "..." })` on required fields.
10. Dashboard heading rename + Campaigns in primary position; suppress Characters when DM has zero PCs.
11. Backend: `campaign.assignCharacter` → `assertCampaignMember` (backend #5).
12. Backend: `notification.markRead` single-query fix (backend #6).

### Medium investments (1–3 days each)
13. Tooltip primitive + wire to condition badges, map toolbar, spell rows.
14. AlertDialog + shared `ConfirmDialog` / `TypedConfirmDialog`; migrate 8 destructive sites; remove `window.confirm`.
15. Encounter builder homebrew UNION (`encounter.listAvailableMonsters` + UI) — reference implementation for the spell + magic-item siblings.
16. Wizard equipment persistence — class equipment block + inventory writes.
17. Attack dialog mode toggle with weapon / monster-action preload (v1 regex).
18. Map: fit-on-mount + token-drag-separates-from-pan + place-token wiring in combat view.
19. Per-route `errorComponent` on TanStack Router routes.
20. Sheet consolidation to single responsive layout (removes dual-mount).
21. Homebrew spells + magic items UNION procedures + UI.

### Larger investments (a week+)
22. Combat focus mode on character sheet (socket-driven auto-enter).
23. Dashboard redesign: "Your Tables" / "Your Adventurers" / "Next up" / "News from the table".
24. Structured monster attack schema v2 (`monsterActionSchema` + reseed).
25. Token auto-spawn endpoint (`encounter.spawnTokensForUnmappedParticipants`) + combined "Populate tokens" UX.
26. DM-opacity fog render + paint-mode bump (ux-expert call; no server change).
27. Theme token coverage (rarity / difficulty / HP-state) + ESLint restriction + Konva theme extraction.
28. Full axe-core pass + wizard arrow-key nav + radiogroup semantics.

---

## Open questions for product / team

- **Homebrew visibility semantics.** `campaign` visibility currently behaves like `public` for re-linking (backend #4). Is this by design? If not, require caller authorship or already-linked-to-current-campaign.
- **Inventory read/write during play.** DM can `update` items but not `list`/`create`/`delete` on a player's character (backend #3). Per `docs/authorization.md` DM play-time access is intended — should all four be `assertCharacterOwnerOrAccess`? Or is create/delete intentionally player-only for RP agency?
- **Can players create homebrew collections?** `homebrew-page.tsx` appears to allow it; player-auditor flagged as a question. Confirm the role gate.
- **Player-side live combat was exercised in a follow-up pass** after the DM handed the browser back with an active encounter. Confirmed: monster HP is correctly hidden from players (only own character's HP renders); map tools are accessible to players. Remaining questions: should the combat log be writable to players (right now appears always empty)? Is there a server-side event stream for actions that players should see? Should `encounterCombat.castCombatSpell` return a typed error the UI can branch on instead of raw `403`?
- **Cleric subclasses.** Only Life Domain seeded. SRD 5.2.1 lists Knowledge / Life / Light / Trickery. Seed gap or intentional?
- **Cleric Divine Order level-1 choice.** Currently rendered as prose only; no picker. Is this a missed class-feature-choice type, or is Divine Order not modeled?

---

## Follow-up work recommended before next audit

1. **Run `bun run --filter @musi/server db:migrate`** — backend-dev flagged one pending dev migration that may have contaminated some auditor repros.
2. **Diverge seed data from reality.** Seeded DM's display name is `Dungeon Master`, matching the role badge → produces `Dungeon Master / Dungeon Master` in the Party Roster. Change to `Gary Gygax` / `Matthew Mercer` or similar.
3. **Seed at least one active campaign with an active encounter** so future audits can exercise live combat from both sides.
4. **Re-run this audit after the Top 11 fix pass** — expected improvement will be large and worth re-measuring.
