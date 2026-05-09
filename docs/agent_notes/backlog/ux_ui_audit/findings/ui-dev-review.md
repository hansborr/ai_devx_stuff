# UI dev audit — 2026-04-14

Reviewer: senior frontend engineer (React / TanStack Query / Tailwind v4 / shadcn/ui). This review is a static code audit of `packages/client/src/` against `docs/design-direction.md`. No runtime interaction.

## What went well

- **Design tokens are defined cleanly** in `packages/client/src/app.css` via Tailwind v4 `@theme`, matching the spec's charcoal/parchment/gold palette (`--color-background`, `--color-primary`, `--color-success`, `--color-warning`, `--color-destructive`, plus parchment variants).
- **Universal skip-link** at `packages/client/src/app.tsx:10-15` — `sr-only focus:not-sr-only` skip-to-main pattern is correctly implemented.
- **List/query trio is consistent** on `DashboardPage`, `CampaignsPage`, `HomebrewPage`, `CollectionDetailPage`: every page renders a skeleton during `isLoading`, an `ErrorState` card with a retry button during `isError`, an `EmptyState` with a contextual CTA, and a search-empty variant when a filter is active. This is a strong baseline most apps never reach.
- **shadcn primitives are set up correctly** in `packages/client/src/components/ui/`: Radix-based `dialog`, `popover`, `select`, `tabs`, `scroll-area`, and a cva-driven `button`. All variant colors resolve through CSS variables.
- **Auth forms (`login-page.tsx`, `register-page.tsx`)** use a shared `FormField` component with `aria-invalid`, `aria-describedby`, and `role="alert"` — solid accessibility for the primary entry point.
- **Token mutations emit toasts** via `react-hot-toast` consistently in `combat-map-panel.tsx:40,45,48` and similar handlers — users get feedback on every network action.
- **Connection status** (`common/connection-status.tsx`) correctly uses `bg-destructive` / `bg-warning` semantic tokens with `role="status"` and `aria-label`.
- **Focus-visible rings** are present on `Button`, `Input`, `Dialog` close, and the skip-link — keyboard users get consistent affordance.
- **Wizard stepper** (`character-create/wizard-stepper.tsx`) uses `aria-current="step"`, disables inaccessible steps, and collapses labels into numbers below `sm` — good mobile behavior.

## Top 5 UI concerns (prioritized)

### 1. `SheetBody` mounts the desktop **and** mobile layouts simultaneously (severe perf + correctness)

**Files:**
- `packages/client/src/components/sheet/sheet-body.tsx:88-95`
- `packages/client/src/components/sheet/desktop-sheet-layout.tsx:61` — `hidden gap-4 lg:grid`
- `packages/client/src/components/sheet/mobile-sheet-tabs.tsx:96` — always mounted, wrapped by `<div className="mt-4 lg:hidden">` in sheet-body

The character sheet renders both `<DesktopSheetLayout {...shared} />` and `<MobileSheetTabs {...shared} />` at every viewport. CSS (`hidden lg:grid`, `lg:hidden`) only hides one visually. The consequences:

- Every panel (`AbilityScores`, `CombatStats`, `HpAdjuster`, `DeathSavesInteractive`, `InventoryPanel`, `SpellsPanel`, etc.) **mounts twice**. Each has its own `useState`, `useMemo`, effect subscriptions, and in many cases its own tRPC subscriptions via child hooks.
- Duplicate DOM means **two `progressbar` elements for HP**, **two copies of `data-testid="hp-adjuster"`**, two inventory lists, etc. Anything that queries by testid or role will silently hit both.
- On a desktop resize below `lg`, hidden subscriptions don't tear down — the browser still evaluates effects. This compounds for a page that already has live socket listeners (`useCharacterSheetSocket`, `useCampaignPresence`).
- Mobile users also pay the cost of mounting the full desktop grid.

**Fix:** gate on viewport via `useMediaQuery` (or render both lazily and toggle with JS), or move desktop/mobile into conditionally rendered siblings. Alternatively, make the desktop layout's grid responsive (single column under `lg`) and drop MobileSheetTabs entirely. This is worth a dedicated PR.

---

### 2. Color-token discipline breaks down in domain components (23+ ad-hoc Tailwind palette classes)

Despite a comprehensive semantic token set (`--color-primary`, `--color-warning`, `--color-success`, `--color-destructive`), a large number of components hardcode Tailwind's default palette:

| File:line | Issue |
|---|---|
| `components/campaign/participant-stats.tsx:20-22` | HP bar uses `bg-green-500`/`bg-yellow-500`/`bg-red-500`. Compare to `sheet/hp-adjuster.tsx:28-32` which correctly uses `bg-success`/`bg-warning`/`bg-destructive`. Two HP bars, two palettes. |
| `components/campaign/participant-stats.tsx:33` | `text-blue-400` for temp HP — should match `hp-adjuster.tsx:48` (`text-primary`). |
| `components/compendium/magic-item-utils.ts:18-24` | Rarity colors use `zinc/green/blue/purple/amber/red` raw palette. Rarity is a first-class domain concept and should have named tokens (`--color-rarity-uncommon`, etc.) or at minimum be themed via semantic aliases. |
| `components/campaign/difficulty-styles.ts:4-7` | Encounter difficulty (`trivial/low/moderate/high`) uses raw `zinc/emerald/amber/red`. Same issue as rarity. |
| `components/campaign/attack-roll-dialog.tsx:84,86,121`, `spell-cast-result-display.tsx:15-17,28,45,55`, `end-encounter-dialog.tsx:64,69`, `note-card.tsx:12,45`, `roll-mode-toggle.tsx:27,34`, `combat-death-saves.tsx:88`, `campaign-overview.tsx:42`, `hp-adjustment-dialog.tsx:73,78` | Inline `bg-amber-500`, `bg-green-600`, `bg-red-500`, `text-amber-500`, etc. |
| `components/sheet/weapon-mastery-dialog.tsx:48,81,143`, `spell-row.tsx:49,97,100`, `concentration-indicator.tsx:18,21`, `cast-spell-dialog.tsx:53`, `equipment-summary.tsx:53,184`, `metamagic-selector.tsx:37`, `level-up-helpers.tsx:175`, `level-up-dialog.tsx:73` | Concentration indicators, mastery highlights, and metamagic selection all use `amber-*`/`purple-*` directly. |
| `components/sheet/spells-panel.tsx:74` | Prepared-count warning uses `text-amber-500` ad-hoc instead of `text-warning`. |
| `pages/settings-page.tsx:98,166` | Success messages use `text-green-600` — `--color-success` exists, use `text-success`. |
| `lib/roll-toast.ts:36-46` | Nat-20/Nat-1 toast styles hardcode `amber-400`, `red-500`, `text-white`, `text-amber-950` instead of semantic tokens. |
| `components/campaign/map-canvas.tsx:17-19` | Konva constants hardcode `#1a1a2e` and `rgba(255,255,255,0.12)` — should pull from CSS variables via `getComputedStyle(document.documentElement)` or a theme module. |

**Impact:** the stated "one theme" design direction silently breaks. If the user ever flips to a lighter or seasonal theme, HP bars, rarity badges, and half the combat UI will not follow. It also encourages copy-paste: new contributors see the pattern and reproduce it.

**Fix:** (a) add `--color-hp-healthy`, `--color-hp-bloodied`, `--color-hp-critical`, `--color-rarity-*`, `--color-difficulty-*` tokens to `app.css`; (b) add an ESLint rule (`no-restricted-syntax` on className regex) that fails PR on `bg-red-\d+`, `text-amber-\d+`, etc. (same pattern as the existing `RawTxClient` restriction). This mechanically prevents regression.

---

### 3. No `AlertDialog` / destructive confirmations use plain `Dialog` without `role="alertdialog"`

**Files:**
- `components/delete-character-dialog.tsx`
- `components/campaign/delete-confirm-dialog.tsx`
- `components/campaign/end-encounter-dialog.tsx`
- `components/campaign/edit-token-dialog.tsx` (delete button)
- `components/homebrew/delete-collection-dialog.tsx`
- `components/homebrew/delete-entry-dialog.tsx`
- `components/sheet/*` delete variants
- `pages/settings-page.tsx:188-216` DeleteAccountDialog

All destructive confirmations use the standard shadcn `Dialog` component. The shadcn library ships a separate `AlertDialog` (`@radix-ui/react-alert-dialog`) which sets `role="alertdialog"`, traps focus more strictly, and disables outside-click dismissal — the correct primitive for "are you sure" flows. Using plain `Dialog` means:

- Screen readers announce these as generic dialogs, not as confirmations.
- A misplaced outside click or Escape during a mid-typed confirm name (e.g. `delete-collection-dialog.tsx` requires retyping the collection name) silently dismisses and clears the input.
- There's also **significant duplication**: three nearly identical "are you sure?" dialogs exist (`delete-character-dialog.tsx`, `campaign/delete-confirm-dialog.tsx`, and ad-hoc inline versions). One generic `ConfirmDialog` / `AlertDialog` component would replace all of them.

**Fix:** add `components/ui/alert-dialog.tsx` from shadcn, then replace the three generic confirm dialogs with a single shared `ConfirmDialog` and migrate type-to-confirm dialogs to use `AlertDialog`-based primitives.

---

### 4. No per-route error boundary — any render error crashes the whole app to the root fallback

**Files:**
- `packages/client/src/main.tsx:17-23` — single `<ErrorBoundary>` wraps `RouterProvider` at the root.
- `packages/client/src/routes/*-route.ts` — none set `errorComponent` on their `createRoute(...)` config.
- `packages/client/src/app.tsx` — no boundary around `<Outlet />`.

If `CampaignDetailPage` throws (bad data shape, socket race setting state, an exception in a derived value), the entire app unmounts and the user sees `"Something went wrong" / "Try again"` from `error-boundary.tsx:52-68`. The header, nav, and route context are all gone. The retry button resets the boundary state but doesn't reload the router — a subsequent render of the same broken tree will throw again immediately.

Observed hot spots that could throw:
- `campaign-detail-page.tsx:135-138` — `characterId` narrowing assumes a specific member shape.
- Sheet socket handlers in `hooks/character-sheet/use-character-sheet-socket.ts` dispatch cache updates that can fail under stale shapes.
- The cast-at-tRPC-boundary pattern (`as CampaignDetail | undefined`, `as HomebrewCollectionWithAuthor[] | undefined`, etc.) in five pages bypasses runtime validation — a server schema drift crashes the renderer.

**Fix:** set `errorComponent` on each route (TanStack Router supports this out of the box), render a contextual fallback (keeps AppHeader/nav intact, offers "reload this page" vs "back to dashboard"). Also wrap the `<Outlet />` in `app.tsx` with a nested boundary so the header survives.

---

### 5. Character card nests interactive elements inside a Link (invalid HTML + a11y violation)

**File:** `packages/client/src/components/character-card.tsx:42-85`

```
<Link to="/characters/$characterId" ...>
  <Card>
    ...
    <Button onClick={handleToggleVisibility} aria-label="...">...</Button>
    <Button onClick={handleDelete} aria-label="...">...</Button>
    ...
```

Nesting `<button>`s inside an `<a>` is invalid HTML. Browsers render it, but: (a) screen readers announce the outer link's name plus the inner button's name, which is confusing; (b) keyboard `Tab` order differs across browsers; (c) the mouse handlers depend on `e.preventDefault(); e.stopPropagation()` (lines 30-32, 36-38) to avoid triggering the link, which is fragile — any future refactor that forgets to call both will silently navigate after delete.

**Fix:** use a card container that is not a Link, then wrap only the title/body in a Link (with no interactive descendants), and position the action buttons outside that inner link. Same pattern applies to `CampaignCard` if it follows this shape (worth spot-checking — not reviewed in detail).

---

## Areas for improvement

- **`AppHeader` has no mobile nav.** `packages/client/src/components/app-header.tsx:19-26` hides the Campaigns and Homebrew links below `sm` (`<nav className="hidden items-center gap-4 sm:flex">`) and provides no hamburger or drawer. Below 640px, authenticated users can only reach those pages by typing the URL. Add a `DropdownMenu` trigger for mobile, or move nav into a persistent bottom bar for touch.
- **Both `connection-status` and `AppHeader` could coexist**, but `ConnectionStatus` is currently not rendered anywhere (grep showed only the component definition, no instantiation). If it's unmounted, users have no socket-health signal — re-add it to AppHeader or a global overlay.
- **`Input` does not style `aria-invalid`.** `components/ui/input.tsx:11` applies the same border regardless of `aria-invalid`. `FormField` sets the attribute but there's no `aria-[invalid=true]:border-destructive` selector. Add one token-driven invalid-state style.
- **`LoadingSpinner` is minimal** (`common/loading-spinner.tsx`) — just `Loader2` with a className. Several pages roll their own spinner or skeleton inline (e.g. `combat-map-panel.tsx:236` uses a raw `animate-pulse rounded-lg bg-surface`). Consider a small `Skeleton` primitive (just `<div className="animate-pulse rounded bg-surface" ...>`) to reduce the seven copies of that div across pages.
- **Global Toaster config is defaults only.** `common/toast-provider.tsx:9` just renders `<Toaster position="top-right" />`. The dark-fantasy theme is not applied to the default success/error toasts; `react-hot-toast` will render on a white-ish background on dark mode until you pass `toastOptions={{ style: { background: '...', color: '...' } }}`. Compare to the custom `RollToast` (`lib/roll-toast.ts`) which is themed.
- **`Tabs` trigger bar overflows horizontally without gradient/indicator.** `campaign-detail-page.tsx:77` and `mobile-sheet-tabs.tsx:97` both use `overflow-x-auto` on `TabsList`. On mobile this scrolls but there's no fade or chevron affordance indicating scrollability. Users may not know there's more.
- **`spells-panel.tsx:74` prepared-count warning is color-only.** `text-amber-500` vs `text-muted-foreground` differs by hue and brightness, but color-blind users won't see the "approaching limit" state. Add a tooltip or icon.
- **Konva canvas has no `react-konva` layer caching or token virtualization.** `map-canvas.tsx` re-evaluates grid-line memos on every cellSizePx / width change but draws every cell every frame. For the target of ~100×100 maps this is fine; for anything larger (some DMs ship 200×200) the grid alone is 400+ `<Line>` nodes per layer. Add `<Layer>.cache()` on static layers or decompose the grid into a single backing image.
- **Seven pages `as`-cast tRPC results** (`campaigns-page.tsx:80`, `campaign-detail-page.tsx:222`, `homebrew-page.tsx:128`, `collection-detail-page.tsx:123,126`, `dashboard-page.tsx:121`). The comment explains it's a date-string boundary workaround, but it also silently accepts shape drift. At minimum, consolidate this into a single `asServerResult<T>(data)` helper so the boundary is discoverable.

## Suggestions (actionable technical-debt items)

1. **Introduce a `Skeleton` primitive.** Replace the ~7 inline `animate-pulse rounded bg-surface` divs with `<Skeleton className="h-20" />`.
2. **Add `components/ui/alert-dialog.tsx`** (Radix AlertDialog) and a `<ConfirmDialog title description confirmLabel onConfirm />` wrapper. Replace delete-character, delete-confirm, delete-collection (destructive non-typed variants), and the generic "are you sure?" patterns.
3. **Codify theme discipline with a lint rule.** Add a custom ESLint rule (or `no-restricted-syntax` regex) banning `bg-(red|green|blue|yellow|amber|zinc|...)-\d+` and `text-(red|green|...)-\d+` in `.tsx`. Land it *after* the audit fixes in (2) above.
4. **Extract the sheet dual-mount into a `useIsDesktop()` hook.** Render one subtree at a time; tests update (there's at least one test that looks at the desktop layout while running at jsdom default width — verify).
5. **Set TanStack Router `errorComponent` on each route.** Keep the top-level `ErrorBoundary` for truly unrecoverable crashes; route-level boundaries keep header + nav during page errors.
6. **Theme the global Toaster** via `toastOptions` in `common/toast-provider.tsx` to match the parchment/charcoal palette.
7. **Extract Konva colors** from CSS variables once at mount and pass into `map-canvas.tsx` via props or a `MapTheme` context — so switching themes recolors the map too.
8. **Add `aria-invalid` styling** to `components/ui/input.tsx`: `aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive`.
9. **`CharacterCard` (and any sibling card patterns) should not nest buttons in links.** Move action buttons to an overlay `<div>` positioned absolutely, with the card itself being a link wrapper around the non-interactive content only.
10. **Reconsider the `text-testid`-level HP bar duplication** — one `HpBar` primitive shared between `participant-stats.tsx` and `hp-adjuster.tsx` with the same color tokens would eliminate both the token drift (finding 2) and the DOM duplication.

## Open questions for the backend dev

- **`getCharacterPool` / dashboard queries** — the dashboard fetches `character.list`, `srd.listClasses`, and `srd.listSpecies` as three separate queries (`dashboard-page.tsx:112-114`). Could `character.list` denormalize class/species names on the server so the dashboard is a single round trip? The client's `classMap`/`speciesMap` join logic would disappear along with two over-the-wire payloads.
- **tRPC error shape for the sheet.** `character-sheet-page.tsx:358-362` pattern-matches on `error.message === "Character not found"` to choose between two copies. A stable error code on the server side (e.g. tRPC `NOT_FOUND` already translated) would avoid string matching.
- **Socket reconnect UX.** Is there a server-side "you are reconnecting" signal that the client could consume, beyond the existing disconnect/reconnect events? The `ConnectionStatus` component exists but isn't mounted anywhere — clarifying the source of truth would unblock re-adding it.

---

## Cross-checks against backend dev findings (2026-04-15)

- **Backend D1 (monster search flicker):** confirmed in `components/campaign/monster-tab.tsx:172-207`. `MonsterResultList` only renders the skeleton while `isLoading` (first-ever load). On subsequent filter/search changes the component resets `accumulated` to `[]` (line 257) while `isLoading=false` and `isFetching=true`, so `results.length === 0` hits the empty state (lines 190-192) for one render cycle before the new page resolves. Fix: change `if (isLoading)` to `if (isLoading || isFetching)` on line 182, OR keep stale results visible by not clearing `accumulated` until `isFetching` flips back to false. Separately, the in-render `prevFilterKey.current` + `setState` pattern on lines 253-258 is a React anti-pattern (state update during render, not in an effect) and should move into a `useEffect` reacting to `filterKey`.
- **Backend D3 (404/500 collapse):** confirmed at `pages/campaign-detail-page.tsx:237-244`. All errors render the same "Failed to load campaign. Please try again." message. tRPC's `TRPCClientError` exposes `.data.code` — branch on it:
  - `NOT_FOUND` → "Campaign not found" + back link (the `isSuccess && !campaign` branch on line 248 is **dead code** today because tRPC throws rather than returning null; repurpose that markup for the 404 branch).
  - `UNAUTHORIZED` / `FORBIDDEN` → navigate to login or "You don't have access" copy.
  - Default → existing retry UI.
  Extract into `lib/trpc-error-classifier.ts` since the same decision tree repeats in `character-sheet-page.tsx:357-363`, `join-page.tsx:26-30` (already uses `mapJoinError`), and `collection-detail-page.tsx`. This also resolves my finding #4 Open Questions item about tRPC error codes.
- **Backend D4 (Copy code label):** already covered under DM #1 below. Backend's triage confirms server side is correct; only the client label/handler mismatch is the issue.

---

## Cross-checks against DM auditor findings (2026-04-15)

- **DM #1 (Copy code copies URL):** confirmed at `components/campaign/invite-panel.tsx:36-46`. `handleCopy` builds `${window.location.origin}/join/${invite.code}` but the button's aria-label and glyph both say "Copy code" (line 65). Either rename to "Copy link" or split into two actions. The `JoinCampaignDialog` expects a bare 8-char code, so users who paste the copied value into Join will fail — land mine confirmed.
- **DM #2 (no save-toast on Campaign Settings):** confirmed at `components/campaign/campaign-settings-panel.tsx:41-48`. `onSuccess` invalidates caches but calls no `toast.success(...)` — unlike sibling `create-campaign-dialog.tsx:85` which does. No `role="status"` aria-live on success either.
- **DM #3 (Zod error leaks to user):** the passthrough is `lib/format-field-errors.ts:11` — it copies Zod's raw `issue.message`. Zod v4's default "Too small: expected string to have >=1 characters" leaks because the schema in `@musi/shared` hasn't overridden `.min(1, { message: "..." })`. Fix in the shared schema, not the client. Optionally, `formatFieldErrors` could fall back to a per-code lookup (`too_small` → "This field is required").
- **DM #4 (mobile nav disappears):** already in this review under "Areas for improvement" — `app-header.tsx:19-26` hides `Campaigns`/`Homebrew` under `sm`. No hamburger.
- **DM #5 (frightened "permanent" with no duration):** partial. `components/campaign/condition-toggle-popover.tsx:68-115` has a `DurationInput` with an `∞` placeholder. But new conditions default to `durationRounds: null` (line 130) = "permanent", and the `∞` placeholder isn't an obvious "click here to set duration" affordance. Fix: make duration sensible-default to a number (e.g. 10 rounds) OR add an explicit "Permanent" toggle and a visible rounds input when toggled off.
- **DM #6 (monster entry card parity):** confirmed. `components/homebrew/entry-card.tsx:27-29` reads `entry.data.description` generically. Monster forms likely store descriptive text under a different key (stat block summary, `lore`, `summary`) so `getDescription` returns empty. Either standardize the field name across forms or add a per-type description extractor (`data.description ?? data.summary ?? data.lore`).
- **DM #7 (missing DialogDescription):** accurate in direction, slightly off on the specific dialogs. `create-campaign-dialog.tsx:119` and `hp-adjustment-dialog.tsx:68-75` DO have descriptions (though hp's is nested inside a `<div>` in `HpStatusBar` — Radix also warns about non-direct-child descriptions). The dialogs still missing `DialogDescription` (Radix throws a console warning for each):
  - `components/campaign/monster-detail-dialog.tsx`
  - `components/campaign/note-editor.tsx`
  - `components/campaign/npc-editor.tsx` (DM's "New NPC")
  - `components/compendium/magic-item-detail-dialog.tsx`
  - `components/sheet/add-item-dialog.tsx`
  - `components/sheet/add-spell-dialog.tsx`
  - `components/sheet/cast-spell-dialog.tsx`
  - `components/sheet/edit-item-dialog.tsx`
  - `components/sheet/spell-detail-dialog.tsx`
- **DM #8 (no redirect after campaign create):** confirmed. `create-campaign-dialog.tsx:82-90` does `toast.success` + `onOpenChange(false)` but doesn't navigate. The mutation `data` has the new `id`; add `void navigate({ to: "/campaigns/$campaignId", params: { campaignId: data.id } })` in `onSuccess`.
- **DM #9 (revoke invite no confirmation):** confirmed at `invite-panel.tsx:69-77`. Trash icon fires mutation directly on click. Reuse the `ConfirmDialog` proposed in my finding #3, or at minimum guard behind a small two-step click.

## Cross-checks against DM auditor pass 2 — Maps + combat/map (2026-04-15)

- **DM-Maps #1 (token drag pans Stage):** confirmed architecture issue. `components/campaign/map-canvas.tsx:141` has Stage `draggable={!input.isToolCapturing && !input.isInteractiveTool}`, while `token-shape.tsx:127` sets the token Group `draggable={draggable}`. In select mode, neither flag is set, so **both are draggable simultaneously**. Konva's event model lets tokens receive the event but the Stage also claims the drag, producing the pan-instead-of-move behavior. Fix: either (a) gate Stage panning on middle-mouse / space-drag / empty-background press (check `e.target === e.target.getStage()` on mousedown before enabling drag), or (b) set `draggable={false}` on Stage whenever pointer-down hits a draggable token. Option (a) is the standard VTT pattern.
- **DM-Maps #2 (default zoom doesn't fit):** confirmed. `combat-map-panel.tsx:218` calls `resetView()` on mapId change, but `resetView` likely sets `stageScale: 1` and `stagePosition: {0,0}` (constant in `map-canvas-store.ts`). Needs to become `fitToScreen(mapWidthPx, mapHeightPx, containerWidth, containerHeight)` that calculates the scale factor to fit with padding. Also need to call after the container `ResizeObserver` reports its first real size — the initial `DEFAULT_CONTAINER = {600, 400}` (`combat-map-panel.tsx:19`) means the first fit runs against stale dimensions.
- **DM-Maps #3 (place-token no-op in combat):** confirmed structurally. `tool-handlers.ts:238-246` defines `createPlaceTokenHandler` which sets `pendingTokenCell` in the store. The consumer is **only** `map-detail-view.tsx:253-255`, not `combat-map-panel.tsx`. The standalone map view opens an AddTokenDialog when `pendingTokenCell` is set; the combat view never reads that state. Fix: add the same `useEffect(() => { if (pendingTokenCell) { openAddParticipantDialog(pendingTokenCell); } }, [pendingTokenCell])` wiring to `combat-map-panel.tsx`, OR change place-token semantics in combat mode to open the participant-picker immediately (as DM suggests).
- **DM-Maps #4 (auto-link no feedback):** need to locate the auto-link handler to confirm. Likely in `combat-map-panel.tsx` or an action in `useTokenMutations`. If the mutation `onSuccess` lacks `toast.success(...)`, add one with the count of tokens linked. The "doesn't spawn monster tokens" part is probably by-design (character-only) and should be made explicit in copy or extended to a two-button flow ("Link existing tokens" + "Spawn monster tokens").
- **DM-Maps #5 (Attack/Cast Spell dialogs):** not reviewed statically in depth, but agree on direction. The attack dialog currently takes manual inputs; for character attackers, the dropdown should come from `character.equipment` filtered to weapons (with mastery/attack/damage derived via existing shared rules helpers). For monster attackers, `monster.actions[]` already has structured attack data per SRD. This is a substantial feature, not a tweak — suggest a separate PR. Also matches my finding #2 note that attack/damage text in `attack-roll-dialog.tsx:121` uses `text-red-400` (raw palette).
- **DM-Maps #6 (fog reset window.confirm + no DM shroud):** confirmed at `components/campaign/map-toolbar.tsx:72` (`window.confirm("Reset fog?...")`) and line 144 (`window.confirm("Clear all drawings?")`). Swap to the `ConfirmDialog` primitive from finding #3 — also fixes the DM #9 pattern. On the no-DM-shroud concern: `fog-overlay.tsx` likely renders nothing for the DM (`isDm ? null : <darkOverlay />`). Best UX: render a hatched/tinted overlay for DM view (50% opacity + diagonal stripe pattern via SVG fill) so the DM can see "this is hidden from players" without obscuring the map.
- **DM-Maps #7 (background image URL failure silent):** confirmed at `hooks/use-background-image.ts:27-32,55-57`. Two-phase load (with CORS, then without) both terminate in `setImage(null)` with no error propagation. Hook needs to return `{ image, error }` so callers can toast on load failure. Straightforward to refactor, 3-line signature change.
- **DM-Maps #8 (Edit Map missing grid controls):** confirmed at `components/campaign/edit-map-dialog.tsx:110-120`. Only `name` and `MapImageField`. Schema almost certainly supports `width`, `height`, `gridSize`, `gridType` (create-map-dialog.tsx probably has these). Extend the dialog — but warn users that changing `gridSize` or grid type will invalidate existing tokens' snap alignment.
- **DM-Maps #9 (token label truncates):** UX/data issue. `token-shape.tsx:84-87` renders label with `ellipsis wrap="none"`. Options: (a) add a `shortLabel` field to MapToken and auto-derive initials on token creation (`"Bugbear Warrior"` → `"BW"` or `"Bug"`); (b) render tooltip on hover with full label via Konva's pointer events + a DOM overlay; (c) scale font for multi-cell tokens (already partially done on line 86 — `Math.min(TOKEN_LABEL_FONT_SIZE, w / 4)`). (a) is the cleanest.
- **DM-Maps #10 (icon-only toolbar, no tooltips):** confirmed at `map-toolbar.tsx`. Every button uses HTML `title="..."` attribute (lines 55, 63, 67, 91, 100, 108, 164, 178, 199, 204) — `title` has long hover delay, doesn't render on touch, and isn't themeable. Wrap each in Radix `Tooltip` (shadcn already uses Radix). This is the same pattern as `components/ui/dialog.tsx` — add `components/ui/tooltip.tsx` from shadcn CLI and retrofit the toolbar.
- **DM-Maps #11 (no drawing undo):** confirmed. `use-drawing-actions.ts` handles add/remove by id but no undo stack. Low priority — would need a client-side transient history plus server awareness, since other participants see broadcasts. Punt to a separate `feat(client): drawing undo` PR.

### New items surfaced while verifying pass 2

- **`window.confirm` also used in `map-toolbar.tsx:144` ("Clear all drawings?")** — same issue as fog reset, same fix.
- **`edit-map-dialog.tsx` has `DialogDescription` but it says "Update map settings."** — redundant with the title. If the dialog is extended to include grid settings, the description becomes useful; otherwise consider `aria-describedby={undefined}` on DialogContent.
- **Attack dialog hardcodes `mode: "custom"`** at `attack-roll-dialog.tsx:26`. Server schema is a discriminated union `"character" | "custom"`, so the client is shipping only half the feature.
- **Encounter cards don't visually differentiate active vs resolved** (flagged by dm-auditor during handoff). `components/campaign/encounter-card.tsx:30-33` applies the same `rounded-lg border p-4` wrapper regardless of `encounter.state`. Only differentiators are the Badge variant and icon (lines 14-19, 61). Resolved encounters visually compete with live ones. **Recommended fix (agreed with dm-auditor):** do *both* — (a) dim resolved cards (`opacity-60` + `text-muted-foreground` on the title row, reduced border saturation) and (b) auto-fold resolved encounters into a collapsible "Past encounters (n)" section below the active list, defaulted collapsed when `resolvedCount > 2`. Paused stays `variant="outline"` (reads as resumable). Resolved badge gets a `text-muted-foreground` override so it visually reads as terminal, not another clickable one. DM observed 3 resolved + 1 active after a single audit session — this grows linearly and needs containment early.
- **Badge alignment across list-row cards is inconsistent** (dm-auditor observation during final pass, defer-tier). Members tab renders `<Badge>` leading (next to the name); encounter cards render state badges trailing (next to the kebab menu). Not a bug, just degrades scanability. Small fix: flex-order tweak in `encounter-card.tsx` to move the state badge to the leading edge. Belongs in the same PR as the resolved-dim change since both touch the encounter card layout.

## Cross-checks against backend dev pass 2 — Maps + combat (2026-04-15)

- **Backend D6 (place token on new participant):** pure client affordance. Either (a) on Add Participant dialog success, open AddTokenDialog pre-filled with `name` + `encounterParticipantId`, or (b) activate the existing place-token tool with the new participant id threaded through. Pairs with DM-Maps #3 wiring gap in combat view.
- **Backend D7 (auto-link label + feedback):** toast **does** fire at `encounter-map-link.tsx:40` with the linked count. What's actually confusing: (a) button is an icon-only `Wand2` with only HTML `title="Auto-link character tokens"` (line 57) — same Tooltip issue as DM-Maps #10; (b) `data.linked === 0` produces "Auto-linked 0 tokens" which reads like failure. Fix combo: rename label "Link character tokens", wrap in Radix Tooltip, and branch the toast on zero-count ("All character tokens already linked" or "No matching tokens on this map"). Agree option (1) for now; if auto-populate ships, relabel to "Link + create missing".
- **Backend D8 (Edit Map grid controls):** already in DM-Maps #8 above. Backend confirmation that schema + `map.update` support all four fields (width, height, gridSize, gridType) removes the last blocker. Client change only.
- **Backend D9 (fog single-shroud vs per-user):** product call, not engineering. For "DM can see hidden cells" — pure CSS: render fog overlay for DM with `opacity={isDm ? 0.35 : 1}` + diagonal-stripe SVG pattern. No schema change. Per-user masks would require server-side per-user fog state; scope-creep, not now.
- **Backend D10 (attack dialog):** confirmed — `attack-roll-dialog.tsx:26` pins `mode: "custom"`, client dropped the character-mode path entirely. Fix plan: add a `mode` toggle. For character attackers default to "character" mode with a weapon dropdown from `character.inventory` filtered to `itemType === "weapon"`. For monster attackers populate an action dropdown from `monster.actions` JSON. Keep "Custom" as escape hatch. Medium PR on its own.
- **Backend D11 (token↔participant FK):** already consumed — `combat-map-panel.tsx:105` reads `token.encounterParticipantId` for selection sync. Good to confirm DB unique constraint; client assumes single token per participant.

---

## Notes for other reviewers

- UX expert: findings 1, 2, and 5 overlap with UX concerns (confusing HP bar palette across two surfaces, mobile nav absence, destructive action ergonomics). Please cross-reference.
- DM/player auditors: if you observed broken layouts at ~768px on the character sheet — that's finding 1 (dual-mount + no tablet-specific layout). Tablet (768–1023) today renders the mobile tab layout because `lg:` starts at 1024.
- Backend dev: finding 4 (route error boundaries) bites hardest when the server returns a subtly different shape (date string vs Date, missing optional). The `as`-casts make these crashes look like "UI is broken" rather than "API changed" — a server-side contract test on the client's consumed shapes would catch it earlier.
