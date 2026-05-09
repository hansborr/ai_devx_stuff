# UX expert audit — 2026-04-14

Auditor: ux-expert (senior product designer; tools for creative/narrative work).
Sources: `design-direction.md`, code review of `packages/client/src/` pages and shared primitives,
player-perspective auditor's pre-browser notes, DM screenshots
(`dm-01-login.png` → `dm-05-campaign-detail.png`). DM-perspective narrative findings were still
template placeholders at draft time; updated synthesis will follow when they land.

---

## Top 5 UX concerns (prioritized)

### 1. The product's soul is not in the words. Copy is generic SaaS.
**Impact:** The design direction promises "a well-worn spellbook opened by candlelight." Cinzel
headings and gold accents land that promise *visually* on the login page and dashboard
(see `dm-01-login.png`, `dm-02-dashboard-empty.png`). But every interaction beyond that reads
like stock SaaS. This dilutes the emotional hook that would distinguish Musi from Roll20,
Foundry, or a Notion doc.

Concrete examples across the codebase:

- Empty states are flat directives, not invitations:
  - `dashboard-page.tsx:27` — "No characters yet. Create your first character to get started."
  - `campaigns-page.tsx:47` — "No campaigns yet. Create your first campaign or ask a DM for an invite."
  - `homebrew-page.tsx:44` — "Create your first homebrew collection to start building custom content."
  - `npc-panel.tsx:57` — "No NPCs yet. Create one to get started."
  These are functional, but they read like a task manager. A DM opening a fresh campaign is
  about to spend hours world-building — the empty state is the first page of the spellbook
  and should feel like it (e.g. "Your vault stands empty. Every hero begins with a blank page —
  make the first entry.").
- Errors are polite robots: "Failed to load campaigns. Please try again." × 5 pages
  (`dashboard-page.tsx:37`, `campaigns-page.tsx:28`, `campaign-detail-page.tsx:239`,
  `homebrew-page.tsx:29`, `encounter-detail-view.tsx:53`). Identical phrasing, no voice, no
  clue about *what* failed or *what's safe to do next*.
- Login's one flavor line ("Welcome back, adventurer", `login-page.tsx:90`) and register's
  "Begin your adventure" (`register-page.tsx:134`) set a tone the rest of the product never
  picks up again.
- The "Danger Zone" on `settings-page.tsx:253` is literally called "Danger Zone" —
  straight from GitHub's playbook. A dark-fantasy VTT has better language for "this ends here."

**Why it matters:** Tone is cheap to change and has outsized first-impression payoff. A DM
who sees evocative copy at the empty state trusts that someone on the other side cares about
their table, not just their retention metrics.

### 2. The dashboard is lifeless and buries the work.
**Impact:** See `dm-02-dashboard-empty.png`. A freshly-logged-in DM lands on "Character Vault"
with one naked outline button ("Campaigns"), a primary button for a workflow they likely won't
start first (Create Character), and no indication that running a campaign — the primary DM
activity — is even available. The page header says "Character Vault" in large Cinzel, but a DM
may not have a character at all.

Structural issues:

- The top-level page is named after a *feature* (Character Vault) not the user's mental model
  (home, hub, table, campaign). A DM logs in to DM; a player logs in to play. Neither says
  "I want to visit my vault."
- `dashboard-page.tsx:130-134` — the only way to reach Campaigns is a secondary outline button
  shoved under the H1 before the character list header. Campaigns are buried at equal
  visual weight to "go to a different page."
- There's no *recent activity* or *session-centric* surface. No "Next session: Thursday"
  reminder on the dashboard even though `campaign-overview.tsx:78` already formats this
  information elsewhere.
- The app-header nav (`app-header.tsx:19-26`) exposes Campaigns + Homebrew; Magic Items and
  Settings are only reachable via direct URL or the settings link. Magic Items as a standalone
  page is orphaned from the nav entirely (verified — no link in header).

**Suggestion:** Split dashboard into "Your Tables" (campaigns where you're DM or player),
"Your Characters" (the vault), and a small "Next up" strip if any campaign has a scheduled
session. Or bluntly: make the default landing be `/campaigns` for anyone who owns one.

### 3. Information architecture in the campaign page scales poorly and hides critical affordances.
**Impact:** `campaign-detail-page.tsx:76-116` is an 8-tab strip (Overview, Members, Chat,
Notes, NPCs, Encounters, Maps, Settings) rendered as an overflow-scrolling row. At desktop
width this works; on a tablet or when one tab gets a counter badge (Members already has one),
the tabs wrap awkwardly. Critically:

- **Running an encounter is three clicks deep, not one**: Campaign → Encounters tab → pick
  encounter → click in. At a live table this is friction. The DM's primary job is "run combat"
  — it should be a first-class button on the campaign header, not a tab.
- **DM-only vs shared tabs are not distinguished.** Settings gets hidden for players
  (`campaign-detail-page.tsx:109`), but players also see the "NPCs" tab whose contents are
  partially redacted (per authorization rules). A player visiting NPCs sees whatever the DM
  has marked "shared" and gets zero signal that more exists. A small "DM has private notes here"
  indicator (on the DM's side only) or a softer approach — folding NPCs into Overview for
  players — would avoid the implicit "empty tab" disappointment.
- **"Maps" and "Encounters" are siblings, but a map is only useful in an encounter.** Players
  browsing Maps will find a list of artwork with no combat context. Consider making Maps a
  DM-only prep surface nested inside the Settings or Encounters panel rather than top-level.
- Tab icons (`Scroll`, `Users`, `MessageSquare`, etc.) are lucide line icons — neutral, not
  thematic. Design direction specifically calls out `game-icons.net` for D&D iconography but
  nothing in the tab bar uses it.

### 4. Character sheet is cognitively overwhelming and doesn't adapt to combat.
**Impact:** This is the product's highest-stakes UI moment and the design direction dedicates
a section to it. Today:

- `desktop-sheet-layout.tsx:56-97` renders **15+ panels** side-by-side on desktop with no
  visual hierarchy beyond the three columns. When HP drops or a condition is applied, there is
  no visual signal that combat state has changed — HP is just a number in a `HpAdjuster` card
  mid-column.
- `conditions-bar.tsx:13` collapses to an empty fragment (`<></>`) when there are no
  conditions. When they *do* appear, they're a generic card with gray/red badges — no
  mechanical reminder ("Frightened: disadvantage on ability checks while source visible"),
  no dismiss-on-save nudge. A player under Frightened may not remember what it does mid-turn.
  This is the exact moment a tooltip/popover with the SRD text would save a lookup.
- `sheet-header.tsx:29-55` places the Level Up button on the header even when combat is
  live and no one is about to level. In combat, the buttons you want one-handed are HP +/-,
  "use action", "cast spell" — not "Level Up."
- `combat-stats.tsx:91-100` renders two identically-styled Short Rest / Long Rest buttons
  side-by-side. A player clicking the wrong one mid-session, mid-combat, triggers the wrong
  resource reset dialog. There's no confirmation barrier between them. (To verify: does
  `RestDialog` make the choice clear before committing?)
- **Mobile at 375px renders 7 tabs in a horizontal scroller** (`mobile-sheet-tabs.tsx:96-109`).
  The player auditor correctly flagged this. The "Log" tab only appears with a campaignId —
  which isn't present if the player reaches their sheet via `/characters/$id` — so players
  lose their game log in mobile-first flows where they most need it.
- The desktop sheet has no equivalent "I'm overwhelmed, just show me combat" toggle. No focus
  mode, no way to collapse Personality/Proficiencies/Currency when initiative is rolling.

**Suggestion:** Introduce a "Combat focus" toggle (or auto-enable when the character is in an
active encounter via socket state) that hides non-combat panels, enlarges HP/AC/speed, puts
spell slots and action economy front and center, and pins the conditions bar. The design
direction explicitly calls out "cognitive load during combat" — this is the place to spend
design capital.

### 5. Emptiness is everywhere and the product never feels alive.
**Impact:** This is the dissonance the design direction warned about — theme stays skin-deep
if it's only colors. Specifics:

- **No loading states have personality.** Every skeleton is a grey `animate-pulse` rectangle
  (`dashboard-page.tsx:16`, `campaigns-page.tsx:17`, `homebrew-page.tsx:18`,
  `campaign-detail-page.tsx:40`, `encounter-detail-view.tsx:41`). A dice-roll shimmer or
  parchment-scroll skeleton at load would take minimal effort and carry brand weight.
- **No parchment texture anywhere.** The design direction specifies "subtle noise or parchment
  texture on elevated surfaces" (design-direction.md:41). I searched the CSS (`app.css`) and
  shadcn primitives — zero `background-image` texture. Cards are just flat `bg-card`.
- **No sound feedback.** Dice rolls happen silently in the UI (verified via `useWeaponRoll` /
  `useAbilityRoll` hooks: they invoke server mutations and update state, no audio). For a VTT
  this is a missed emotional beat — Roll20 and Foundry both play dice. An optional dice sound
  (respecting `prefers-reduced-motion` and a user toggle) would transform perceived quality.
- **Join flow is anticlimactic.** `join-page.tsx:57` shows "Joining campaign..." then
  silently redirects. A player accepting an invite to a friend's campaign deserves a moment —
  a "Welcome to the table" confirmation, maybe the DM's name, maybe the campaign blurb.
- **Character creation end state is bare.** `character-create-page.tsx:118` — on success the
  wizard redirects straight to the sheet. No celebration, no summary card, no "your first
  session is ready to begin." A moment of arrival would reward the 8-step investment.
- **Danger-tone mismatches.** `destructive` variant is the same red for "Revoke invite"
  (`invite-panel.tsx:77` — a trivial reversible action) and "Delete Account" (`settings-page.tsx:257`
  — terminal). Red everywhere flattens the severity signal; mid-severity destructive actions
  might use an amber warning state.

---

## Accessibility observations

- **Focus states** are consistent via `focus-visible:ring-2 focus-visible:ring-ring` on the
  `Button` primitive (`button.tsx:8`). Good baseline.
- **Skip link** on `app.tsx:10-15` is well-implemented with `sr-only` / `focus:not-sr-only` —
  this is a bright spot.
- **Form fields** use `aria-invalid` + `aria-describedby` correctly
  (`form-field.tsx:48-50`). Good.
- **Landmark gaps:** Only `<main>` (`app.tsx:17`) is marked. No `<nav>` wrapping the app
  header nav (`app-header.tsx:19` is a `<nav>`, actually — good). No `<footer>`. No
  `aria-label` on the main region to distinguish if nested.
- **Card-as-button pattern** (`species-step.tsx:58-67`): `role="button"` + `tabIndex={0}` +
  `onKeyDown`. Works, but SR users get no affordance that this is a selection group. The
  parent container isn't `role="radiogroup"` — player auditor flagged the same for equipment.
- **Radiogroup without arrow-key navigation** — player auditor noted this already; I endorse.
  Screen-reader users expect Left/Right or Up/Down to move selection in a radiogroup.
- **Toast messages** (`register-page.tsx:59`, various `toast.error` in encounter views) — do
  these announce via `role="status"` / `role="alert"`? Need to inspect `ToastProvider`.
- **Icon-only buttons** mostly have `aria-label` (good: `invite-panel.tsx:65`,
  `encounter-detail-card.tsx:45`), but the short-rest / long-rest buttons on `combat-stats.tsx`
  are plain `<button>` elements with no aria-label — they're styled with text, so OK, but
  verify focus order against the stat cards above.
- **Color contrast** — `hsl(38, 10%, 60%)` for `text-muted-foreground` on `hsl(220, 15%, 10%)`
  background. Roughly 6.5:1 estimated, OK for body but may be borderline for badges at small
  sizes. Worth a systematic axe-core pass.
- **Reduced-motion** — every skeleton uses `animate-pulse` unconditionally. Tailwind respects
  `prefers-reduced-motion` via the default motion-safe utilities, but `animate-pulse` does
  not — it'll keep pulsing. This needs a media-query guard in the shared skeleton classes.

---

## What went well

- **Visual identity lands on first contact.** `dm-01-login.png` is on-brand: deep charcoal,
  gold accent, Cinzel. A first-time user immediately knows this is a tabletop tool.
- **Design tokens are disciplined.** `app.css` defines exactly the palette the spec called
  for. This is the foundation that makes the tone gaps above *fixable* rather than
  systemic — no need to rip out styles.
- **shadcn adoption is consistent.** Every page uses `Card`, `Button`, `Dialog`, `Badge`,
  `Input` from the same primitives. No ad-hoc styled divs for interactive surfaces.
- **Empty vs loading vs error states exist separately.** Rare even in mature SaaS
  (`dashboard-page.tsx:91-107`, `campaigns-page.tsx:109-112`, `homebrew-page.tsx:104-113`).
  The scaffolding is right — only the copy and theming need work.
- **Authorization-aware UI.** DM-only affordances are conditionally rendered throughout
  (e.g. `campaign-detail-page.tsx:109`, `npc-panel.tsx:84-89`). No "you don't have permission"
  walls.
- **Character wizard is non-linear with a visible stepper** (`wizard-stepper.tsx:70-93`). Users
  can jump back to any completed step without losing data. Progress circles + checkmarks are
  the expected pattern.
- **Skip-to-main link** is present (`app.tsx:10`). Better than many production React apps.

---

## Areas for improvement

Beyond the top 5, smaller items worth noting:

- Magic Items page (`magic-items-page.tsx`) is a one-liner wrapping `MagicItemList` with no
  filters, no empty-state, no search. Browsing magic items is a major player activity.
- `join-page.tsx:41-50` drops the invite code if the user isn't logged in. They have to
  click the link a second time after login. Preserve `?redirect=/join/:code` through
  login/register.
- `settings-page.tsx` Profile/Password/Danger are stacked but not tabbed — fine for a
  three-section page, but no visual separation between Password and Danger, they're just
  adjacent cards. A subtle `Separator` or at least more spacing would help.
- DropdownMenu is listed as an expected shadcn primitive in the design direction but is
  absent from `components/ui/`. User menu in the header is just a logout button; no
  affordance for "switch account" or "profile."
- Tooltip / Popover primitives are also listed in the expected set. `components/ui/popover.tsx`
  exists, Tooltip does not. Spell/feat hover previews (a key DM convenience) cannot land
  without it.

---

## Suggestions (quick-wins → investments)

**Quick wins (≤ 1 day each):**
1. Rewrite 6 empty-state strings + 5 error-state strings with thematic voice. Keep the action
   button copy functional; let the prose carry the tone.
2. Add parchment-noise CSS texture to `.bg-card` via `background-image: url(data:image/svg+xml,...)`
   at ~3% opacity. No asset pipeline changes.
3. Add a dice roll sound via a tiny audio element triggered from `useWeaponRoll` /
   `useAbilityRoll`, with a user toggle in Settings. Respect `prefers-reduced-motion`.
4. Add `motion-safe:` prefix to all `animate-pulse` skeletons (5 occurrences).
5. Move the "Campaigns" link on the dashboard into the primary action position — it's
   currently an outline button below the H1 with no icon.
6. Rename the dashboard heading from "Character Vault" to a user-centric label
   ("Your adventurers" or plain "Home").

**Medium investments (1–3 days each):**
7. Build a Tooltip primitive and wire it to condition badges in `conditions-bar.tsx` to show
   the SRD condition text on hover/focus.
8. Add a "Start combat" / "Resume encounter" CTA to the campaign detail header when the
   campaign has an encounter in `active` state. Mirror in the members roster panel.
9. Replace lucide icons in the campaign tab bar with game-icons.net equivalents for the
   thematic tabs (Swords, Shield already approximate; Scroll is fine; NPCs could use a
   hooded-figure glyph).
10. Preserve invite code through login redirect (`join-page.tsx`).

**Larger investments:**
11. Combat focus mode on the character sheet: detect active encounter, collapse
    non-combat panels, enlarge HP/AC, surface spell slots and action economy as a sticky
    header. Mobile: auto-switch to a "combat" tab.
12. Dashboard redesign: "Your Tables" card stack (campaigns with session countdown), "Your
    Adventurers" card stack (characters), and a small "News from the table" feed (recent
    chat messages, DM announcements).
13. Full accessibility pass with axe-core; fix radiogroup arrow-key nav in wizard; ARIA
    live-region for HP / combat-state changes; SR-friendly dice roll announcements.

---

## Open questions for the team

- For **dm-auditor** / **player-auditor**: does the DM have a clear visual signal when
  combat starts (socket event, status bar), or is it buried in a tab? Need your live
  screenshot of an active encounter to confirm.
- For **ui-dev**: is there a reason `Tooltip` wasn't added to `components/ui/` — a Radix
  import concern, or just not yet needed? Condition hints are blocked without it.
- For **backend-dev**: does `encounter.state` push over socket when it flips from `setup`
  to `active`? The combat-focus UX hinges on the client knowing instantly.
- For **ui-dev**: the desktop / mobile sheet layouts (`desktop-sheet-layout.tsx` +
  `mobile-sheet-tabs.tsx`) are cloned. Is consolidating to a single responsive layout on
  the roadmap? Any feature added today must be mirrored in both files.

---

## Session log

- 14:00 — read design-direction.md end to end; noted aspirational tone.
- 14:10 — walked `pages/*` top-to-bottom: dashboard, login, register, campaigns,
  campaign-detail, character-create, character-sheet, homebrew, join, magic-items, settings.
- 14:30 — walked shared primitives (`ui/button`, `ui/card`, `common/form-field`,
  `common/error-boundary`), core sheet panels (`combat-stats`, `conditions-bar`,
  `sheet-header`, layouts), campaign sub-panels (`campaign-overview`, `invite-panel`,
  `npc-panel`), wizard stepper + nav.
- 14:50 — reviewed player-perspective findings (pre-browser notes); endorsed wizard and
  join-flow concerns.
- 15:00 — drafted top-5 with code references; synthesized accessibility observations.
- 16:00 — dm-auditor delivered full findings; re-synthesized DM design tensions below.

---

## DM-perspective synthesis (added 2026-04-14 16:00)

Addresses the six design tensions forwarded by dm-auditor. My lens on each, with a
recommended resolution so ui-dev has an opinion to build against.

### Tension 1 — Persona-aware dashboard
This validates concern #2 in my top-5. Specifically for DMs the inversion is sharper than I
framed it: a DM has *zero* reason to see "Character Vault" as the primary surface. My
recommendation:

- **Short term (behavior-derived, zero schema change):** if `campaigns.filter(c => c.ownerId === user.id).length > 0`,
  render campaigns first on the dashboard and collapse Characters into a secondary panel.
  Keep the Cinzel heading but change it to something session-centric: "Your Tables" as H1,
  "Your Adventurers" as H2. Don't add a role switch — the data already knows.
- **Medium term:** a "Next up" strip at the top that pulls from `campaign-overview.tsx`'s
  `nextSessionDate` across all campaigns, plus any encounter in `state = active` as
  "Resume: Keep Entrance Ambush". The data is there; surface it.
- **Avoid** a manual DM/Player toggle as the primary mechanism — users who wear both hats
  (most) don't want to click a mode switch to reach their stuff.

### Tension 2 — "Private" vs "DM Only" note visibility
`note-editor.tsx:69-71` offers three options: `Shared`, `Private`, `DM Only`. The semantic
overlap is real: for a single-DM campaign, "Private" (author-only) and "DM Only" (all DMs,
currently just you) collapse to the same audience. Recommended resolution:

- **Rename + disambiguate by audience**, not by access level:
  - `shared` → "Visible to party" (all campaign members)
  - `private` → "Only me" (author-only; the DM's own prep notes that no one else sees, not
    even co-DMs)
  - `dmOnly` → "All DMs" (visible to everyone with DM role in this campaign)
- **Inline helper text** under the select: "Only me" / "All DMs in this campaign" /
  "Everyone in the campaign". Tooltip-on-icon is lower discoverability than a one-line hint
  below the dropdown, especially for a setting chosen at write time.
- Hide the `dmOnly` option when the campaign has exactly one DM (the current code already
  hides it for non-DMs at line 71; extend to hide for solo DMs). This removes the confusion
  at its root for the common case. A solo DM sees just "Only me" and "Visible to party."

### Tension 3 — Copy code vs Copy link
Pair-pattern is the right call here. A single button with a dropdown adds one click to a
high-frequency action. Recommendation:

- **Two sibling buttons**: `Copy code` (raw token) and `Copy link` (full URL). Primary is
  `Copy link` — that's what a DM pastes into Discord; `Copy code` is for "read me the code
  over voice."
- Below the code line, add a monospace preview of the URL so the DM can read what they're
  pasting: `http://localhost:8000/join/q3FQcoNZ`. This is the dm-auditor's suggestion and I
  endorse it — it closes the "wait, what am I copying?" feedback gap.
- **Additionally**, have the Join modal accept either a bare code or a URL and strip the
  `/join/` prefix client-side. Belt-and-suspenders: fixes it even for users who paste URLs
  from other sources (Slack / Discord auto-linkify).

### Tension 4 — Party Roster duplicate "Dungeon Master / Dungeon Master"
Two values collide because the display name *happens* to be the role name for the seed
user. The fix is to stop presenting role as text:

- **Style role as a badge, always.** `campaign-overview.tsx:41-43` already does this
  inline: `<span class="rounded bg-amber-500/20 ... text-amber-500">Dungeon Master</span>`.
  The duplication comes from that badge being rendered next to a display name that also
  says "Dungeon Master." Solution is to keep the badge and render the display name without
  suppression — the collision will look silly for seed data but disappears once users have
  real display names. Don't build dedup logic for a seed artifact.
- **Seed-data hygiene:** ask backend-dev to change the seed display name to "Gary Gygax" or
  "Matthew Mercer." This is a data fix, not a UI fix, and removes the odd screenshot from
  every future demo.
- **For role vs name distinction when they do differ:** the current layout is a single
  flex row with the badge *to the right* of the name. Consider moving the badge to the
  *left* of the name, vertically centered, smaller — makes the name the primary read, the
  role a secondary signal. Matches the pattern of how Slack shows "(away)" chips.

### Tension 5 — Destructive action consistency
Three current behaviors: `Revoke Invite` instant, `End Encounter` confirm, `Delete Campaign`
confirm. I recommend a **reversibility ladder**, not uniform behavior:

- **Instant + undo-toast (5s):** actions that are cheap to reverse. Revoke Invite fits here —
  you can always create a new one. Promote the pattern with a shared `useToast().undo()`.
  Hiding a participant, clearing a condition, removing a monster from a setup-phase encounter
  all fit here too.
- **Confirm dialog:** actions that can't be undone by a single follow-up action but don't
  lose data. End Encounter (you can't un-end, but the encounter record persists and XP is
  tallied). This is the current behavior — keep.
- **Confirm dialog + typed confirmation:** actions that destroy data. Delete Campaign, Delete
  Account (already typed-password-confirmed in `settings-page.tsx`). Delete Collection fits
  here too.

So my answer to the "all confirm or all toast-with-undo?" question: **neither**. Match the
severity to the reversibility, and invest in the undo-toast pattern because it's strictly
better than confirm dialogs for truly reversible things (no click needed if the user is
sure → faster; undo window if they weren't → safer than instant-revoke).

### Tension 6 — NPC model: parity vs two lightweight/full concepts
The inconsistency dm-auditor flagged is real: encounter custom NPC (Name/HP/AC/Init) vs
campaign NPC (name/description/location/faction/notes/DM notes) are wildly different
records with the same label. My recommendation:

- **One NPC model, two surfaces.** Keep a single `Npc` record type with the full set of
  fields, and let encounter-time NPC creation use a **minimal form that only requires
  combat-critical fields** (name, max HP, AC, init mod, CR). Treat the rest as optional.
  Save the NPC as a campaign NPC with lore fields blank.
- **Encounter binding is a relation.** The encounter references NPCs by ID (already true
  for monsters). Creating an NPC mid-encounter creates a campaign NPC and binds it —
  afterwards, the NPC appears in the campaign NPCs tab where the DM can fill out lore /
  faction / location / notes.
- **"Promote to campaign NPC" becomes a no-op.** Because every encounter NPC is already a
  campaign NPC under this model. No manual migration path needed.
- **Why not two lightweight/full concepts?** Because DMs *will* want to promote a
  mid-combat throwaway into a recurring character ("oh, Captain Mordain survived, he's now
  the villain for session 5"). If those are separate models the promotion is a manual
  retyping job. Unifying removes that friction permanently.
- **Risk:** the campaign NPCs tab now shows every encounter-created NPC including truly
  disposable ones ("Goblin Archer #3"). Mitigate with a default filter "Show named NPCs
  only" that hides records where `description`, `location`, `faction`, and `notes` are all
  empty, and a toggle to include them.

### Cross-cutting observations from the DM findings

Two themes came up across the DM audit that I'd add to my top-5 on re-read:

- **Copy-quality sloppiness is a recurring leak, not just microcopy tone.** The raw Zod
  "Too small: expected string to have >=1 characters" error (`dm-25`) is a form-validation
  bug class: any path that doesn't run through an explicit message catalog can leak
  developer-facing text. A shared error-messages module + a rule that `formatFieldErrors`
  must route through it would prevent whole categories of these. Fits under my top-5 #1
  but is a systemic infra ask, not just "write better strings."
- **Silent success is the opposite bug of loud failure.** The Settings "Save Changes" with
  no toast (dm-auditor #4) and the Create Campaign that doesn't redirect into the new
  campaign (#10) are both confidence-signal gaps. A shared `useToast()` + a "navigate to
  created resource" pattern would cover both. This is a top-5 #5 "product doesn't feel
  alive" sub-point — confidence signals are cheap and the product is missing them on the
  most frequent DM actions. Frame this as a usability invariant — "every mutation completes
  in the UI, either via toast or route change" — not as a per-form fix, so new mutations
  inherit the guarantee.

### Round-2 sharpenings (from dm-auditor 16:30)

Two refinements accepted post-synthesis; folding into the call record so the synthesizer
doesn't miss them:

- **Next-up strip needs a graceful empty state, not a hidden section.** `nextSessionDate` is
  nullable and was null on both of dm-auditor's campaigns. A hidden-when-null strip means
  DMs never discover the field. Render `Schedule the next session →` as a muted
  call-to-action when the strip would otherwise be empty; link straight to campaign
  Settings.
- **Hide the Characters H2 entirely for DM-only users with zero characters.** An empty-state
  card suggesting "Create Character" is wrong framing for someone who exclusively DMs; the
  reliable heuristic is `campaigns.owned > 0 && characters.length === 0` → suppress the
  section (not just the empty state). If they later create a PC the section returns.
- **Audience-wording parity across surfaces.** "Visible to party" must mean the same thing
  on notes, NPC DM-notes, and map-marker notes. If any surface has a different access rule
  (e.g. DM-author-only vs all-campaign-members) pick distinct labels. Audit at copy-freeze
  time — don't let the phrase drift between editors.
- **Dynamic visibility options:** when a second DM is invited to a campaign, "All DMs"
  re-appears in the visibility selects automatically. Not a user-controlled toggle, just a
  derived option — keeps the common case clean without configuration.
- **Typed-confirmation guard for delete-campaign.** dm-auditor flagged that `campaign.delete`
  has no typed guard today. Given invite URLs exist and can't be clawed back post-deletion,
  require the user to type the campaign name (matching the `settings-page.tsx` delete-account
  pattern). Fits the reversibility-ladder top tier.
- **Inverse filter label for NPCs.** "Show named NPCs only" default + "Include mooks &
  extras" toggle reads better than "Show all" — it teaches the mental model in the toggle
  label instead of asking DMs to infer it.

### Fog of war — product direction (answer to backend-dev D9)

Go with **model #1 (DM-opacity client render)** for the first pass. Defer the schema work
for per-user fog until there's a product owner for personal-fog features.

Why:

- **Matches DM-as-narrator mental model.** The DM is outside the veil, pulling it back for
  players. Fog is a translucent overlay that indicates *what players can't see yet* — the
  DM can see the map underneath at all times. Foundry and Roll20 both default to this for
  good reason.
- **Per-user fog is a different feature.** "Personal fog" is adjacent to stealth /
  invisibility / perception-per-PC — a much larger design space (line-of-sight rays,
  vision types, dynamic lighting). Don't model the schema until someone owns that feature.
- **Pairs with the combat-focus concern in top-5 #4.** DMs need low-cognitive-load map
  awareness during combat. A dimmed-but-visible fog layer gives them that without a toggle.

Interaction pattern for ui-dev:

- **Default fog opacity for DM: ~35%.** Players see ~95% (near-opaque).
- **Paint mode (reveal/hide tools):** temporarily bump DM fog to ~60% while the tool is
  active, so the DM sees exactly what they're painting over. Drop back to 35% on tool
  dismiss.
- **No role toggle in the UI.** Role is already known; don't add a "show fog as player would
  see it" button until a DM explicitly asks for it. A compound "preview player view" (hides
  fog + DM notes + unrevealed tokens together) could land later as a single action.
- **Visual treatment — dark-fantasy fog, not cold gray.** Use warm charcoal
  (`hsla(30, 15%, 8%, 0.35)` for DM, `hsla(30, 15%, 8%, 0.95)` for players). Reads as
  candlelight-shadow, not as a generic UI scrim — supports the parchment/spellbook identity
  from design-direction.md.
- **Validate against lit map tiles before committing.** dm-auditor flagged: on a light
  sandstone or parchment-style floor even warm charcoal at 60% opacity can mud the grid
  lines enough to hurt tactical reading. Sample the shroud against a real lit tile during
  build and tune opacity/tint from there — 35/60/95 are starting points, not final.
- **Polish pass (post-v1):** a subtle noise/grain texture layered on top of the flat tint
  may sell "unseen" better than flat opacity alone. Not a v1 blocker; belongs in the same
  pass as the parchment-texture work in top-5 #5.
