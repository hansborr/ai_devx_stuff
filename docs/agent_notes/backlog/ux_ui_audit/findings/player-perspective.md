# Player audit — 2026-04-14

Persona: player1@example.com (joined "Shattered Keep of Thalor" as Player).
Character built & driven during audit: **Aerion Stormveil** (Elf, Cleric 4 / Life Domain,
Acolyte background). Campaign ID `cmnzo9m120004y7qvapwk25cd`, character ID
`cmnzp39qn0018y7qvev3pzths`.

Coverage:

- Full 8-step character creation (Cleric spellcaster)
- Sheet desktop (1280×900) and mobile (375×812)
- Resources: damage / heal / temp HP, short rest, long rest, spell slot cast
- Level-up 1 → 2 → 3 → 4 (HP, ASI, subclass, metamagic cases checked)
- Spells: add, prepare, cast, slot decrement
- Campaign: overview, members, chat (partial), encounters (resolved only — no
  active fight available to test live combat)
- Error states: invalid character ID, invalid invite code, stale session
- Keyboard focus, tab navigation, skip link
- Homebrew and compendium visibility as a player (non-DM)

## What went well

- **Character vault empty state** is friendly with a clear CTA and matches design
  direction (parchment card, understated).
- **Long-press / Shift+Enter roll menu** on ability/save/skill rows works with
  keyboard, Escape, and arrow keys — the context menu is well-built.
- **Skills list** renders ability abbreviations in parens `(WIS)`, `(DEX)` — easy
  to scan at-a-glance.
- **Equipment option cards** in the wizard use `role="radio" aria-checked` and
  visually show the active state clearly.
- **Wizard stepper** persists data when stepping back; no values are lost when
  toggling Species → Class → back to Species.
- **Character deletion** on dashboard card has a confirm dialog and an icon —
  the destructive action is not a primary button.
- **Invalid character ID** (`/characters/bogus`) renders a clean "Character not
  found" with a Back to Dashboard link rather than a raw error.
- **Invalid invite code** (`/join/INVALIDCODE123`) surfaces a friendly alert
  (`Invalid invite code.`) and a "Go to Campaigns" escape hatch.
- **Passive Perception** is surfaced at the top of the sheet on both desktop
  and mobile — easy to find.
- **Short rest** dialog correctly offered both hit dice, applied +12 HP
  (4 + 8 from two d8+2), and decremented remaining HD from 4 to 2.
- **Skip-to-main-content** link is present on every page and works with
  keyboard Enter.
- **Player does not see DM-only NPC notes**; the NPCs tab respects
  `isVisibleToPlayers` — confirms docs/authorization.md.

## What went wrong

### Critical

1. **Sheet renders "Unknown / Unknown 4 / Unknown" after a hard reload.**
   Repro:
   1. Open character sheet, confirm it shows "Elf / Cleric 4 / Acolyte".
   2. `location.reload()` (F5).
   3. Header now shows "Unknown / Unknown 4 / Unknown" and Spells tab shows
      "No spellcasting ability".
   Root cause is visible in the console: a batched tRPC request
   `srd.listSubclasses,srd.listSpecies,srd.listClasses,srd.listBackgrounds,srd.listFeats,inventory.list,characterSpell.list`
   returns **404** on that combined route during reload. Subsequent navigation
   away + back fixes it, but a refresh doesn't re-trigger the batch.
   File: `packages/client/src/hooks/use-srd-lookups.ts` — the `useSrdLookups`
   hook has no retry policy and the sheet has no loading state, so when the
   queries fail, `.get()` returns `undefined` → fallback string `"Unknown"`
   is baked in.
   Evidence: `screenshots/player-sheet-unknown-bug.png`.

2. **Level-up dialog text reads "Advance X from level 4 to level 5 as a Unknown."**
   Same root cause — SRD hook fails → no class name → the class string falls
   through to the literal word "Unknown". Happens on every hard-reloaded sheet.
   Screenshots: `player-levelup-unknown.png`.

3. **Wizard Equipment step never shows class starting equipment.**
   For a Cleric, a starting pack should include a weapon + armor + holy
   symbol + priest's pack, etc. In the wizard I saw only a short list
   derived from the **Acolyte background** (Option A: Holy symbol, Prayer
   book, Incense sticks × 5, Vestments, Traveller's clothes, 8 gp /
   Option B: 50 gp only). No Cleric class option at all.
   After create, `/characters/:id` → Combat tab shows "No weapons equipped"
   and Gear tab shows "No items yet" regardless of which option the wizard
   chose.
   File: `packages/client/src/components/character-create/steps/equipment-step.tsx`
   (only iterates `background.equipmentOptions` — nothing for class).

4. **Wizard lets the user advance without picking a subspecies.**
   Validator at `wizard-state.ts:STEP_VALIDATORS.species` requires only
   `speciesId !== ""`. Elf has 3 subspecies (Drow / High Elf / Wood Elf) —
   the wizard shows them on the Species screen but Next is enabled even
   when none is selected. The character saves with `subspeciesId: null`
   and the resulting sheet silently skips the subspecies feature set.

5. **Inventory is disconnected from wizard equipment choice.**
   Selecting background Option A in the wizard (which lists Holy symbol,
   Prayer book, vestments, etc.) does **not** create any inventory rows.
   The Combat tab says "No weapons equipped" and Gear tab says "No items
   yet". Either the wizard never persists, or `inventory.list` is not
   reading from the equipment source chosen in the wizard.

6. **Cast Spell / Attack in combat is a blank form (no character
   context).** The dialog doesn't know about the character's prepared
   spells, attacks, spell slots, or proficiency bonus. Player has to
   hand-type "Spell Name", "Attack Bonus", "Damage Dice", etc. each
   turn. See Areas-for-improvement #5 for full detail. This is the
   biggest player-side UX gap in live combat.

7. **Failed combat actions fail silently.** The tRPC call
   `encounterCombat.castCombatSpell` can return `403 Forbidden` (e.g.
   when cast is out of turn), but the dialog stays open, the combat
   log is empty, and no toast surfaces. The user has no clue why
   "nothing happened". Applies to attack and any participant-scoped
   mutation. Root cause is absence of `onError` handlers on the
   dialog mutations.

### High

6. **Resolved encounter reveals NPC faction names to players.**
   On the "Keep Entrance Ambush" resolved encounter, player sees
   `Captain Mordain (Fallen Garrison)` — the parenthesised faction is DM
   worldbuilding and shouldn't be leaked to players who never encountered
   him. Players also see the `frightened (permanent)` condition on the
   Owlbear without any action. If the condition was applied by a DM spell,
   its source may be campaign-sensitive.
   File: `packages/client/src/components/encounter/…` (initiative-list
   renderer). Consider hiding `(…)` suffixes on NPC display names for
   non-DM viewers.

7. **Header navigation disappears entirely below 640px.**
   `app-header.tsx` uses `hidden sm:flex` on the nav element. At 375px
   (iPhone 13 baseline), the player can see only Musi logo + Settings +
   Notifications + Logout. **There is no hamburger menu** — the only way
   back to Campaigns is to tap the logo (dashboard) then Campaigns button
   on the dashboard body. This is 2 taps for a frequent action.
   Screenshots: `player-mobile-dashboard.png`,
   `player-mobile-sheet-combat-focus.png`.

8. **/magic-items does not resolve; real route is /compendium/magic-items.**
   Typing `/magic-items` (a plausible guess) returns "Not Found". Route
   defined at `packages/client/src/routes/magic-items-route.ts` is
   `/compendium/magic-items`. There is no redirect, no nav link, and no
   button on dashboard/sidebar. Players can only discover it by reading
   source code. Same accessibility issue as header nav for magic items —
   no entry point at all.

9. **Wizard "Review" step shows "Starting Gold: 0 gp" for Option A + no items.**
   Because Option A gives concrete items (no GP) and Option B gives GP only,
   the review step always displays "Starting Gold: 0 gp" when A was chosen,
   instead of listing the items. The user's last confirmation before
   submission shows a stripped-down summary that doesn't reflect the
   wizard choice. Combined with bug #5 (items never persist), the player
   has no accurate picture of what they're getting.

10. **Level-up dialog shows fighting-style feats to Cleric.**
    `packages/client/src/components/sheet/asi-step.tsx` filters the feat
    list to `type === "general" || type === "fightingStyle"`. Fighting
    Style feats (Archery, Defense, Great Weapon Fighting, Two-Weapon
    Fighting) are class-specific — a Cleric picking one produces an
    invalid build. Filter should be based on class eligibility, not feat
    type.

11. **Only one Cleric subclass is seeded (Life Domain).**
    At class-level 3 the subclass picker shows a single card. Expected
    Knowledge / Life / Light / Trickery per SRD 5.2.1 p.73. Not a UX bug
    per se but it blocks meaningful subclass UX testing.

12. **Character-to-campaign-member assignment has no feedback.**
    Overview → Members → combobox "Assign character" silently persists
    the pick. No toast, no visual confirmation beyond the combobox value
    updating. User is left guessing whether the save succeeded. Same
    pattern dm-auditor flagged on Settings → Save.

### Medium

13. **"Joining campaign…" paragraph remains visible even while the alert
    reads "Invalid invite code."** The UI state machine doesn't clear
    the in-flight message when an error resolves. Screenshot:
    `player-invalid-invite.png`.

14. **ASI step renders ability name + score with no space.**
    On the Ability Score Improvement step, a control reads "Wisdom17"
    (literal, no space) and "Strength8" — concatenated label + value
    without a separator. Screen readers will announce them as one word.

15. **Grappler feat description shows literal markdown asterisks.**
    Level-up ASI step, Feats tab → Grappler card body includes the raw
    string `**Ability Score Increase.**` with no markdown rendering.
    Other feat descriptions look similarly un-rendered. Either use a
    markdown renderer or strip the asterisks server-side.

16. **Cleric's Divine Order choice is buried in class description prose.**
    The Class step shows "Divine Order. You are a Protector or a
    Thaumaturge…" as a paragraph. There is no widget / select to pick
    one. Rules say it's a level-1 feature choice. Player has no way to
    record it.

17. **Wizard "Suggested abilities: INT, WIS, CHA" is plain text with no
    visual highlight.** The ability array dropdowns don't badge/colour
    the suggested ones. Player has to re-read the suggestion, then find
    the matching option.

18. **Background descriptions show as empty `<p>` elements.**
    On the Background step cards, the description text area is empty
    for multiple backgrounds (Acolyte included). The heading renders,
    but the body is blank. Could be missing seed data, could be a
    renderer issue.

19. **Inline editing of Personality fields isn't obvious.**
    On the sheet, "Traits / Ideals / Bonds / Flaws / Backstory" look
    like regular text, but they're actually buttons
    (`button "Edit Ideals"`). No visible affordance: no edit icon, no
    hover underline, nothing hints that "Add ideals..." is clickable.

20. **Compendium Magic Items list has no search / filter.**
    `/compendium/magic-items` renders a long paginated list with a
    "Load more…" button but no search box, no rarity filter, no type
    filter. At 300+ entries this becomes unusable for reference.

### Low / Polish

21. **Radix console warning: "Missing `Description` or
    `aria-describedby={undefined}` for {DialogContent}"** repeated every
    dialog render. Real a11y issue flagged already by the framework —
    all `<DialogContent>` callers need a `<DialogDescription>` or
    `aria-describedby`.

22. **Header shows "Musi" in a serif font as the logo, but mobile header
    loses the subtitle navigation context.** A first-time player can't
    tell what page they're on from the chrome alone — the breadcrumb
    (`← Dashboard`) is in the body, not the chrome.

23. **Dashboard heading is "Character Vault" but the URL is `/dashboard`
    and `/characters` returns 404.** The route vocabulary and the
    heading vocabulary don't match; a user bookmarking or URL-hacking
    will hit 404.

24. **Mobile sheet has no "Log" tab.** Desktop sheet has a combat log
    panel in the main grid; mobile sheet tabs are Stats / Combat /
    Features / Gear / Spells / Info — no log. A mobile player can't
    see their own roll history.

## Areas for improvement

1. **Render-time SRD safety.** The entire sheet and level-up dialog
   assume `speciesName`/`className`/`backgroundName` queries resolved.
   When they don't (reload race, network error, long batch URL), the UI
   renders the fallback string "Unknown". Either:
   - Make the sheet render a skeleton/loading state while
     `useSrdLookups().isLoading`, **or**
   - Make the lookup hook suspense-based and wrap the sheet in
     `<Suspense>`.
   This alone would remove the worst finding above.

2. **Separate Character-Vault and "Campaign Hub".** Currently the
   dashboard mixes a "Characters" section with a "Campaigns" CTA — it's
   unclear whether the dashboard is a campaign portal, a character
   picker, or a personal hub. Consider `/dashboard` = campaign list
   (most common task) and `/characters` = vault (power user).

3. **Mobile navigation needs a menu.** A hamburger button exposing
   Campaigns / Homebrew / Settings / Logout / Magic Items is the
   absolute baseline for a usable mobile experience.

4. **Wizard → character persistence gap.** Every equipment-related
   wizard step needs to write actual rows. Right now the review page
   lies ("Starting Gold: 0 gp") and the sheet Inventory is empty
   regardless of choice. This is a trust-breaking bug for a first-time
   user.

5. **Player-facing combat view** (tested on "Ambush at the Gate" active
   + "Keyboard Test" resolved with Keep Courtyard map linked):
   - **Monster HP is correctly hidden from players.** Only my own 31/31
     renders; Dire Wolf / Goblin Scout / Goblin Raider rows show just
     name + type + initiative, no HP bar. Good boundary.
   - **No roster-level "it's your turn" highlight for the player.** The
     active participant gets a `Current` chip next to the name, but
     there's no banner/toast when it becomes my turn — easy to miss in
     a voice-call DM session.
   - **Attack dialog is a blank form.** Open via the sword icon next to
     my name → dialog titled "Attack — Aerion Stormveil" with Target
     (monster list), Normal/Adv/Disadv, and empty text fields:
     Attack Name, Attack Bonus, Damage Dice, Damage Bonus, Damage Type.
     None of the character's actual attacks (even just "Unarmed
     Strike" let alone equipped weapons) are preloaded. The player has
     to retype values they already know live. "Roll Attack" is disabled
     until fields are filled. Screenshot: `player-attack-dialog.png`.
   - **Cast Spell dialog is a blank form with no spell list.** Same
     pattern — target picker + Normal/Adv/Disadv + Spell Attack /
     Saving Throw toggle + empty text fields. Character's prepared
     spells (Cure Wounds, Guidance) aren't enumerable. There's also no
     **spell-slot selector** — the dialog has no way to say "I'm
     casting this at level 2". When I submitted anyway, the backend
     returned `403 Forbidden` (probably because it wasn't my turn) but
     **the UI showed no error** — dialog stayed open, combat log empty,
     no toast. Silent failure.
     Screenshot: `player-cast-spell-form.png`.
     Console: `Failed to load resource: 403 Forbidden @
     /trpc/encounterCombat.castCombatSpell`.
   - **Combat log stays "No combat actions logged yet."** even after
     the DM has advanced the encounter to Round 1 Turn 1. Either (a)
     the log is wiped on resolve, (b) no actions have happened and
     Round 1 Turn 1 just means "initiative is set", or (c) the log
     query isn't firing for the player viewer. Worth asking
     backend-dev.
   - **Linked map panel renders in a resolved encounter** ("Keyboard
     Test" → Keep Courtyard with 5 canvases). Tools (Select / Measure /
     Cone / Cube / Sphere / Line / Emanation / Zoom / Fit / Grid
     toggle) are all enabled for the player, same as the standalone
     Maps tab.
   - **Map panel does NOT render for "Ambush at the Gate"** even
     though it is active — because that encounter has no linked mapId
     (`encounter-detail-view.tsx:274` gates on `encounter.mapId`).
     Matches dm-auditor's note that the encounter creation flow
     doesn't auto-link a map.
   - **Tokens list in the Maps tab shows tokens from other
     encounters** (I saw "Bugbear Warrior" while viewing Keep
     Courtyard, which belongs to a different fight). Possible
     map-vs-encounter data scoping issue.
   - **Action buttons are visible next to my name even when it's not
     my turn.** On the active encounter, Dire Wolf was "Current" and
     my sword/spell icons were still clickable. This invites the
     silent-403 scenario above. Should disable the buttons or explain
     why.
   - **Chat history renders DM rolls correctly.** The chat tab shows
     the DM's earlier `2d20kh1+5 → 2, 15, +5 → 20` roll with a dice
     icon strip underneath (d4/d6/d8/d10/d12/d20 presets). Good.

## Suggestions

- (Ship quickly) Add an `isLoading` guard to `SheetHeader`,
  `CombatTab`, and `SpellsTab` that shows `<Skeleton />` while the
  SRD hook is fetching. Drop the `"Unknown"` fallback entirely; swap
  it for `"—"` so if it ever does render, it's obviously a missing
  reference, not a misspelled class name.
- (Low cost, high value) Add a `/characters` → `/dashboard` redirect
  and a `/magic-items` → `/compendium/magic-items` redirect so the
  obvious URL guesses work.
- (Low cost) Bump the wizard step validator for species from
  `speciesId !== ""` to also require `subspeciesId !== ""` for any
  species that has subspecies.
- (Medium cost) Wire the wizard's equipment selection to actually
  write inventory rows on submit, and include a class starting
  equipment block alongside the background block. Until this is done,
  the wizard is effectively decorative for gear.
- (Medium cost) Filter ASI feat list by class-legal feats, not by
  `type`. A simple `eligibleClasses?: string[]` on the Feat type
  covers the Fighting Style case.
- (Small) Add an edit pencil icon or hover underline to the
  sheet's Personality "Add bonds / traits / …" affordances.
- (Small) Add a `DialogDescription` to every `DialogContent` caller,
  at minimum an `sr-only` one. This removes the noisy console warning
  and is a real a11y improvement.

## Open questions for the backend dev

1. **Why does the batched tRPC request with 7 procedures return 404**
   on hard reload? Is there a plugin-level URL/procedure-count cap in
   the Fastify tRPC adapter, or does it race with token refresh? Same
   7-procedure batch works for me when called from a nav click but
   404s on reload. Check `packages/server/src/plugins/trpc.ts` and the
   token-refresh interceptor on the client.

2. **Should "Starting Gold" in the wizard review always reflect the
   chosen equipment option?** Right now it always reads `0 gp` for
   Option A even though A gives 8 gp in the Acolyte background and
   Option B gives 50 gp.

3. **Is the wizard supposed to emit inventory rows, or is that a
   separate post-creation task the player does?** If separate, the
   sheet should surface a "Choose your equipment" prompt after create.

4. **Can encounter participant names be filtered for DM-only
   metadata** (the parenthesised faction in `Captain Mordain (Fallen
   Garrison)`) before broadcast? Either strip at the server on
   `isDm=false` or add a `publicName` field.

5. **Does the character creation path ever call `srd.getClassFeatures`
   for class-level-1 choices** (like Cleric's Divine Order)? If not,
   the wizard is skipping level-1 choice-type features entirely —
   confirm and plan how to add widgets.

6. **Are non-SRD subclasses seeded for Cleric?** Only Life Domain
   showed up. Either seed data is incomplete or the listSubclasses
   query is filtered to a subset — need to know before we file "only
   one subclass shown" as a UI bug vs a data bug.

7. **Why is homebrew-collection creation available to players?**
   Matches my prior note — if intentional, fine. If not, the button
   in `homebrew-page.tsx` needs a role gate.

8. **Why does the combat Cast Spell / Attack dialog not pull from the
   character's prepared spells / attacks?** Is there a plan for this
   that just hasn't shipped, or is the blank-form version intentional
   for homebrew content? The current UX asks the player to be their
   own rulebook. Related: should `castCombatSpell` return a typed
   error (e.g. `FORBIDDEN: not your turn`) that the dialog can
   surface, instead of a raw 403?

9. **Which view layer is responsible for "your turn" notifications?**
   Server sends the encounter state via socket; client re-renders the
   initiative list with a `Current` chip. Nothing currently surfaces
   "it's your turn" above that. Who should own that (socket payload
   vs client selector)?

10. **Is the Tokens list in the Maps tab scoped per-map?** I saw a
    Bugbear token while viewing Keep Courtyard, but that token is
    linked to a different encounter. Either the list is all-tokens-
    in-campaign or the token-to-map association isn't strict.

## Session log (selected)

- Created Aerion Stormveil from scratch (8-step wizard).
- Leveled 1 → 2 (HP avg, no subclass, no ASI).
- Leveled 2 → 3 (HP avg, picked Life Domain as the only available subclass).
- Leveled 3 → 4 (HP roll 1d8 → 5 + 2 CON = +7; ASI: WIS 17 → 19).
- Added Guidance + Cure Wounds; prepared them (0/4 → 2/4).
- Cast Cure Wounds level-1 slot, confirmed slot decremented 4/4 → 3/4.
- Took 15 damage → 16/31 HP, Long Rest → 31/31, then Short Rest with
  2 hit dice → roll d8=4 + d8=8, +12 HP (well, wraps at max).
- Assigned Aerion to campaign member "Aragorn" via combobox.
- Explored Resolved encounter "Keep Entrance Ambush" (see finding #6).
- Explored compendium magic items at `/compendium/magic-items`.
- Tested invalid invite code, invalid character ID, hard reload of sheet
  (finding #1).
- Resized to 375×812, retested sheet + dashboard + encounter + homebrew.
- Homebrew as a player: can create collections (possible bug — finding
  question #7).
