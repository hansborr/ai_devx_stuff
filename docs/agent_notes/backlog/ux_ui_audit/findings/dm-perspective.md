# DM audit — 2026-04-14

Auditor: **dm-auditor**, persona is a long-time 5e DM evaluating prep speed, combat pacing, homebrew authoring, and player management.

Environment driven via Playwright against `http://localhost:8000` as `dm@example.com`. Cross-role verification also logged in briefly as `player1@example.com` to confirm visibility rules.

Screenshots: `/workspace/docs/agent_notes/backlog/ux_ui_audit/screenshots/dm-*.png`, referenced inline.

---

## Corrections (2026-04-15, post cross-review)

After backend-dev, ui-dev, and ux-expert cross-checks, two findings are withdrawn and several are reframed:

- **Finding #3 (monster search case-sensitive):** withdrawn. Server is `mode: "insensitive"`. Reframed as ui-dev keystroke-render flicker.
- **Finding #14 (XP rounding):** withdrawn. CR 1 = 200 XP is SRD 5.2.1 correct; I was recalling 2014 encounter-budget numbers.
- **Finding #7 (DialogDescription):** Create Campaign and HP Adjust do have descriptions; ui-dev's authoritative list is 9 dialogs (npc-editor, note-editor, monster-detail-dialog, magic-item-detail-dialog + 5 sheet dialogs).
- **Finding #9 (Party Roster duplicate):** not a dedup bug; it's seed-data artifact. Fix is role-badge styling (ux-expert call).
- **Finding #11 (conditions never have duration):** `DurationInput` with `∞` placeholder does exist (`condition-toggle-popover.tsx:68-115`). Affordance problem, not missing feature — needs visible rounds input or explicit "Permanent" toggle.
- **Finding #5 (404 vs transient error):** server correctly throws `NOT_FOUND`; ui-dev owns the flattening at `campaign-detail-page.tsx:239`.

Everything else in this document stands as authored.

---

## What went well

- **Fantasy theming lands.** Gold focus ring (`rgb(226, 178, 54)`) on keyboard-reachable elements matches `docs/design-direction.md`. Dark backgrounds + parchment accents read as intended. `dm-02-dashboard-empty.png`.
- **Condition selector is best-in-class.** The conditions dialog on a combat participant shows each condition name + a one-line rules summary ("frightened: Disadvantage on checks and attacks while the source of fear is in line of sight..."). Saves table flipping. `dm-16-combat-running.png`.
- **Dice roll display is clean.** Chat dice (`2d20kh1+5` → "2 (dropped) + 15 + 5 = 20") correctly labels dropped dice and exposes an aria group label like `Dice roll: 2d20kh1+5, total 20`. `dm-26-dice-roll.png`.
- **Homebrew monster form is thorough.** Size / type / AC / HP / hit dice / speeds / ability scores / saves / skills / senses / resistances / immunities / CR / XP / PB / traits / actions / bonus actions / reactions / legendary / spellcasting. Covers the SRD monster block. CR → XP and PB auto-compute (CR 2 → XP 450 / PB +2). `dm-11-monster-form.png`.
- **XP summary on encounter end.** Post-combat XP summary with per-participant CR breakdown is a small delight for DMs tallying session rewards. `dm-17-combat-round2.png` shows round 2; end-combat view was captured after End Encounter.
- **Action economy buttons per participant** (Action / Bonus Action / Reaction) with automatic reset at round boundary. Verified reaction went `available → used → available` when round advanced. Big combat-pacing win.
- **NPC DM Notes visibility enforcement works.** Created Sister Elara (visible) with `DM Notes: SECRET: She is a cultist…`. As `player1@example.com` the name / location / faction / description rendered, but the DM Notes string was redacted. Ditto for "DM Only" campaign notes — player sees "No notes yet" (`dm-19-npc-created.png` vs `dm-20-player-view-npcs.png`).
- **Invite revoke is immediate and the revoked code returns "Invalid invite code" on reuse.** Good defensive UX.
- **Session notifications.** When Aragorn joined, the DM's notification bell updated to "(1 unread)" with a popover log entry — low-friction awareness.
- **Form Enter-submit works.** New Encounter modal accepts Enter to submit. Expected, but I've seen worse.
- **Campaign detail empty state is informative.** Overview shows live Players / Characters / Total Members counters and a Party Roster with placeholder characters. `dm-05-campaign-detail.png`.

## What went wrong

### High severity

1. **"Copy code" button actually copies the full invite URL, not the code.** `dm-08-invite-created.png` shows `<code>q3FQcoNZ</code>` with an adjacent button labelled `Copy code q3FQcoNZ`. The clipboard content after clicking is `http://localhost:8000/join/q3FQcoNZ`. Then the **Join Campaign modal rejects a pasted URL with "Invalid invite code"** — users who share the copied value via "send me the code" will naturally paste the URL, which fails. `dm-25-raw-zod-error.png` (adjacent dialog shown for form-error context).
   - Repro: Campaign → Members tab → Create Invite → click "Copy code" → `navigator.clipboard.readText()` returns URL. Then Campaigns list → Join Campaign → paste the URL → "Invalid invite code".
   - Fix one of: (a) rename the button "Copy link"; (b) copy the raw code; (c) have the Join modal accept either a bare code or a URL and strip the `/join/` prefix server-side or client-side.
   - **Impact:** every DM-player onboarding is harmed.

2. **Homebrew collections cannot be attached to a campaign — and therefore never surface in the encounter builder.** No "Collections" tab on the campaign, no picker in campaign Settings (`dm-06-campaign-settings.png`), no references in CLAUDE.md that the feature is actually wired. I created `Thalor Bestiary` with a CR 2 Keep Wraith (`dm-12-collection-with-entries.png`), then went to Encounters → Add Participant → Monsters tab and searched "Keep Wraith" — the SRD list kept showing Awakened Shrub etc. with no results for my homebrew entry.
   - Repro: create any homebrew monster in any collection, then open Add Participant → Monsters in any campaign. Search or scroll — homebrew entry is never present.
   - **Impact:** Homebrew authoring is a one-way write to `/homebrew`. Cannot be used in actual play.

3. ~~**Monster search is case-sensitive.**~~ **Withdrawn (2026-04-15, per backend-dev D1 triage).** Server uses `mode: "insensitive"` on `monster.list` (monster.ts:119); direct tRPC curl confirms `goblin` and `Goblin` return identical hits. What I observed in `dm-14-monster-search-broken.png` was a **keystroke-render flicker in the encounter-builder Monsters tab** — the list briefly blanks mid-search. Reframing as a ui-dev debounce/rendering bug, not a server bug. Screenshot preserved as evidence of the user-visible behaviour; claim against the server retracted.

4. **Campaign Settings "Save Changes" has no success feedback.** Changed description from `…bloodstained banner.` to `…bloodstained banner. EDITED.`, clicked Save Changes — no toast, no inline confirmation, no button state change. Only way to verify is to navigate away and come back. The change *did* persist (confirmed via reload), but the confidence signal is missing.
   - Compare to the encounter creation flow, which does post an aria-live `Encounter created` status message. Settings should do the same.

5. **Campaign-not-found error message misleads as a transient failure.** Visiting `/campaigns/nonexistentID123` returns "Failed to load campaign. Please try again." with a Retry button. A 404 / permission error is not "try again" — it will keep failing. Retry'ing a forbidden campaign also leaks timing signal.
   - Repro: `goto` any invalid campaign ID while authenticated.
   - **Impact:** DMs and players fork-debug server health when the real answer is "wrong URL / no access."

6. **Raw Zod error surfaces to users.** Submitting the Create Campaign modal with an empty Name shows `"Too small: expected string to have >=1 characters"` in the alert. `dm-25-raw-zod-error.png`.
   - **Impact:** looks like a dev-build leak. User-facing copy should be e.g. "Campaign name is required."

7. **Mobile header drops primary navigation at 375px.** Dashboard at 375px renders only `Musi | Settings | Notifications | Logout` in the header — the `Campaigns` and `Homebrew` nav links are hidden with no hamburger/menu replacement. `dm-22-mobile-dashboard.png`. Settings as a top-level destination while Campaigns (the DM's bread and butter) is hidden is backwards.
   - Repro: resize to 375x700, visit `/dashboard`.
   - **Impact:** the whole mobile navigation story is broken.

### Medium severity

8. **DM dashboard centers on "Character Vault".** `/dashboard` for a DM who has 0 player characters shows a heading "Character Vault" with a Create Character CTA and a small text link "Campaigns". DMs rarely roll personal PCs; the dashboard should prioritize recent campaigns / upcoming sessions / player-owned characters by campaign, not a vault aimed at player flow. `dm-02-dashboard-empty.png`.

9. **Party Roster shows `Dungeon Master / Dungeon Master`.** On the campaign Overview, the DM row lists Display Name then Role, but both happen to be the string "Dungeon Master" for the seeded user, producing an odd duplicate. `dm-05-campaign-detail.png`. Low priority once display names diverge, but in seed + real-world cases this should be role-styled separately (badge or muted chip), not a second name line.

10. **Campaign create does not redirect into the new campaign.** After clicking Create the modal closes and the campaigns list refreshes with the new entry — but the DM has to click again to enter it. For a create-and-immediately-configure flow, auto-routing into `/campaigns/:id` after create is the standard.

11. **Conditions never have duration.** I applied `frightened` to the Owlbear → it shows `frightened (permanent)` with no turn counter and no way to set a duration. 5e conditions routinely have "save at end of turn" or "until end of next turn" timers (e.g. Cause Fear is 1 minute, concentration). DM has to manually remember and tick down. Would be worth at minimum a "rounds remaining" counter.

12. **Custom NPC (encounter-scope) has no description/notes field.** The "Custom NPC" tab of Add Participant only takes Name / Max HP / AC / Init Mod / CR. No tactics field, no description, no notes. By contrast the campaign-scope NPC form has DM Notes. Inconsistency leaves encounter-only NPCs featureless.

13. **Revoke Invite has no confirmation.** Clicking the trash icon on an invite nukes it instantly. An undo toast or a confirm dialog would match the "Delete Campaign" and "End Encounter" confirm patterns.

14. ~~**Homebrew monster XP breakdown in Encounter XP summary rounds down at sub-CR boundaries.**~~ **Withdrawn (2026-04-15, per backend-dev D5 triage).** I was confusing 2014-era "CR 1 = 200 XP encounter budget" math with the per-monster XP table. Per SRD 5.2.1 (`docs/SRD_CC_v5.2.1.pdf`) the Bugbear Warrior seed value `challengeRating:1, xp:200` is correct, and CR 1 → 200 XP per monster is the authoritative table entry. No bug.

### Low severity

15. **Monster card in collection preview is inconsistent with spell/magic-item cards.** Spell and magic item entries show a description paragraph preview; monster entries show only name + type + version badge, nothing about CR / HP / AC. `dm-12-collection-with-entries.png`. Small but visible asymmetry when scanning a collection.

16. **Hit Dice field is freeform.** `8d8+16` is accepted as-is without validation; a typo like `8d+16` is also accepted. Could be validated with a simple regex `/^\d+d\d+([+-]\d+)?$/`.

17. **Add Participant modal does not close after adding the last monster.** DM must click "Done" after adding each batch — expected, but the Done button looks like a primary action even when the list is empty. Consider dismissing after the first Add when no other action is taken for N seconds, or label the button "Close".

18. **Radix a11y warnings in console.** Repeated warnings like `Warning: Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}` observed in Create Campaign modal, HP Adjust dialog, and New NPC dialog. Likely a missing `<DialogDescription>` or `aria-describedby` on those Dialog primitives. Accessibility regression for screen reader users.

19. **`favicon.ico` 404 on every cold load.** Dev polish, but visible in the Network panel of every fresh session.

20. **"Private" vs "DM Only" note visibility overlap.** The Note visibility select has three options: `Shared`, `Private`, `DM Only`. Semantic difference between "Private" and "DM Only" isn't obvious to a DM (is Private = just me, and DM Only = all DMs in a co-DM'd campaign? Or is DM Only the same as Private when there's one DM?). Needs microcopy or tooltips.

## Areas for improvement

- **Dashboard prioritization.** Move campaigns above the character vault for DM users; consider a "DM view / Player view" context toggle, or derive the landing emphasis from "are you the DM of any active campaigns?" heuristic.
- **Collection ↔ Campaign binding surface.** A Collections tab on the campaign page (sibling to NPCs, Encounters, Maps) with "Attach existing collection" + "Create new collection" is the natural place. Until it exists, the homebrew flow is disconnected.
- **Monster search UX.** Fix the keystroke flicker (ui-dev debounce/render), plus chip-style filter pills for CR range (already there as combobox but chips are faster for repeated passes), plus a hint that the list also searches homebrew once collections are attached.
- **Combat pacing.** Add optional per-condition duration ("ends at start of owner's next turn", "1 minute", "concentration"), automatic ticking as turns advance, and a toast/log entry when a condition expires.
- **Encounter-time NPC parity.** Share the DM Notes field between campaign NPCs and encounter custom NPCs — promoting an encounter NPC into a campaign NPC record should be a one-click action.
- **Copy affordances.** Pair "Copy code" (raw token) and "Copy link" (full URL) as sibling buttons, instead of one button that equivocates. Alternatively a single Share dropdown.
- **Error copy.** Every "Failed to load" / "Too small: expected string…" should route through a user-facing message catalog. Good target for a small i18n helper.

## Suggestions

- **Campaign-level collection picker.** Add a `campaignCollections` relation (many-to-many) and surface on campaign Settings → "Content sources" section. Encounter search then queries `{ srd: true } OR { collectionId IN campaign.collectionIds }`.
- **Toast system.** Introduce a shared `useToast()` for Save Changes / Invite revoked / Note saved / Monster added. Use the existing aria-live pattern already present on encounter creation.
- **Mobile nav.** Add a hamburger drawer for `<md` that surfaces Campaigns / Homebrew / Settings / Logout. Collapse Settings + Notifications into the drawer too so that primary destinations lead.
- **Conditions with duration.** Extend the condition record with `expiresAt: { roundRelativeTo: participantId, atStartOrEnd: 'start'|'end' }` and tick in the `encounter-state-mutations` helper on Next Turn. Match 5e "save at end of each of its turns" mechanics.
- **DM dashboard "Quick Start" strip.** Roll up "Resume last encounter" / "Next session: <date>" / "Invites waiting" cards. DMs want one click to the most recent running encounter.
- **Copy-link button when the invite row is focused.** Right now the row has Copy + Revoke; add a preview of the URL beneath the code with a small monospace `http://localhost:8000/join/q3FQcoNZ` so the DM can read what they're about to paste.

## Open questions for the backend dev

- Is the `campaignHomebrewCollection` (or similar) relation already in the Prisma schema and just not wired in the UI, or is it not modeled yet? CLAUDE.md line "DMs pick collections per campaign" hints the intent exists.
- Is there a "search homebrew monsters" tRPC query, or does `monster.list` only return SRD rows? What filter does Add Participant's Monsters tab use? (Suspected: SRD-only, explaining why Keep Wraith never appears.)
- For the invite code search mismatch (URL vs code) — is there an appetite to make `invite.join` accept either form, or should only the client normalize?
- Captain Mordain / Owlbear / Bugbear Warrior encounter ran: after End Encounter, XP Summary showed `CR 3 · 700 XP`, `CR 2 · 450 XP`, `CR 1 · 200 XP`. Hobgoblin Warrior is SRD CR 1/2 (100 XP), so either the bucketing grouped the NPC at CR 2 and the Bugbear at CR 1 (does NPC CR default to the highest value?), or there's an off-by-one. Dump of `encounter.participants` at the time of end would confirm.
- Confirm player-facing note filtering behavior — the current implementation returns no notes when the player has no shared/private-to-them entries; is that intentionally silent vs. showing a "Your DM has not shared any notes yet." empty state?

---

## Session log (chronological cursor)

1. Logged in as dm — landed on `/dashboard` "Character Vault" (DM-unfriendly framing).
2. `/campaigns` had two pre-existing campaigns (leftover seeds); created `Shattered Keep of Thalor` via modal.
3. Entered campaign — 8-tab layout: Overview / Members / Chat / Notes / NPCs / Encounters / Maps / Settings. Edited description on Settings; saved silently.
4. Created invite on Members; copied "code" → actually URL.
5. Homebrew → Collections → created `Thalor Bestiary` (Private). Added CR 2 `Keep Wraith` monster, `Shroud of Thalor` level 2 Abjuration spell, and `Banner of the Fallen Keep` rare attunement magic item.
6. Back to campaign → Encounters → created `Keep Entrance Ambush`. Added Bugbear Warrior + Owlbear + custom NPC Captain Mordain. Homebrew Keep Wraith missing from search.
7. Rolled initiative, started combat, dealt 15 damage to Owlbear (44/59), applied Frightened (permanent), marked Owlbear reaction used, advanced two turns into Round 2 — reactions correctly reset. Ended Encounter; XP summary displayed with CR 3 / CR 2 / CR 1 bucketing.
8. Campaign Notes → created "DM Only" note about Captain Mordain.
9. Campaign NPCs → created "Sister Elara" with DM Notes.
10. Second tab: logged in as player1, accepted invite via `/join/q3FQcoNZ`, verified NPCs show without DM Notes and Notes tab is empty.
11. Back to DM. Visited global `/settings` — profile + password + danger zone. Notifications bell popover shows the join event.
12. Narrow viewport (375x700): dashboard loses nav links; campaign page tabs remain (likely scrollable).
13. Keyboard: tab cycles are reasonable, focus ring is gold and visible. Matches design direction.
14. Error checks: invalid invite → friendly alert, nonexistent campaign → misleading "try again", empty form → raw Zod string.
15. Revoked invite; attempted URL-in-invite-code paste in Join modal → "Invalid invite code."
16. Chat + dice roll (2d20kh1+5) rendered with accessibility label and drop-labelled die.

---

## Bug-triage shortlist (recommended SendMessage targets)

- **backend-dev**: campaign↔collection relation, monster search case-sensitivity (query normalization), invite.join should optionally accept URL input, campaign fetch 404 vs permission disambiguation in tRPC errors, encounter XP breakdown CR bucketing.
- **ui-dev**: Copy code → Copy link label mismatch, mobile header nav missing on <768px, Zod error surfacing as user-facing text, no success toast on campaign Settings save, conditions dialog lacks a duration control, monster entry cards missing stat preview, Radix `DialogContent` missing description.
- **ux-expert**: Character Vault framing on DM dashboard, Private vs DM Only copy, confirm-destroy vs instant-revoke consistency, encounter-time NPC vs campaign NPC parity, dashboard information architecture for DMs.

---

## Deep-dive: Maps and Combat/Map interplay (second pass)

### Corrections after backend-dev cross-check (2026-04-15)

Per backend-dev D6–D11, several items below are reframed but not withdrawn:

- **#2 (no auto-tokens for monsters):** Server `autoLinkTokens` is **intentionally character-only** (matches `characterId` to existing character-tokens). Button copy should be "Link character tokens"; a separate endpoint is needed to spawn tokens for monsters/NPCs. Product decision, not server bug — UI copy + new-feature ask.
- **#3 (Place Token does nothing):** Same root cause — the button only runs character linking, so with monster participants it correctly no-ops. Repackaged as UI copy finding.
- **#4 (attack/spell dialogs require manual entry):** Server schema **fully supports** participant-aware defaults via `attemptAttackInputSchema` discriminated union. The empty form is a client choice, not a schema gap. Fix belongs in client: preload weapon dropdown for character attackers, `monster.actions[]` dropdown for monster attackers.
- **#6 (fog shroud missing on DM view):** Server fog is a **single shroud model shared by both audiences** — DM-sees-through-fog is deliberately not server-side. Reframe as "client needs a DM-side opacity/preview control", a scoped new feature.
- **#9 (Edit Map cannot change grid):** Server `updateMapInputSchema` + `assertResizeIsSafe` **already support** width/height/gridSize/gridType mutation. The client just doesn't expose the fields — pure UI gap.
- **Token-participant coupling** is by `characterId` + unique `encounterParticipantId` FK (not name-matching). The data model is stronger than the current UI exploits.

### What works

- **Map toolbar is ambitious and well-designed.** Select, Measure, Cone/Cube/Sphere/Line/Emanation templates, Place Token, Fog Reveal/Hide/Reset, Drawing layer, Zoom in/out, Fit to screen, Hide grid. Full 5e VTT toolkit. `dm-28-map-editor.png`.
- **Cone template rendering is beautiful.** 30ft cone from origin draws as a triangular fan with filled highlight cells and a "30 ft cone" label — correct 5.5e AoE math. Size presets (10/15/20/30/60 ft) appear when cone is selected. `dm-35-map-cone.png`.
- **Measure tool** renders a gold dashed line with "50 ft" label mid-segment — clean. `dm-34-map-measure.png`.
- **Drawing layer** has freehand / line / rect / circle / eraser / clear-all + 8-color palette + 3 stroke widths. `dm-40-map-draw-line.png`.
- **Templates are preview-only.** Switching tools clears the template from the canvas — correct default for ephemeral AoE markers. `dm-36-map-after-select.png`.
- **Grid types:** `square | hex | none` available at map create time.
- **Map linking to encounter** via "Link Map" works end-to-end: linked map persists and renders during combat (5 Konva canvases confirmed). Setup tab shows a "Keep Courtyard" pill with Unlink + Auto-link buttons.

### What's broken or incomplete

#### Critical

1. **Token drag in Select mode pans the camera instead of moving only the token.** Starting a drag on a token causes the entire map viewport to shift alongside the token, often moving the token off-screen. The VTT norm is: drag on a token moves the token; pan requires middle-click / space+drag / pan tool. Repro: open a map with a token → Select tool → press-drag on the token. `dm-37-map-token-drag.png` + `dm-39-map-token-drag2.png` both show the resulting panned state.

2. **Combat-linked map does not auto-create tokens for monster / NPC participants.** After Start Combat on an encounter with a linked map, only the manually pre-created "Bugbear Warrior" token I placed on the standalone map view appeared. The two SRD Goblin Warriors I added to the encounter were never spawned as tokens on the linked map. The "Auto-link character tokens" button ran silently with no toast and no visible effect — consistent with its name implying it only handles character (player-owned) participants. Repro: create encounter, link map, add 2 SRD monsters, Start Combat, scroll to map → no monster tokens. `dm-42-combat-scrolled-map.png`. This forces DMs to manually add a token per combatant and keep two lists in sync — directly undermining map/combat integration.

3. **"Place token on map" button during combat does nothing discoverable.** Clicking it in the combat-map toolbar sets the button to `[active]` but subsequent clicks on the canvas neither create a token nor open a "choose participant" popover. The button state resets silently after the canvas click. `dm-43-place-token-failed.png`.

4. **Attack / Cast Spell dialogs require full manual entry every time.** From a combat participant's "Attack" action, the dialog is an empty form: Attack Name / Attack Bonus (default 0) / Damage Dice (default 1d6) / Damage Bonus / Damage Type. No dropdown of the monster's SRD actions (Goblin Warrior should preload Scimitar +4 / Shortbow +4), no saved attacks, no recent-attack history. **Target button also defaults to the attacker itself.** `dm-44-attack-modal.png`. For a DM running 3 goblins against 4 PCs, this is ~30 manual clicks per round. Cast Spell has the same shape.

5. **Default map zoom doesn't fit.** On entering the map editor, the Konva canvas is 800×500 but the grid renders at natural pixel size, leaving half the panel empty. The user must click "Fit to screen" every time they open a map. `dm-29-map-token-placed.png` (before Fit) vs `dm-33-map-fit-to-screen.png` (after Fit).

#### Medium

6. **Fog of war produces no visible shroud on DM view after "Reset fog (hide all)".** Native `window.confirm()` asks "Reset fog? This will hide the entire map for players.", but after accepting the DM's canvas looks identical — no shroud overlay, no tint to indicate "all hidden from players." DM has no visual cue to author reveals against. Either render a semi-transparent hatched overlay on DM-side hidden cells, or add a "Preview player view" toggle. `dm-32-map-fog-all-hidden.png`.

7. **Native `confirm()` dialog breaks the design system.** Fog Reset uses `window.confirm()` instead of the styled AlertDialog pattern used for End Encounter and Delete Campaign. Native chrome, no dark theme. Jarring.

8. **Background image URL fails silently.** A URL that doesn't resolve (`net::ERR_CONNECTION_CLOSED`) results in no error toast, no broken-image icon, nothing. Map just looks empty. Needs an `onerror` on the Konva Image node that surfaces "Failed to load background image." `dm-45-map-bg-url.png`.

9. **Edit Map cannot change grid dimensions or type.** Edit Map modal exposes only Name + Background Image. A DM who starts at 24×18 square and wants 30×30 or hex has to delete and recreate, losing tokens/fog/drawings. Add Width / Height / Cell Size / Grid Type as editable.

10. **Token label truncates to `Bug…` on a 1×1 token.** Small token cells can't hold "Bugbear Warrior". Auto-derive short label from initials, or add a short-label field + hover tooltip for full name. `dm-29-map-token-placed.png`.

11. **Map toolbar is icon-only with no visible labels / tooltips.** Cone / cube / sphere / line / emanation are near-identical AoE shapes. aria-labels exist (good for screen readers), but sighted users should get hover tooltips via Radix `<Tooltip>`.

12. **Token coord entry has no bounds validation.** Nothing prevents entering col=99 on a 24-wide grid — token ends up off-canvas. Add `min=0`, `max=width-tokenWidth` clamping.

### Suggestions specific to Maps/Combat

- **Fit-on-mount.** Call fitToScreen the first time the Konva Stage mounts for a map so the grid fills the panel by default.
- **Pan contract.** Mouse events on empty canvas pan the camera; mouse events on a token move the token. Middle-click and space+drag as alternate pan modifiers. Make tokens individually `draggable` (Konva token nodes), not the Stage.
- **Token-per-participant.** On encounter start (or on Link Map), auto-create tokens for every participant colored by type (player=blue, NPC=purple, monster=red), placed at spawn points the DM has pre-tagged or in a staging row. Clicking a participant in the initiative list centers the camera on their token; clicking a token highlights the participant row.
- **Attack / Spell defaults from stat block.** On a monster's Attack button, preload a dropdown of `monster.actions[]` (parsed attack bonus, dice, type, range). On a player's Attack button, preload their attacks from character sheet. Target defaults to last-selected token or nearest enemy.
- **Fog DM indicator.** Render hidden cells with a faint hatched overlay on the DM canvas so the DM knows what players can't see. Add a "Preview player view" toggle in the map header.
- **Local background upload** avoids CORS / link-rot. An in-repo asset library of 10–20 fantasy tile backgrounds would make empty-state maps viable.
- **Keyboard token movement.** Selected token + arrow keys move by 1 cell, shift+arrow by 5. Enter commits. Huge a11y and pro-DM win.

### Screenshots added in this pass

- `dm-27-maps-empty.png` — empty Maps tab
- `dm-28-map-editor.png` — map editor toolbar + canvas
- `dm-29-map-token-placed.png` — token placed, default zoom doesn't fit panel
- `dm-30-map-fog-revealed.png` — fog reveal drag had no visible effect
- `dm-31-map-fog-reset.png` — native confirm dialog for Reset fog
- `dm-32-map-fog-all-hidden.png` — after "Reset fog (hide all)", no DM shroud visible
- `dm-33-map-fit-to-screen.png` — Fit-to-screen fills panel correctly
- `dm-34-map-measure.png` — Measure tool: 50ft gold dashed line
- `dm-35-map-cone.png` — 30ft cone template
- `dm-36-map-after-select.png` — template cleared on tool switch
- `dm-37-map-token-drag.png` + `dm-39-map-token-drag2.png` — token drag pans camera
- `dm-38-map-post-drag.png` — token at col 12/row 3 after drag (it DID move)
- `dm-40-map-draw-line.png` — drawing layer with palette + stroke widths
- `dm-41-combat-with-map.png` — combat UI with linked map (low-res thumbnail)
- `dm-42-combat-scrolled-map.png` — combat map, Goblins have no tokens
- `dm-43-place-token-failed.png` — Place Token click did nothing
- `dm-44-attack-modal.png` — Attack dialog requires manual entry, self-target default
- `dm-45-map-bg-url.png` — broken background URL, no error surfaced
