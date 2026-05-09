# Phase 1 — Quick Wins Execution Plan

Date: 2026-04-15
Source: `ROADMAP.md` → Phase 1 (12 items, each ≤ 1 day).
Goal: bank user-visible trust improvements in ~1 sprint before committing to larger refactors.

Branch strategy: one feature branch per logical bundle below. Each bundle is an independent PR to keep review tight. Never push directly to `main`; conventional commits (`fix(client): …`, `feat(client): …`, etc.).

---

## Bundle A — Trust-breaking UX fixes (ship first)

Highest user-visible impact. These are what players and DMs are most likely to notice immediately.

### A1. Character sheet "Unknown" skeleton (1.1)
**Branch:** `fix/sheet-unknown-skeleton`
**Files:**
- `packages/client/src/hooks/use-srd-lookups.ts:20-21, 53-54` — expose existing `isLoading`.
- `packages/client/src/components/sheet/sheet-header.tsx:24` — gate on `srd.isLoading`.
- `packages/client/src/components/sheet/level-up-helpers.tsx:243` — same.
- `packages/client/src/components/sheet/level-up-dialog.tsx:250-310` — same.
**Steps:**
1. Write failing test: render `SheetHeader` with `srd.isLoading === true` → expect skeleton, not "Unknown".
2. Write failing test: `LevelUpDialog` title renders "—" (not "Unknown") when class name is missing.
3. Wrap `SheetHeader` + `LevelUpDialog` in a `SheetSkeleton` (reuse existing skeleton pattern) while `srd.isLoading`.
4. Replace every `"Unknown"` fallback with `—` in those two files.
5. Grep for other `"Unknown"` fallbacks in sheet subsystem; if any, fix or file a follow-up.
6. File a follow-up ticket for the underlying batched-tRPC 404-on-reload race (token-refresh race at Fastify adapter) — out of scope here.
**Done when:** hard-reload of the sheet never shows "Unknown"; `bun run lint:changed` / `typecheck` / `test:changed` pass.

### A2. Mobile hamburger nav (1.2)
**Branch:** `feat/mobile-nav`
**Files:**
- `packages/client/src/components/app-header.tsx:14-44`.
- Reuse `packages/client/src/components/ui/popover.tsx` + pattern from `components/notifications/notification-popover.tsx`.
**Steps:**
1. Write failing Playwright e2e: at viewport 375×812, menu button visible; clicking opens Popover with Campaigns / Homebrew / Magic Items / Settings / Logout; desktop ≥ 640px unchanged.
2. Add Menu icon button with `className="sm:hidden"`.
3. Wrap in Popover, `align="end"`, reusing notification popover styling for parity.
4. Include: Campaigns, Homebrew, Magic Items (→ `/compendium/magic-items`), Settings, Logout.
5. Verify keyboard nav (Tab / Escape) and focus ring.
**Done when:** e2e passes; manual check on iPhone 13 (375px) viewport in Chrome devtools.

### A3. Silent-mutation sweep (1.3)
**Branch:** `fix/mutation-feedback`
**Files:**
- `packages/client/src/components/campaign/campaign-settings-panel.tsx:41-48` — add `toast.success` on update.
- `packages/client/src/components/campaign/create-campaign-dialog.tsx:82-90` — caller must navigate; update both the dialog's `onSuccess` contract (return new campaign id) and the two callers (`pages/campaigns-page.tsx`, `pages/dashboard-page.tsx` if applicable) to `navigate({ to: "/campaigns/$id", params: { id } })`.
- `packages/client/src/components/campaign/encounter-detail-view.tsx:108-118, 120-130` — branch `attemptAttack` / `castCombatSpell` `onError` on `error.data.code`:
  - `UNAUTHORIZED` / `FORBIDDEN` → toast with server message, close dialog.
  - `BAD_REQUEST` (validation) → inline banner, keep dialog open.
  - default → generic toast, keep dialog open.
**Steps:**
1. Write failing tests per site (mock mutation error payloads for the combat branch).
2. Implement per site. No shared `useToast()` helper yet — defer to Phase 2 if pattern grows.
3. Verify `members-panel.tsx` and `encounter-map-link.tsx` (already correct per audit verification) are untouched.
**Done when:** settings save shows a success toast; creating a campaign routes into it; combat mutations never fail silently.

### A4. Invite copy / URL paste (1.4)
**Branch:** `fix/invite-copy-url-paste`
**Files:**
- `packages/client/src/components/campaign/invite-panel.tsx:36-46` — two sibling buttons "Copy code" / "Copy link" + `toast.success` per click.
- `packages/client/src/components/campaign/join-campaign-dialog.tsx:34-39, 81` — strip URL regex on submit.
- `packages/server/src/routers/invite.ts` — strip URL regex server-side (defense in depth).
**Regex:** `^(?:.*\/join\/)?([\w-]+)$` — extract the code even if a full URL is pasted.
**Steps:**
1. Write client test: pasting `https://app/join/ABC123` into the join dialog submits `ABC123`.
2. Write server test: `invite.join({ code: "https://.../join/ABC123" })` equals `invite.join({ code: "ABC123" })`.
3. Implement client strip + two copy buttons with distinct toasts.
4. Implement server strip.
**Done when:** both forms of the copy-paste onboarding loop succeed without user intervention.

---

## Bundle B — Copy & voice cleanup (low risk, high polish)

Ship together; it's all strings + one Zod helper.

### B1. Empty / error states + Zod messages (1.5)
**Branch:** `feat/copy-pass`
**Files:**
- `pages/dashboard-page.tsx:27`, `pages/campaigns-page.tsx:48`, `components/campaign/notes-panel.tsx:45`, `components/campaign/encounters-panel.tsx:82`, `components/campaign/maps-panel.tsx:56`, `components/sheet/inventory-panel.tsx:113` — 6 empty states.
- `components/campaign/invite-panel.tsx:126-129`, `components/campaign/encounter-detail-view.tsx:52-53`, plus 3 "Failed to …" mutation toasts — 5 error states.
- `packages/shared/src/schemas/campaign-inputs.ts:16`, `note-inputs.ts:20`, and all other `.min(1)` in shared — add `{ message: "This field is required" }`.
**Steps:**
1. Draft all 11 strings in one short doc (PR description). Dark-fantasy voice; concrete, not generic. Propose and the first reviewer picks.
2. Find all shared-schema `.min(1)` calls; add messages. Spot-check client forms that a blank submit now shows a user-phrased error.
3. No rewrite of the `error-messages` catalog — that's Phase 2.
**Done when:** no "Failed to load. Please try again." and no "Too small: expected string …" on blank submits.

### B2. Motion-safe skeleton (1.6)
**Branch:** `fix/motion-safe-pulse`
**Files:** `components/campaign/encounter-detail-view.tsx:40`, `components/campaign/invite-panel.tsx:123`, plus any additional sites.
**Steps:**
1. Grep `animate-pulse` across `packages/client/src`.
2. Replace with `motion-safe:animate-pulse` everywhere.
**Done when:** zero `animate-pulse` without `motion-safe:`; verified by a regex grep in CI (follow-up: add ESLint rule in Phase 3.6).

---

## Bundle C — Wizard + encounter polish

### C1. Wizard species subspecies validator (1.7)
**Branch:** `fix/wizard-subspecies-required`
**Files:**
- `packages/client/src/components/character-create/wizard-state.ts:255-268` (validator).
- `components/character-create/steps/species-step.tsx:171-227` (Next-button gating).
**Steps:**
1. Test: advancing from species step with Elf selected but no subspecies fails validation.
2. Change `STEP_VALIDATORS.species` to require `subspeciesId !== ""` when selected species has `subspecies.length > 0`.
3. Gate Next button UI when condition unmet.
4. Smoke test Elf / Dwarf (species with subspecies) + Human (species without) paths.

### C2. "Link character tokens" rename + 0-count message (1.8)
**Branch:** `fix/link-tokens-label`
**Files:** `components/campaign/encounter-map-link.tsx:40, 55`.
**Steps:**
1. Rename button label "Auto-link character tokens" → "Link character tokens".
2. Replace the 0-count toast with something empathetic: "No character tokens to link — all PCs are already placed."
**Done when:** label is non-ambiguous; 0-count path reads as neutral state, not failure.

---

## Bundle D — Dashboard IA (1.9)

### D1. Dashboard H1 + primary CTA + hide-for-DM
**Branch:** `feat/dashboard-persona`
**Files:** `pages/dashboard-page.tsx:109-162`.
**Steps:**
1. Fetch `campaign.list` (add the tRPC query).
2. Rename H1 "Character Vault" → "Your Tables" (placeholder; final wording by reviewer).
3. Swap Campaigns button to the primary variant; Characters becomes secondary.
4. Suppress the Characters section when `characters.length === 0 && campaigns.some(c => c.role === "dm")`.
5. Test both personas: fresh DM (zero PCs, some campaigns) → no Characters section; player (PCs, no DM campaigns) → current layout.

---

## Bundle E — Backend quick wins (parallel to frontend bundles)

All three are ≤ half-day and independent; single PR makes sense.

### E1. `campaign.assignCharacter` auth (1.10)
**Files:** `packages/server/src/routers/campaign.ts:215-288`.
**Steps:**
1. Replace the inline membership `findUnique` (lines 218-232) with `await assertCampaignMember(ctx.prisma, input.campaignId, ctx.user.id)`.
2. Delete the redundant character-exists check (unique constraint handles races).
3. Update / add tests: non-member caller gets `NOT_FOUND` (not `FORBIDDEN`); member succeeds.

### E2. `notification.markRead` atomic (1.11)
**Files:** `packages/server/src/routers/notification.ts:53-80`.
**Steps:**
1. Replace two-query pattern with:
   ```ts
   const result = await ctx.prisma.notification.updateMany({
     where: { id: input.id, userId: ctx.user.id },
     data: { read: true },
   });
   if (result.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
   return mapNotification(await ctx.prisma.notification.findUnique({ where: { id: input.id } }));
   ```
2. Test: other-user's notification ID returns `NOT_FOUND` (no info leak).

### E3. Login timing oracle (1.12)
**Files:** `packages/server/src/routers/auth.ts:125-150`; `services/auth-service.ts:21-23`.
**Steps:**
1. Pre-compute `DUMMY_HASH = await bcrypt.hash("placeholder", BCRYPT_ROUNDS)` at module load.
2. In the missing-user branch, `await verifyPassword(input.password, DUMMY_HASH)` before throwing `UNAUTHORIZED`.
3. Ensure the error message is identical to the wrong-password branch.
4. Test: timing difference between wrong-user and wrong-password is within a reasonable margin (flake-resistant threshold, e.g., < 50ms).

---

## Suggested sequencing (1 sprint)

Assumes one developer + optional review bandwidth. Bundle sizes are roughly half-day each.

| Day | Morning | Afternoon |
|-----|---------|-----------|
| 1 | A1 sheet skeleton | A2 mobile nav |
| 2 | A3 mutation-feedback sweep | A4 invite copy/paste |
| 3 | B1 copy pass (drafting + review) | B2 motion-safe + C1 wizard validator |
| 4 | C2 link-tokens rename | D1 dashboard persona |
| 5 | E1 + E2 + E3 backend bundle | Buffer / verification pass / PR feedback |

Parallelization: if two developers, backend bundle E runs concurrent with frontend bundles A–D.

---

## Exit criteria for Phase 1

Before moving to Phase 2:

1. All 12 PRs merged to `main`.
2. `bun run lint`, `bun run typecheck`, `bun run test` all clean across `shared` / `server` / `client` (run sequentially; there is no longer a `verify` wrapper).
3. Manual smoke check on both personas:
   - DM: hard-reload sheet (no "Unknown"); create campaign → lands on detail page; mobile nav reachable at 375px; settings save shows toast.
   - Player: wizard species→Elf requires subspecies; empty states read as "Musi" not "SaaS"; blank-form submit produces user-phrased errors.
4. Security: login timing fix verified with a timing-equivalence test.
5. Audit re-measure deferred: not worth a full re-run until Phase 2 lands homebrew UNION and destructive-action ergonomics. Tag the commit at end of Phase 1 for the next audit baseline.

---

## Risks & watch-outs

- **A3 Create-Campaign navigate**: changing the `onSuccess` contract may break other callers. Grep for `<CreateCampaignDialog` before changing the signature.
- **A4 URL strip regex**: double-check that legitimate codes don't contain slashes or URL-reserved characters. Current codes appear to be `[\w-]+` — confirm in `invite` schema before committing the regex.
- **D1 Dashboard persona**: the `role` field on `CampaignSummary` needs verification. If not present on the client type, extend the summary schema — but that crosses the "quick win" line. If so, simplify to "hide Characters when user has 0 characters" and revisit the DM-specific heuristic in Phase 2.
- **E3 Login timing**: `bcrypt.hash` at module load is synchronous on boot but blocks the event loop briefly. Acceptable for a one-time boot cost; if not, lazy-init on first login.
- **B1 Copy**: voice decisions are subjective. Draft in PR description, not code, so reviewers can redline strings without re-running the test suite.
