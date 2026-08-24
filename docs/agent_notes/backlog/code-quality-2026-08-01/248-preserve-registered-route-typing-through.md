# 248. Preserve registered-route typing through links and page parameters

Status: Not started
Theme: Preserve TanStack route types through MobileNavLink · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`MobileNavLink` accepts its destination as an unrestricted string before
forwarding it to TanStack Router's typed `Link`. That wrapper creates an
untyped gap around five mobile-menu destinations even though the application
has registered its route tree.

Four parameterized pages discard the same registered-route guarantee at the
inbound boundary by calling `useParams({ strict: false })`. Their required
route parameters consequently become optional to the page, leading to empty-ID
query inputs, enabled guards, and missing-parameter branches for states their
registered routes cannot produce. A route-path or parameter rename can drift
away from a page without the exact binding rejecting it.

A typo or stale path in one of the mobile links therefore loses compile-time
route validation and may be discovered only when a user opens the mobile menu.
The adjacent desktop links retain that protection because they pass their route
literals directly to `Link`. The loose page bindings impose a similar runtime
fallback tax after navigation has already matched an exact registered route.

## Evidence

- `packages/client/src/components/app-header.tsx:18-29` —
  `MobileNavLinkProps` declares `to: string`, and the wrapper forwards that
  widened value to TanStack Router's `Link`.
- `packages/client/src/components/app-header.tsx:62-77` — the Campaigns,
  Homebrew, Magic Items, Settings, and Legal mobile destinations all cross the
  widened wrapper boundary.
- `packages/client/src/components/app-header.tsx:95-118` — the adjacent
  desktop navigation supplies route literals directly to `Link`, retaining
  the router component's destination checking.
- `packages/client/src/routes/router.ts:5-10` — the application creates its
  router from `routeTree` and augments TanStack Router's `Register` interface,
  making registered-route information available to links and route hooks.
- `packages/client/src/routes/character-sheet-route.ts:18-21` — the registered
  character-sheet route requires `$characterId`.
- `packages/client/src/routes/campaign-detail-route.ts:21-26`,
  `packages/client/src/routes/collection-detail-route.ts:16-20`, and
  `packages/client/src/routes/join-route.ts:12-16` — the other three affected
  routes require `$campaignId`, `$collectionId`, and `$code`, respectively.
- `packages/client/src/pages/character-sheet-page.tsx:23-30` — `strict: false`
  widens `characterId`, so the page supplies an empty query ID and renders a
  missing-ID branch.
- `packages/client/src/pages/campaign-detail-page.tsx:231-251` — `campaignId`
  is read loosely and normalized through an empty-ID/disabled-query fallback,
  while the adjacent search and navigation hooks bind to
  `/campaigns/$campaignId`.
- `packages/client/src/pages/collection-detail-page.tsx:149-164` — the required
  `collectionId` is read loosely, normalized to an empty string, and then used
  by both collection and entry queries.
- `packages/client/src/pages/join-page.tsx:52-70` — the required invite code
  becomes optional, producing both an empty-code fallback and an `enabled`
  guard.

## Proposed direction

Derive `MobileNavLink` from TanStack Router's registered, route-aware
destination props instead of declaring `to: string`. Either select the
relevant destination fields from the registered `Link` prop type or make the
wrapper forward those fields generically so `to` remains correlated with any
required params or search inputs. Do not widen the destination at an
intermediate helper and recover it later.

Keep `onSelect` as the wrapper-owned menu-close callback and preserve its
current children and ghost-button presentation. If other `Link` event props
are forwarded, compose them deliberately so successful activation still calls
`onSelect` exactly once.

Bind each affected page to its registered full path:

- use `/characters/$characterId` in `CharacterSheetPage`;
- use `/campaigns/$campaignId` in `CampaignDetailPage`;
- use `/homebrew/$collectionId` in `CollectionDetailPage`; and
- use `/join/$code` in `JoinPage`.

Use the `useParams({ from: ... })` full-path form rather than importing route
objects into lazily loaded pages. Destructure the now-required parameter and
remove only the fallbacks made unreachable by that guarantee: empty-string
query inputs, parameter-presence `enabled` guards, and the character sheet's
missing-ID branch. Preserve loading, error, authorization, and domain-level
not-found handling.

Add a compile-only type case that accepts a registered destination and rejects
an invented path through `MobileNavLink`, without a type assertion. Keep the
four exact page bindings under compilation and add focused route-type fixtures
where useful so a mismatched path or parameter name is rejected. Extend
`app-header.test.tsx` so clicking a mobile navigation link closes the sheet,
while retaining the existing assertions for all five destinations, the menu
trigger, logout behavior, and presentation.

## Scope / caveats

- Limit the production change to `MobileNavLink`, its five existing call sites,
  and the four named page parameter boundaries. Do not regenerate or
  restructure the route tree or start a repository-wide navigation migration.
- Do not accept `string` and cast it back to a registered destination. The
  wrapper and page boundaries themselves must retain the router's type
  information.
- Do not import route objects from lazily imported pages; that would create
  route-to-page cycles. Registered full-path bindings provide the required
  typing without those imports.
- Preserve the current routes, labels, button styling, responsive visibility,
  menu-close behavior, logout handling, and protected-route set.
  [051-flat-route-tree-makes-authentication-eleven.md](./051-flat-route-tree-makes-authentication-eleven.md)
  may reparent protected routes, but it preserves these URLs and therefore
  remains compatible with the exact full-path bindings.
- Keep this work distinct from
  [236-use-tanstack-router-for-the-campaign-homebrew.md](./236-use-tanstack-router-for-the-campaign-homebrew.md).
  That leaf replaces one raw internal anchor in the campaign homebrew dialog;
  it does not cover the app-header wrapper or page parameter hooks, and no
  ordering is required.
