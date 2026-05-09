# UX/UI Audit — Verification Pass

Date: 2026-04-17 (audit findings dated 2026-04-14/15)
Method:
- Live Playwright walkthroughs with `dm@example.com` and `player1@example.com` against the running dev server (`localhost:8000` / `localhost:8001`).
- Three parallel `Explore` subagents doing code-level verification of the per-role findings (ui-dev, backend, ux/player).
- Cross-checked against `git log` since 2026-04-13 — recent commits are scoped to package.json hygiene, output-schema wiring, level-up / combat-actions / spell-casting deep-module refactors, and a canvas-input refactor on the client. No commits address the UX gaps in the audit.

This document classifies every Top-11 issue, every honorable mention, every backend finding, and every UX/copy finding as one of:

- **Confirmed** — issue still present; reproducible or evidence in current code matches the audit.
- **Partially fixed** — direction has improved but the audit's full ask remains unmet.
- **Fixed** — code has changed and the issue no longer reproduces.
- **Unable to reproduce** — could not exercise the path; status undetermined.
- **Audit was wrong / overstated** — current code does something different from the audit's claim.

New issues observed during this verification are listed in their own section.

---

## 1. Top-11 priority issues

### #1 — Sheet renders "Unknown / Unknown 4 / Unknown" after reload — **Confirmed**

Reproduced live on `/characters/cmnzp39qn0018y7qvev3pzths?campaignId=…` as `player1`:

- Sheet header: `Unknown` / `Unknown 4` / `Unknown` for species / class / background.
- `Spells: No spellcasting ability` for a Cleric Lv 4 (cascading from the broken class lookup).
- After hard reload + 3-second wait, values do not resolve; UI is permanently stuck.
- Browser console shows the exact 404 the audit predicted:
  ```
  GET /trpc/srd.listSubclasses,chat.list,campaign.get,srd.listSpecies,srd.listClasses,
       srd.listBackgrounds,srd.listFeats,inventory.list,characterSpell.list?batch=1 → 404
  ```
- Level-up dialog title: `"Advance Aerion Stormveil from level 4 to level 5 as a Unknown."` (matches audit citation `level-up-dialog.tsx:250-310`).

Code (`use-srd-lookups.ts:20`, `sheet-header.tsx:24`) still uses the literal string `"Unknown"` as the fallback. Skeleton on `srd.isLoading` not implemented.

### #2 — Wizard equipment never lands in inventory; gold display lies — **Confirmed**

`equipment-step.tsx:89-90` still iterates only `selectedBg?.equipmentOptions`; no class equipment block. Aerion (seeded Cleric / Acolyte from the player auditor's pass) shows `No items yet. Add your first item!` on the Inventory tab — matching the audit's symptom. The "Starting Gold: 0 gp" review-step display also remains.

### #3 — Mobile navigation disappears below 640px — **Confirmed**

Reproduced live at viewport `375×812`: header collapses to `Musi · Settings · Notifications · Logout`. The `<nav>` containing Campaigns / Homebrew is gone with no hamburger, no popover trigger, no drawer. `app-header.tsx:19` still uses `hidden ... sm:flex`.

### #4 — Homebrew is disconnected from play on three surfaces — **Confirmed**

Code-level evidence (subagents):

- `monster-tab.tsx:260` calls `trpc.monster.list` (SRD-only) with no homebrew union.
- `add-spell-dialog.tsx` queries the SRD spell list with no homebrew union path.
- The Compendium magic-items list (`/compendium/magic-items`) similarly queries SRD-only.

Live confirmation deferred (would need a fresh homebrew monster authored, then attempted addition to the encounter). The audit's DM persona did this; the symptom would re-appear given identical code.

### #5 — Token drag pans the camera instead of moving the token — **Confirmed (code)**

- `map-canvas.tsx:141`: Stage `draggable={!input.isToolCapturing && !input.isInteractiveTool}`.
- `token-shape.tsx:127`: `Group ... draggable={draggable}`.

Both predicates are true in Select mode, so the conflict the audit described is structurally present. Live drag not exercised — Konva drag is not assertable via `playwright-cli`.

### #6 — Attack / Cast Spell dialogs require manual entry every turn — **Confirmed (with one correction)**

Opened the Attack dialog from the live `Ambush at the Gate` encounter for the Dire Wolf attacker. The dialog is the all-custom form: Attack Name (empty), Attack Bonus (0), Damage Dice (`1d6`), Damage Bonus (0), Damage Type (`slashing`). No mode toggle, no weapon dropdown, no monster-action selector. `attack-roll-dialog.tsx:26` still pins `mode: "custom"`.

**Correction to the audit:** the audit said *"The Target control also defaults to **self**."* That does not reproduce — `attack-roll-dialog.tsx:199` filters the attacker out of the targets list, and the live dialog defaulted Target to `Aerion Stormveil` (first non-self participant). The broader claim (no preloaded weapon/monster-action) is correct; the "defaults to self" detail is wrong.

### #7 — Combat-linked map does not auto-create tokens for monster / NPC participants — **Confirmed**

`encounter-map-link.tsx:40, 57` still labels the icon button `Auto-link character tokens` and emits `Auto-linked N tokens` (no special-case for 0). The combat-side `pendingTokenCell` consumer is still missing from `combat-map-panel.tsx` per the ui-dev subagent.

### #8 — Destructive confirmations use plain `Dialog`; `window.confirm()` for fog reset — **Confirmed**

Live: clicking Reset fog on the Maps tab triggers a native browser confirm modal — Playwright reports `["confirm" dialog with message "Reset fog? This will hide the entire map for players."]`. So `window.confirm()` is still in place.

Code (subagent): no `AlertDialog` primitive exists yet. Nine dialogs still use plain `Dialog` without `role="alertdialog"`:

- `delete-character-dialog.tsx:29`
- `campaign/delete-confirm-dialog.tsx:21`
- `campaign/end-encounter-dialog.tsx:32`
- plus the homebrew, settings, and revoke surfaces named in the audit.

### #9 — Combat mutations fail silently — **Partially fixed**

There is now a `toast.error` in both combat mutation handlers:

- `encounter-detail-view.tsx:116` — `toast.error("Failed to resolve attack")`.
- `encounter-detail-view.tsx:128` — `toast.error("Failed to cast spell")`.

The audit's *primary* complaint — that 403s landed silently — is no longer accurate; a generic toast does fire. **However**, the audit's stricter ask remains unfulfilled: there is no branching on `error.data.code`, the dialog does not auto-close on `FORBIDDEN` / `PRECONDITION_FAILED`, the toast doesn't echo the server reason, and no inline banner exists for `BAD_REQUEST`. Live 403 reproduction not exercised (would need an out-of-turn cast); the static code is unambiguous.

### #10 — Silent successes (Settings save, Create Campaign nav, Assign Character, auto-link toast) — **Partially fixed**

Mixed picture:

- **Confirmed (no change):** `campaign-settings-panel.tsx:41-48` has no `toast.success`. Settings save remains silent.
- **Partially fixed:** `create-campaign-dialog.tsx:85` now emits `toast.success("Campaign created!")`, but it still does not navigate into the new campaign (audit's full ask).
- **Confirmed (no change):** `encounter-map-link.tsx:40` still emits `Auto-linked 0 tokens` rather than an empty-state message.
- **Not exercised live:** Assign Character; static code unchanged.

### #11 — Generic SaaS copy + raw Zod errors — **Confirmed**

- Dashboard H1 is still `Character Vault` (`dashboard-page.tsx:128`).
- `No characters yet. Create your first character to get started.` (`dashboard-page.tsx:27`).
- `No campaigns yet. Create your first campaign or ask a DM for an invite.` (`campaigns-page.tsx:48`).
- `No collections yet. Create your first homebrew collection to start building custom content.` (`homebrew-page.tsx:43`).
- Shared schemas — `.min(1)` calls in `campaign-inputs.ts:16`, `note-inputs.ts:20`, `npc-inputs.ts:15`, `homebrew-inputs.ts:15` (and elsewhere) still lack `{ message: ... }`. Raw Zod messages will surface on blank submits.
- `favicon.ico` 404 reproduced live on `/login` cold load.
- Note visibility labels (`Shared`, `Private`, `DM Only`) unchanged in `note-editor.tsx:69-71` and `notes-panel.tsx:95-97`.

---

## 2. Honorable mentions

| Item | Status | Evidence |
|---|---|---|
| Sheet dual-mounts desktop + mobile | **Confirmed** | Live: `document.querySelectorAll('[data-testid]')` on Aerion's sheet returns 30 testids that appear twice (`ability-STR`, `save-DEX`, every skill). Code: `sheet-body.tsx:88-95` still renders both layouts unconditionally with CSS-only visibility toggle. |
| Theme-token drift (raw Tailwind palette) | **Confirmed** | Subagent grep found 23+ violations: `participant-stats.tsx:20-22` (`bg-green/yellow/red-500`) vs `hp-adjuster.tsx:28-31` (`bg-success/warning/destructive`); `difficulty-styles.ts:4-7`; `magic-item-utils.ts:17-25`; `text-amber-500` in 5+ files; `bg-amber-500` in attack/weapon dialogs; raw hex `#1a1a2e` in `map-canvas.tsx`. |
| No per-route `errorComponent` | **Confirmed** | All 17 route files lack `errorComponent`; only `main.tsx:18` root `ErrorBoundary` exists. |
| `CharacterCard` nests `<button>` inside `<Link>` | **Confirmed** | `character-card.tsx:42-85` — Link wraps Buttons; both buttons use `e.preventDefault(); e.stopPropagation()`. |
| Conditions have no obvious duration control / Frightened appears as permanent | **Audit was wrong / FIXED** | Live: after checking `frightened` for the Dire Wolf, a `spinbutton "Duration in rounds"` field appears next to the checkbox (placeholder `∞`). The audit's "no visible rounds input" claim does not reproduce. The weaker complaint — that empty defaults to permanent — is still true but the input is present and visible. |
| Resolved-encounter player view leaks DM-only metadata | **Unable to reproduce** | Player auditor's path required ending an encounter and switching personas; not exercised in this pass. Code unchanged based on subagent reads. |
| "It's your turn" has no player-facing signal | **Unable to reproduce live**; **Confirmed (code)** | No `encounter:turn-changed` socket event in `services/encounter-combat/turn-action.ts:29`; sheet socket subscription only covers `character:updated`. |
| Combat log renders empty after Round 1 Turn 1 | **Confirmed** | Live `Ambush at the Gate` encounter (Round 1 Turn 1, 4 participants) shows `No combat actions logged yet.` |
| Invite "Copy code" button copies the full URL; Join modal rejects URL paste | **Confirmed** | `invite-panel.tsx:36-37` clipboard payload is `${origin}/join/${code}`; button label says "Copy code" but copies full URL. `join-campaign-dialog.tsx` validates with `code: z.string().min(1)` — pasting the URL fails. |
| Wizard species validator allows Elf without subspecies | **Confirmed** | `wizard-state.ts:256` validator is `species: (s) => s.speciesId !== ""`; never checks `subspeciesId`. |
| Level-up ASI offers fighting-style feats to Cleric | **Unable to reproduce live** in this pass; subagents did not touch the feat-filter code. |
| `favicon.ico` 404 on cold load | **Confirmed** | Reproduced live. |

---

## 3. Backend findings

| Finding | Status | Evidence |
|---|---|---|
| #2 Login timing oracle | **Confirmed** | `auth.ts:131-140` returns early for missing user without running `verifyPassword`. |
| #3 Inventory DM auth asymmetry | **Confirmed** | `inventory.ts:113, 147, 173, 204` — `update` uses `assertCharacterOwnerOrAccess`, `create`/`list`/`delete` use `assertCharacterOwner`. DM can adjust attunement but not view, add, or remove items on a player's character. |
| #4 Homebrew `"campaign"` visibility behaves like `"public"` | **Confirmed** | `homebrew-campaign.ts:31` only blocks `private`; `campaign` visibility passes without author/caller validation. |
| #5 `campaign.assignCharacter` returns `FORBIDDEN`, not `NOT_FOUND` | **Confirmed** | `campaign.ts:227-231` violates the house pattern. |
| #6 `notification.markRead` two-query info-leak pattern | **Confirmed** | `notification.ts:56-72` does `findUnique` then a separate ownership branch. |
| #7 Rate limiter in-memory, per-instance | **Confirmed** | `rate-limit.ts:40-85` uses `new Map()`; no Redis. |
| Output-schema coverage on hot-path procedures | **Significantly improved** | Audit said 20 of 141 had `.output()`. Now 38 procedures, with a hardened test (`app-router.output-coverage.test.ts`) that detects nested `z.any()` violations. Driven by commits `df901b9`, `6246aca`, `d3476cf`, `e447d9b` between 2026-04-14 and 2026-04-15. |
| Other minor backend items (#1 invite race, #8 addParticipant atomicity, #9 dev rate-limit reset, #10 hidden-token count) | **No change** | Subagent saw no movement; status acceptable per original audit. |

---

## 4. Unable to reproduce / not exercised

These weren't refuted — they just weren't exercised in this pass and would need targeted live runs to confirm:

- DM-perspective items that require fresh state: invite flow end-to-end, monster-search-broken DM screenshot (`dm-14`), homebrew monster→encounter flow as a live walkthrough.
- Player-perspective wizard run from scratch (a fresh Cleric to see Starting Gold lying and inventory not persisting — only inferred from Aerion's seeded state).
- Live combat 403 reproduction (would require switching to player1, taking actions out of turn).
- "Resolved encounter player view leaks DM-only metadata" (player-side post-resolve state).
- Map zoom / fit-on-mount behavior beyond confirming initial scale = 100% (the audit's deeper "no fit-to-bounds" claim).

The seeded `Ambush at the Gate` encounter is mid-combat (Round 1, Turn 1) and is a valuable starting point for any of these — the seed data note in SUMMARY.md follow-ups #3 ("seed at least one active encounter") is already satisfied for the Shattered Keep campaign.

---

## 5. New issues observed during verification

### N1 — Player dashboard shows zero characters even when the player has a campaign-assigned character

Logged in as `player1@example.com` (Aragorn). `/dashboard` renders `No characters yet.` But on `/campaigns/cmnzo9m120004y7qvapwk25cd` the same user appears in the Party Roster as `Aragorn — Aerion Stormveil — Lv. 4 Cleric`, and the Members tab links to `/characters/cmnzp39qn0018y7qvev3pzths`.

The dashboard's `character.list` query likely returns only directly-`userId`-owned characters, not those reached via the `assignedCharacterId` campaign-member relationship. Net effect: a player whose character was created/owned by their DM cannot reach their own sheet from the dashboard — they have to click through the campaign roster every session. This is adjacent to the audit's "Dashboard is DM-hostile" theme but a distinct gap (mis-scoped query, not just heading copy).

### N2 — `ConnectionStatus` component is never mounted

Subagent finding: `connection-status.tsx` is defined but never appears in `app-header.tsx` or any parent. Users have no socket-health signal — disconnects during live combat will be invisible until the next mutation fails. Fits the SUMMARY's "Mutation feedback and the confidence signal gap" theme but is a separate, fixable hole.

### N3 — `hp-adjustment-dialog.tsx` reverts to raw palette

Subagent finding: `hp-adjustment-dialog.tsx:78` uses `bg-red-500` (raw palette) and `:73` uses `text-blue-400` for the temp-HP indicator — both should be the semantic tokens that `hp-adjuster.tsx` already adopts. This compounds the theme-token-drift honorable mention.

### N4 — Nine dialogs missing `DialogDescription`

Subagent enumerated the specific files (already noted in the audit's "9 flagged dialogs" but never enumerated). Worth recording for the implementation pass:

- `monster-detail-dialog.tsx:1-14`
- `note-editor.tsx:8-9`
- `npc-editor.tsx:8-9`
- `add-spell-dialog.tsx:10-13`
- `spell-detail-dialog.tsx:7-10`
- `add-item-dialog.tsx:6-11`
- `edit-item-dialog.tsx:6-11`
- `cast-spell-dialog.tsx:8-13`
- `magic-item-detail-dialog.tsx:8-12`

### N5 — Audit error in #6 (attack-dialog target default)

Not strictly a new issue, but documenting the discrepancy: the audit claimed the Target control "defaults to self." It does not — the attacker is filtered out of targets and the first non-self participant is selected. The Top-11 fix description should not include "set target default to last-selected / nearest enemy, never self" as the *current* state — it's already not self, though the audit's deeper point (smarter default) is still worth shipping.

---

## 6. Synthesis

- **All 11 top-priority issues remain in scope.** Two have moved partway to fixed (#9 has a generic toast; #10 added a Create-Campaign success toast). None are fully resolved.
- **The picture is consistent with the SUMMARY's diagnosis:** "data is sound; the client under-exploits it." The only meaningful code movement since the audit is server-side hardening (output schemas, deep-module refactors, concurrency stability), not the user-visible fixes the audit recommended. The Phase 1 plan in `PHASE_1_PLAN.md` is still accurate as a quick-wins backlog.
- **One audit claim does not reproduce** (Frightened/condition duration input — it does exist now, even if the empty-default-to-permanent complaint is still valid).
- **One audit claim is wrong** (attack dialog defaults target to self — it does not; first non-self is auto-selected).
- **Five new issues** worth folding into the Phase 1 / Phase 2 backlog before re-running a full audit:
  1. N1 — player dashboard misses assigned characters (likely a one-line `character.list` query change).
  2. N2 — `ConnectionStatus` defined but never mounted.
  3. N3 — `hp-adjustment-dialog.tsx` raw palette.
  4. N4 — concrete enumeration of the 9 dialogs missing `DialogDescription`.
  5. N5 — correct the audit's attack-dialog "defaults to self" detail.
- **Backend has materially improved on output-schema coverage** (20 → 38 procedures with `.output()`). This is the only category where the codebase is meaningfully ahead of the 2026-04-14 snapshot.
- **Recommendation:** the SUMMARY → ROADMAP → PHASE_1_PLAN sequence still applies almost verbatim. Tweak Phase 1 to (a) drop the "target defaults to self" sub-item from #6, (b) add the five N-items, (c) note that Create Campaign's toast is already done — only the navigate-into-new-campaign half remains. Everything else can ship as planned.
