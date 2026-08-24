# 51. The flat route tree turns authentication into an eleven-site copy-paste convention instead of a route-hierarchy guarantee

Status: Not started
Theme: route hierarchy owns auth · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every authenticated page in the client is guarded the same way: the route module
imports `AuthGuard`, defines a one-use `Protected*` wrapper component that
renders `AuthGuard` around the page, and registers that wrapper as the route
component. Eleven production route modules repeat this ritual verbatim. The
route tree itself is flat — public, guest, and authenticated routes are all
direct children of the root — so nothing in `route-tree.ts` shows which part of
the app is protected; that knowledge lives only in the convention, one file at a
time. The cost lands on the common add-a-route path: a contributor who copies
the wrong template, or simply forgets the wrapper, silently ships an unguarded
page, and no type error, lint rule, or test catches it. TanStack Router already
has the construct that makes the hierarchy carry this instead — a pathless
layout route — and the root route already uses exactly this nesting mechanism
(`App` renders an `Outlet`), so the guarantee is one parent route away.

## Evidence

- `packages/client/src/routes/route-tree.ts:17-32` — the entire tree is 14
  direct children of `rootRoute`: 3 public/guest routes (`indexRoute`,
  `loginRoute`, `registerRoute`) and 11 protected ones, visually
  indistinguishable.
- 11 production route modules import `AuthGuard` and each defines a single-use
  `Protected*` wrapper (measured at the pin with `git grep -l AuthGuard --
  packages/client/src/routes/`): `campaign-detail-route.ts`,
  `campaigns-route.ts`, `character-create-route.ts`,
  `character-sheet-route.ts`, `collection-detail-route.ts`,
  `dashboard-route.ts`, `homebrew-route.ts`, `join-route.ts`, `legal-route.ts`,
  `magic-items-route.ts`, `settings-route.ts`.
- `packages/client/src/routes/campaigns-route.ts:8-16` — the representative
  ritual: `ProtectedCampaigns` wraps `CampaignsPage` in `AuthGuard`, and the
  route's `getParentRoute` points at `rootRoute` like every other route.
- `packages/client/src/routes/root-route.ts:5-7` plus
  `packages/client/src/app.tsx:18` — the root route's component already renders
  an `Outlet`, so parent-renders-children nesting is the established pattern
  here, just never used for auth.
- `packages/client/src/routes/router.test.tsx:46-73` — `flattenRoutePaths`
  recurses into `children` and matches on `path`/`fullPath`, so the existing
  route-presence assertions survive reparenting unchanged.

## Proposed direction

Add a pathless authenticated layout route whose component renders `AuthGuard`
around an `Outlet`, reparent the 11 protected route modules onto it via
`getParentRoute`, and delete the per-route `Protected*` wrapper components.

Mechanics: create the layout route in `packages/client/src/routes/` with
`createRoute({ getParentRoute: () => rootRoute, id: "...", component: ... })` —
an `id` instead of a `path` keeps every URL unchanged — and register it in
`route-tree.ts:17-32` with `.addChildren([...])` over the 11 protected routes,
leaving `indexRoute`, `loginRoute`, and `registerRoute` as direct root
children. In each of the 11 modules, point `getParentRoute` at the new layout
route, set `component` to the page (or its `lazyRouteComponent`) directly, and
drop the `AuthGuard` import with the wrapper. One commit; URLs unchanged.

## Scope / caveats

- **Preserve the protected set exactly.** `/legal` (`legal-route.ts:9-17`) and
  `/join/$code` (`join-route.ts:8-16`) are behind `AuthGuard` today; whether
  either should be public is a product decision this leaf does not make.
- **Do not touch `AuthGuard` internals or the return-to plumbing.** The guard's
  guest-path/redirect behavior (`auth-guard.tsx:32-41`,
  `lib/login-redirect.ts`) keeps invite codes alive across the login
  round-trip; reparenting changes where the guard mounts, not what it does.
  [186-authentication-redirects-depend-undocumented.md](186-authentication-redirects-depend-undocumented.md)
  owns documenting that redirect contract — leave its surface alone here.
- The parallel `GuestGuard` wrappers on `/login` and `/register`
  (`login-route.ts:8-16`, `register-route.ts`) are out of scope; at two sites
  the convention is cheap, and a guest layout route can copy this leaf's shape
  later if a third guest route ever appears.
- After the change, `bun run test -- packages/client/src/routes/router.test.tsx`
  is the focused check that every path still resolves; the suite's flattener
  already handles nested trees, so failures there mean a real reparenting
  mistake, not a stale assertion.
