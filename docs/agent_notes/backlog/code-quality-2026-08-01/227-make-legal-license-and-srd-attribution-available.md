# 227. Make legal, license, and SRD attribution available before authentication

Status: Not started
Theme: The legal and license page is unavailable before authentication · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

Musi's legal page is static and contains information a prospective user may
need before creating an account, yet its route is protected like an
authenticated application page. A guest who opens `/legal` is redirected to
login, and the only existing Legal navigation lives in a header that is itself
hidden from guests.

This makes source licensing, SRD attribution, and trademark notices
discoverable only after authentication even though the page reads no private
or account-specific data.

## Evidence

- `packages/client/src/routes/legal-route.ts:4-16` — the `/legal` route wraps
  its lazy page component in `AuthGuard`.
- `packages/client/src/components/common/auth-guard.tsx:32-42` —
  unauthenticated visitors are redirected to `/login`.
- `packages/client/src/components/app-header.tsx:75-77` and
  `packages/client/src/components/app-header.tsx:87-90` — the mobile header
  includes a Legal link, but `AppHeader` returns `null` for unauthenticated
  users.
- `packages/client/src/components/app-header.tsx:114-119` — the desktop Legal
  link also belongs to that authenticated-only header.
- `packages/client/src/pages/login-page.tsx:132-139` and
  `packages/client/src/pages/register-page.tsx:160-167` — the two stable guest
  footers link only between login and registration; neither exposes Legal.
- `packages/client/src/pages/legal-page.tsx:13-60` — the static page contains
  the MIT source-license statement, SRD 5.2.1 and CC-BY-4.0 attribution,
  modification notice, and trademark disclaimer.

## Proposed direction

Make `legalRoute` a public child of `rootRoute`: remove its `AuthGuard` import
and one-use `ProtectedLegal` wrapper, and register `LazyLegalPage` directly as
the route component. Keep `/legal` as the URL and leave all other routes'
guards unchanged.

Add a visible Legal link to both the login and registration card footers so a
guest has a stable path to the page before submitting credentials. Preserve
the existing login/register cross-links and the authenticated header links.

Add a route regression proving that an unauthenticated visit to `/legal`
renders the Legal heading without producing an auth redirect. Extend
`login-page.test.tsx` and `register-page.test.tsx` to assert the guest-visible
Legal links and their `/legal` targets; retain the existing legal-page content
test.

## Scope / caveats

- Coordinate route-tree work with
  [051-flat-route-tree-makes-authentication-eleven.md](./051-flat-route-tree-makes-authentication-eleven.md).
  If that change lands first, move `/legal` out of its authenticated layout; if
  this change lands first, the layout's protected set must exclude `/legal`.
  The route must remain a public root child in the combined result.
- Do not change `AuthGuard`, guest return-to behavior, or the access policy of
  any route other than `/legal`.
- Do not expose authenticated data or add data fetching to `LegalPage`; its
  static content is the reason public routing is safe.
- Legal-copy review, license changes, and additional policy pages are outside
  scope.
