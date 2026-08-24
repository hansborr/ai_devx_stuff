# 40. The VTT Actions tab reimplements the Spells and Features tabs' rows with divergent eligibility, and its Use button is a console.log placeholder

Status: Not started
Theme: compact/full drawer surface duplication · Area: client · Severity: high · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The VTT drawer's compact Actions tab renders the same spell and feature records
as the dedicated Spells and Features tabs, but with its own independent
implementations — and the copies have already drifted into **contradictory
production controls for the same records**.

For spells, `actions-tab-spells.tsx` independently groups spells by level,
builds its own slot map, and renders its own rows — but its Cast button is
gated only on the drawer-wide `disabled` flag. The dedicated tab's
`CastButton` computes a `castMode` from prepared status, slot availability,
cantrip status, and ritual eligibility, and disables the button when none
apply. So an unprepared, non-ritual spell with no slot shows a **disabled**
Cast in the Spells tab and an **enabled** "Cast →" in the Actions tab, side by
side in the same drawer.

For features, `actions-tab-features.tsx` renders a production "Use" button
whose `onClick` is a `console.log` placeholder ("Feature-use resolution is
intentionally not wired yet"), while `features-tab.tsx` wires the real
`useFeatureUse` mutation with exhaustion, pending, and read-only gating. The
Actions copy also enables its Use button for exhausted features that the
Features tab correctly disables. Worse, the placeholder is pinned by a test —
`actions-tab.test.tsx` installs a `console.log` spy specifically to assert the
log call — so the drift is now load-bearing.

Every spell- or feature-behavior change must be discovered and landed twice,
and a contributor fixing one surface has no signal that the other exists.

## Evidence

- `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx:33-36`
  — the compact surface independently calls `groupSpellsByLevel`, builds its
  own `slotsByLevel` map, and derives `levels` from grouped keys only.
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-spells.tsx:127-139`
  — `CompactSpellRow`'s Cast button: `disabled={disabled}` only; no prepared,
  slot, cantrip, or ritual check anywhere in the file (the row never reads
  `spell.prepared`).
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx:231-236` —
  the dedicated tab's `castMode` block: cantrip → cast, prepared-with-slot →
  cast, ritual → ritual, otherwise `"none"`; `:243` disables on
  `disabled || castMode === "none"`. The whole `CastButton` is `:214-253`.
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx:47-49` — the
  full tab renders the union of spell levels and slot levels so empty-at-level
  casters still see slot pips; the compact tab (`actions-tab-spells.tsx:36`)
  renders only levels that have spells. An intentional presentation
  difference, not drift.
- `packages/client/src/components/vtt/drawer/tabs/spells-tab.tsx:83` vs
  `actions-tab-spells.tsx:74` — a third eligibility divergence: the full tab
  requires `slot.total > 0` before rendering pips; the compact tab renders
  pips for any slot record, including zero-total ones.
- `packages/client/src/components/vtt/drawer/tabs/actions-tab-features.tsx:60-74`
  — the compact Use button; `:69` is
  `console.log("[drawer] use feature", feature.featureId)`, and `:64` gates
  only on `disabled` — no exhaustion or pending check.
- `packages/client/src/components/vtt/drawer/tabs/features-tab.tsx:34` — the
  dedicated tab calls `useFeatureUse({ characterId, campaignId })`; `:139-178`
  (`ActiveFeatureControls`) computes `exhausted` (`:154`) and disables on
  `isReadOnly || exhausted || isPending` (`:167`) before firing the real
  mutation (`:170`).
- `packages/client/src/components/vtt/drawer/tabs/actions-tab.test.tsx:62-64,
  108, 122, 384` — the console spy exists specifically to pin the placeholder:
  declared with a comment about spy hygiene, installed in `beforeEach`,
  restored in `afterEach`, and asserted at `:384`
  (`expect(consoleSpy).toHaveBeenCalledWith("[drawer] use feature", …)`).
- `packages/client/src/components/vtt/drawer/MODULE.md:67-72` — documents
  `tabs/actions-tab.tsx` as the data boundary delegating to the four
  `actions-tab-*.tsx` renderers, and requires new server mutations to route
  through `hooks/vtt-drawer/` before wiring UI.
- `packages/client/src/hooks/vtt-drawer/use-feature-use.ts:23` — the hook the
  compact surface should be using already exists, with invalidation and
  `CONFLICT` recovery built in.
- `packages/client/src/components/vtt/drawer/player-sheet-drawer.tsx:101-107,
  122-130` — both tabs mount from the same `character`; `FeaturesTab` already
  receives `character.campaignId ?? undefined` (`:125`), and `ActionsTab`
  receives the whole `CharacterDetail`, so the campaign id needs no new prop.
- Measured at the pin: no file under `/workspace/e2e` references the
  `drawer-spell-cast-*`, `drawer-feature-use-*`, `spells-tab-cast-*`, or
  `features-tab-use-*` testids — the testid consumers are the three co-located
  drawer unit test files only.

## Proposed direction

Split-and-share, executed as two independent slices under
`packages/client/src/components/vtt/drawer/tabs/`. The shared artifact in each
slice is a **pure view model plus small row primitives** — not one
variant-flagged mega-row; each surface keeps its own thin JSX shell and its
existing testid prefixes (`spells-tab-*` vs `drawer-spell-*`,
`features-tab-*` vs `drawer-feature-*`).

1. **Slice A — spells (pure refactor).** Extract a pure spell row/view-model
   module beside the tabs, following the repo's existing pure-sibling idiom
   (`drawer/monster-stat-block-state.ts`, `drawer/speed-format.ts`). Given
   `spells`, `spellSlots`, `concentrationSpellId`, and `isReadOnly`, it
   produces:
   - the level grouping, with a parameter for whether slot-only empty levels
     are included — the full tab intentionally shows empty-level pips
     (`spells-tab.tsx:47-49`) and the compact tab does not;
   - a per-spell row model `{levelLabel, prepared, isCantrip, isConcentrating,
     ritual/concentration flags, available, castMode: "cast" | "ritual" |
     "none", disabled}` — i.e., the `castMode` block at
     `spells-tab.tsx:231-236` becomes the single eligibility source.

   Both `SpellsTab` and the Actions `SpellsSection` consume this model; share
   small row primitives (level badge, cast button) where markup is identical.
   This makes the compact Cast button eligibility-gated for the first time —
   see the caveat on newly disabled controls below.
2. **Slice B — features (deliberate behavior change).** Extract shared
   `FeatureRow`/`FeatRow` primitives that take an `onUse` handler plus
   `isPending` and `isReadOnly`. Wire the Actions `FeaturesSection` to the
   existing `useFeatureUse` hook exactly as `FeaturesTab` does — `ActionsTab`
   already has `character.id` and can thread `character.campaignId ??
   undefined` the way `player-sheet-drawer.tsx:125` does — and delete the
   `console.log` placeholder. This intentionally makes the compact Use button
   real and exhaustion/pending/read-only gated. Per
   `drawer/MODULE.md:70-72`, reuse `hooks/vtt-drawer/use-feature-use.ts`; do
   not add a new mutation path.
3. **In both slices, update `drawer/MODULE.md`** (the `tabs/actions-tab.tsx`
   entry at `:67-72` and the shared-primitive inventory around
   `tabs/shared.tsx` at `:73-74`) — the refactor contradicts the current doc
   by construction, so the doc update travels with the code.
4. **Rewrite the pinned tests with the behavior.** In slice B,
   `actions-tab.test.tsx:370-385` must assert the real mutation path instead
   of the log, and the console-spy scaffolding (`:62-64`, `:108`, `:122`)
   goes with the placeholder. In slice A, extend `actions-tab.test.tsx` /
   `spells-tab.test.tsx` to pin that both surfaces agree on cast eligibility
   for the same fixture. TDD per the project workflow: view-model tests land
   beside the new pure module before the JSX shells switch over. Focused runs:
   `bun run test -- packages/client/src/components/vtt/drawer/tabs/actions-tab.test.tsx`
   (same form for the sibling test files).

## Scope / caveats

- **Out of scope:** `actions-tab-weapons.tsx` and `actions-tab-economy.tsx`;
  cast-rail behavior; `SpellSlotPips` interactivity (`onUse`/`onRecover` stay
  noop on both surfaces); the monster stat block; any server or
  `hooks/vtt-drawer/` API changes; and sheet-side spellcasting surfaces beyond
  the already-shared `spellcasting-constants` imports.
- **Slice B is a behavior change, not a pure refactor.** The compact Use
  button goes from always-logging to really mutating, and both slices newly
  disable controls that were previously always enabled (unprepared/no-slot
  Cast, exhausted Use). Audit rather than delete the tests keyed on
  `drawer-spell-cast-*`/`drawer-feature-use-*`; at the pin no e2e page object
  references these testids (verified — consumers are the three co-located
  unit test files), so the audit surface is those files.
- **Do not over-share.** Collapsing both surfaces into one variant-flagged row
  component trades duplication for a config-flag mess. The shared artifact is
  the pure view model plus small primitives; per-surface JSX shells and
  testids stay.
- **Preserve the intentional presentation differences.** The compact surface
  hides school, ritual/concentration flags, and the prepared badge
  (`spells-tab.tsx:165-169` renders them; `actions-tab-spells.tsx` never
  does); the full tab renders empty slot levels and the non-caster empty
  state (`spells-tab.tsx:35-41, 101-107`). The consolidation must not
  silently change the full tab. The zero-total-slot pip divergence
  (`spells-tab.tsx:83` vs `actions-tab-spells.tsx:74`) should resolve to the
  full tab's `total > 0` rule inside the shared model, not survive as a
  parameter.
- **Keep every existing `data-testid` value stable on both surfaces** so the
  drawer test suites survive the refactor.
- The two slices share no artifact beyond possibly `tabs/shared.tsx`-level
  primitives and can land in either order; each slice is independently
  landable.
- Before adding any client effect while rewiring, `docs/guides/client-effects.md`
  applies as usual (the mutation wiring here needs none).
