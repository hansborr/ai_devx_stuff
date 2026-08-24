# 52. Eight campaign tabs are kept aligned across trigger and panel registries by a doc checklist instead of the compiler

Status: Not started
Theme: derived tab registry · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The campaign detail page renders eight tabs, and each tab is declared twice:
once as a `TabsTrigger` (identifier, label, icon) and once as a `TabsContent`
(identifier, panel). The DM-only gate on the settings tab is written out
independently in both places. The `CampaignTab` union in `lib/campaign-tabs.ts`
validates individual literals at the route boundary, but the Radix `value`
props are plain strings, so nothing ties either JSX registry to the union: a
ninth entry added to `CAMPAIGN_TABS` compiles cleanly with no trigger, no
panel, or a mismatched access gate. The only thing holding the three surfaces
together is a contributor checklist in `pages/MODULE.md` telling maintainers to
edit them in lockstep — documentation compensating for a structural guarantee
the code could give itself. Because the duplicated half is an access gate, the
cost of drift is not just a dead tab: it is a trigger without a panel (or the
reverse) shown to the wrong role.

## Evidence

- `packages/client/src/lib/campaign-tabs.ts:1-12` — `CAMPAIGN_TABS` declares
  the eight identifiers; `CampaignTab` is derived from it.
- `packages/client/src/pages/campaign-detail-page.tsx:81-119` — `TabsList`
  with eight `TabsTrigger`s repeating the identifiers as string `value` props
  plus label and icon; the settings trigger sits behind `isDm` at `:113-118`.
- `packages/client/src/pages/campaign-detail-page.tsx:157-190` — eight
  `TabsContent`s repeat the identifiers a third time; the `isDm` gate is
  independently repeated at `:186-190`.
- `packages/client/src/components/ui/tabs.tsx:22-35` — `TabsTrigger` /
  `TabsContent` pass through Radix props, whose `value` is `string`; no
  compile-time link to `CampaignTab`.
- `packages/client/src/pages/MODULE.md:62-67` — the checklist: "Add or rename
  campaign tabs in both places: update the tab union and default … then add
  the matching trigger and panel wiring", plus "Keep the route parser, tab
  triggers, and tab content values aligned with that contract."
- `packages/client/src/routes/campaign-detail-route.ts:25-26` — the route leg
  is already derived: `validateSearch` narrows through `isCampaignTab`, so the
  drift risk is concentrated in the two JSX registries.
- `packages/client/src/pages/campaign-detail-page.test.tsx:22-31` and
  `:123-130` — the page's own test suite already uses the missing pattern: an
  exhaustive `Record<CampaignTab, () => HTMLElement>` (`PANEL_MARKERS`) driven
  by `it.each(CAMPAIGN_TABS)`, so the tests are structurally forced to cover
  every tab while the production code is not.

## Proposed direction

Replace the parallel trigger and content JSX registries in
`campaign-detail-page.tsx` with one exhaustive page-local
`Record<CampaignTab, {label, icon, dmOnly, render}>` descriptor from which both
the `TabsList` triggers and `TabsContent` panels are derived (keeping the
single `isDm` gate in one place), and slim the `pages/MODULE.md` tab checklist
to match. Mechanics:

- Iterate `CAMPAIGN_TABS` (preserving its declared order) and index into the
  descriptor, filtering `dmOnly` entries once when `!isDm` — that filter is
  the single surviving gate, applied identically to triggers and contents.
  The `Record` key type makes a missing or extra entry a compile error.
- `render` takes the values `CampaignTabs` already computes (`campaign`,
  `userId`, `isUserOnline`, `isDm`, `userCharacterIds`); the members trigger
  additionally renders the member-count badge
  (`campaign-detail-page.tsx:89-91`), so give the descriptor an optional
  trigger-badge slot rather than special-casing members inline.
- Rewrite `MODULE.md:62-67` to the new two-step reality: extend the union in
  `lib/campaign-tabs.ts`, add one descriptor entry.
- The existing deep-link matrix (`campaign-detail-page.test.tsx:123-130`) and
  the DM/player settings-visibility tests (`:82-88`, `:137-140`) must stay
  green unchanged; verify with
  `bun run test -- packages/client/src/pages/campaign-detail-page.test.tsx`.

## Scope / caveats

- The descriptor is deliberately **page-local**. Do not move it into
  `lib/campaign-tabs.ts`: that module is the route search-state contract
  (`MODULE.md:65-67`) and stays free of JSX and panel imports so
  `campaign-detail-route.ts` keeps a lean dependency.
- Preserve the current non-DM behavior exactly: today the settings trigger
  *and* content are both unmounted for players (`:113-118`, `:186-190`).
  Filtering the descriptor before rendering keeps that; rendering all contents
  and hiding only triggers would mount a DM-only panel for players and is out
  of scope.
- Out of scope: changing the tab set, lazy-loading panels, or any change to
  `campaign-detail-route.ts` — the route leg is already derived and correct.
- Prior pack: the landed 2026-07-25 viewer-identity cluster
  (`../code-quality-2026-07-25/12-campaign-context-prop-drilling.md`, Done
  2026-07-27) introduced the `CampaignViewerScope`/`isDm` resolution this page
  consumes but never touched the tab trigger/content registries; this leaf
  builds on it and does not conflict with it.
- No sequencing edges against other leaves in this pack; single commit.
