# 3b. Centralize the recurring side-effect hooks (`query-invalidation`, `realtime-invalidation`, `use-*` action hooks) → move bucket-B consumer files to the fast lane

Status: Done — landed via merge 700cf17b (commits 80155580, b1219db6, 50a134bd, aa07a6a8, 8972c9ca). default-real model shipped (mock-default-real.ts importActual passthrough); bucket-B consumers moved to fast lane.
Lens: speed · Area: client / test-infra · Severity: low-med · Size: M–L (6 of 7 module groups need the default-real model, not a simple global fake) · Confidence: med
Theme: client-isolation-step3 · Source: client-test-isolation split-runner follow-up 2026-06-15

## Problem

A second cluster of isolated files (call it **bucket B**) mocks bespoke, non-central **hooks and small libs** to isolate a unit from its side effects — cache invalidation, realtime invalidation, dice/roll hooks, mutation hooks, JSON download, etc. Most of these are the same shape as the modules already centralized in setup.ts: a hook whose mock is *behavioral* (returns data, exposes a spy), not structural. Centralizing them moves their **consumer** test files to the fast lane.

**Governing rule (corrected after the 2026-06-15 codex review): default-real unless the module is proven pure infra.** The original draft of this item listed eight module groups as "clean to centralize (no real-test found)." That was wrong — **only `@/lib/query-invalidation.js` actually has no real-test.** The other seven all have a real-test, and **most of those real-tests are currently in the fast lane** (no registry mutation). So the choice of central-mock model is NOT cosmetic:

- **No real-test (pure infra) → simple default-*fake* holder** (mechanism **(i)**, the `mock-use-auth.ts` shape). Consumers and the (nonexistent) real-test all tolerate the fake. **Only `query-invalidation` qualifies.**
- **Has a real-test → default-*real* passthrough + opt-in override** (mechanism **(ii)**, the 3c shape: `vi.importActual` default behind a holder, consumers call `setMockX()` in `beforeEach`). This frees the consumers **and** keeps the real-test on the real implementation with no `vi.unmock`.

The trap a simple global fake walks into here: for a module whose real-test is **currently in the fast lane**, registering a default-fake central mock would force that real-test to add a `vi.unmock` — **demoting a currently-fast file to the isolated lane**. That is a net regression (you free ~2–3 consumers but push an equal-or-greater number of real-tests the other way) and it *adds* to the `vi.unmock` floor 3c is trying to remove. Hence: for any bucket-B module with a real-test, use the default-real opt-in model from the start — which is really applying the 3c mechanism per-module. 3b's measurable lane win is the consumer files; the default-real model means the real-tests are not harmed (and may even be freed early).

## Evidence

Bucket B (21 mock-only isolated files). Grouped by what they mock **and by the real-test reality verified 2026-06-15** (re-derive with `bun scripts/client-test-isolation-classifier.ts --json`):

- **(1) Genuinely pure infra — no real-test → simple default-fake holder OK:**
  - `@/lib/query-invalidation.js` ×3 — `combat/combat-map-mutations.test.tsx`, `maps/map-detail-mutations.test.tsx`, `hooks/use-map-layer-mutations.test.tsx`. (Verified: no `query-invalidation.test.*` exists.) **This is the only clean-global-fake module in bucket B.**
- **(2) Has a real-test that is CURRENTLY IN THE FAST LANE → MUST use default-real opt-in (a global fake would demote the real-test):**
  - `@/hooks/realtime-invalidation` ×3 consumers (`combat/combat-map-panel.test.tsx`, `maps/map-detail-view.test.tsx`, `pages/campaign-detail-page.test.tsx`) — single barrel `hooks/realtime-invalidation.ts`, real-tested by **5 fast-lane files** (`realtime-invalidation-{campaign,character-sheet,encounter,map}.test.ts`, `realtime-invalidation-turn-pointer.test.tsx`) that import the real `useCampaignSocket`/etc. with no mock.
  - `../lib/token-store.js` (consumer `hooks/use-map-image-upload.test.ts`) — real-test `lib/token-store.test.ts` (fast lane, imports real `getAccessToken`/`setAccessToken`). *Codex missed this one; verified here.*
  - `../../../lib/download-json.js` (consumer `homebrew/collections/collection-card.test.tsx`) — real-test `lib/download-json.test.ts` (fast lane, imports real `downloadJson`/`slugifyForDownload`). *Codex missed this one; verified here.*
  - `use-campaign-presence`, `use-srd-lookups`, `use-notifications` (consumers `campaign-detail-page`, `character-sheet-page`, `app-header`/`notification-popover`) — each has a fast-lane real-test (`hooks/use-campaign-presence.test.ts`, `hooks/use-srd-lookups.test.ts`, `hooks/use-notifications.test.ts`).
- **(3) Has a real-test that ALREADY self-unmocks (already isolated; consumers freed by 3b, the real-test waits for 3c inversion):**
  - `@/components/campaign/tokens/map-token-mutations.js` ×2 consumers (`combat/combat-map-mutations.test.tsx`, `maps/map-detail-mutations.test.tsx`) — real-test `tokens/map-token-mutations.test.tsx` **already self-unmocks** (`vi.unmock("@/components/campaign/tokens/map-token-mutations.js")`), so it is a member of the 3c child-component web, **not** a clean candidate. (It is also listed in 3c — that double-listing is now resolved: it lives in 3c.)
  - `@/hooks/use-ability-roll.js` ×2 consumers (`vtt/drawer/tabs/stats-tab.test.tsx`, `vtt/drawer/monster-stat-block-drawer.test.tsx`) — real-test `hooks/use-ability-roll.test.ts` (self-unmocks)
  - `@/hooks/vtt-drawer/use-monster-hp-update.js` ×2 consumers — real-test `use-monster-hp-update.test.ts` (self-unmocks)
  - `@/hooks/vtt-drawer/use-weapon-attack.js` consumer `actions-tab.test.tsx` — real-test `use-weapon-attack.test.ts` (self-unmocks)
  - `@/hooks/vtt-drawer/use-feature-use.js` consumer `features-tab.test.tsx` — real-test `use-feature-use.test.ts` (self-unmocks)
  - `@/hooks/character-sheet/use-inventory.js` consumer `inventory-tab.test.tsx` — real-test `use-inventory.test.ts` (self-unmocks)
  - `@/hooks/use-background-image.js` consumer `maps/map-background-image.test.tsx` — real-test `use-background-image.test.ts` (self-unmocks)
- **NOT 3b — bespoke child-COMPONENT mocks (these belong to the 3c web, see that item):** `initiative-tracker/initiative-row.test.tsx` (mocks `initiative-row-info` + `initiative-row-actions`), `encounters/encounter-detail-card.test.tsx` (mocks `initiative-tracker` + 3 encounter children), `tokens/token-shape.test.tsx` (mocks `token-hp-bar`).
- Pattern precedent: `packages/client/src/test/mock-use-auth.ts` (`mockUseAuth` + `resetMockAuth()` in setup.ts `beforeEach` + `setMockAuth(overrides)`).

## Proposed direction

1. **Group (1) — `query-invalidation` only (no real-test):** add a central holder mock (`mock-query-invalidation.ts`, or a small shared `mock-invalidation.ts`) with a default *fake*, wire `reset…()` into the setup.ts `beforeEach`, register the `vi.mock` in setup.ts, and convert consumers to the per-test override + shared spy. The 3 consumer files reclassify to the fast lane. This is the only true mechanism-**(i)** module in bucket B.
2. **Group (2) — modules whose real-test is currently fast (`realtime-invalidation`, `token-store`, `download-json`, `use-campaign-presence`, `use-srd-lookups`, `use-notifications`):** centralize with a **default-real passthrough** (`vi.importActual` behind the holder); consumers opt **in** via `setMockX()` in `beforeEach`. This is mechanism **(ii)** — it frees the consumers **without** forcing the real-test to add a `vi.unmock`, so the real-test stays in the fast lane. Do **not** use a default-fake holder for these; that would demote the real-test.
3. **Group (3) — modules whose real-test already self-unmocks (`use-ability-roll`, `use-monster-hp-update`, `use-weapon-attack`, `use-feature-use`, `use-inventory`, `use-background-image`, and `map-token-mutations`):** centralizing for the consumers is safe either way (the real-test is already isolated). The cleanest path is still the default-real passthrough from (2), which additionally lets you drop the real-test's `vi.unmock` and free it too. If you keep a default-fake instead, **flag the real-test as 3c-dependent** and leave its `vi.unmock` in place. Either way the consumer files reclassify; the real-test lane outcome depends on the model chosen.
4. Defer the bespoke child-COMPONENT-mock files (and `map-token-mutations`' own real-test) to 3c.
5. Re-run classifier + shuffled fast lane (fast lane + newly-freed files, not the whole suite) after each module.

## Scope / caveats

- **Confirm each hook's mock is behavioral, not structural**, before centralizing — a hook mocked to change a component's render *structure* (vs. inject data / spy a call) may not survive a single shared default; those are closer to the 3c child-component pattern.
- **Mixed-pin files won't move:** a bucket-B file that mocks BOTH a recurring hook AND a child component (or also self-unmocks) stays isolated until its other pins are gone. Expect 3b's standalone lane win to be smaller than its file count — possibly ~10–15 files, not 21. Measure, don't assume.
- Coverage-preserving: same spies, same data, same assertions. The invalidation tests in particular assert call **counts/args** (see testsuite-audit #22) — preserve the spy handle.
- **Most of 3b is really 3c's mechanism applied per-module.** After the review correction only 1 of 7 module groups (`query-invalidation`) uses the simple default-fake holder; the other 6 need the default-real passthrough. That raises effort and means 3b and 3c share the same harness primitive (`vi.importActual` default behind a holder) — build it once. The lane win (consumers freed) is unchanged, but treat 3b as medium-effort default-real work, not a quick global-fake sweep.
- Lower confidence than 3a (med): the per-hook behavior varies and a few may resist centralization. Treat as a per-module sweep, re-measuring after each, not one big-bang.
- Estimated impact: ~20s → ~16s (box/load-dependent). The consumer-freeing count is roughly the same as the original draft; what changed is the model (default-real, not default-fake) and that the real-tests must not regress.
