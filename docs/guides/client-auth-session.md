# Client Auth Session And Token Lifecycle

How the React client holds the access token, when it refreshes, and what resets
on login/logout. This is the client counterpart to the server-side
`docs/authorization.md` and the handshake contract in
`docs/socket-architecture.md`. It documents the existing flow; it does not
propose refactors.

## Where The Token Lives

- The access token is a module-global, in-memory `let accessToken` in
  `packages/client/src/lib/token-store.ts`, behind `getAccessToken()` /
  `setAccessToken()`. It is **not persisted** (no `localStorage` / cookie on the
  client side), so a hard reload starts with `null`.
- The long-lived **refresh token** lives in an HTTP-only cookie owned by the
  server and is never read by client JS. The client only ever sends it
  implicitly via `credentials: "include"` on the refresh call.
- Because the access token is non-persistent, a hard reload re-bootstraps the
  session through the mount-time refresh below; without that step the app would
  start unauthenticated even with a valid refresh cookie.

## The Two Refresh Paths

There are two distinct refresh implementations. They are not duplicates: they
have different triggers and use different transports.

### 1. Mount-time bootstrap (tRPC mutation)

- Location: `useRefreshOnMount` in
  `packages/client/src/hooks/auth-context.tsx`.
- Trigger: once, when `AuthProvider` mounts (e.g. initial load or hard reload).
- Mechanism: the tRPC `auth.refresh` **mutation** (`refreshMutation.mutateAsync()`),
  which returns the access token and the session user already loaded during
  refresh. The client stores both directly without a follow-up `auth.me` query.
- Guard: a `didRefresh` ref makes it fire exactly once. React StrictMode
  re-fires effects, and the first refresh **rotates the refresh token**, so a
  second call would fail — the ref prevents that double-execution.
- On failure it simply clears `isLoading`; `user` stays `null` (unauthenticated).

### 2. 401 interceptor (raw fetch, singleflight)

- Location: `refreshAccessToken` + `getRefreshPromise` and the `httpBatchLink`
  custom `fetch` in `packages/client/src/lib/trpc.ts`.
- Trigger: any tRPC call that comes back `401` while a token is present.
- Mechanism: a raw `fetch("/trpc/auth.refresh", { credentials: "include" })`
  (not the tRPC mutation), which writes the same `token-store`. The interceptor
  then retries the original request **once** with the new `Authorization`
  header. This is invisible to callers — the awaited tRPC call just succeeds.
- Singleflight: `getRefreshPromise()` caches the in-flight refresh promise in
  `refreshPromise` and clears it in `.finally`, so concurrent 401s share one
  refresh round-trip instead of stampeding the endpoint.
- If the refresh does not produce a token (or there was no token to begin with),
  the original `401` response is returned unchanged.
- `refreshAccessToken` reports a three-way `RefreshOutcome`, not a boolean,
  because "the refresh failed" and "the session is over" are different facts:

  | Outcome | When | Interceptor does |
  | --- | --- | --- |
  | `refreshed` | 2xx carrying an `accessToken` | retries the original request |
  | `rejected` | the refresh endpoint answered `401` | `notifySessionExpired()` — see below |
  | `unavailable` | offline/throw, any other non-2xx (`502`, `429`, …), malformed body | nothing; returns the `401` |

  Only `rejected` ends the session, and only the server's own
  "invalid or expired refresh token" produces it (`routers/auth.ts` throws
  `UNAUTHORIZED` for a missing, unknown, or expired refresh cookie). Ending a
  session is destructive — query cache cleared, stores reset, socket dropped —
  so a proxy hiccup or a Wi-Fi blip must stay a single failed request, which is
  exactly how it behaved before this pathway existed.

### Why both exist

The mount-time path exists to **bootstrap** a session that has no in-memory
token yet (cold start / reload). The 401 path exists to **recover** an
already-running session when its short-lived access token expires mid-use. They
serve different moments in the session lifecycle, which is why both write the
same store but live in different files.

## The Session-Expired Pathway

A failed refresh used to be silent: `user` stayed non-null in React state, so
`AuthGuard` kept rendering the page and the user sat on a "failed to load"
screen with a dead session. Nothing routed them anywhere, and nothing carried
where they were.

The pathway now has three parts, each owned by the layer that can see it:

1. `packages/client/src/lib/trpc.ts` — the only place that *knows*. On a 401
   with a token present whose refresh came back `rejected` (see the outcome
   table above), it calls `notifySessionExpired()`.
2. `packages/client/src/lib/session-expiry.ts` — a module-level notifier
   (`onSessionExpired` / `notifySessionExpired`). The publisher is a plain
   module, not a component, so this is a subscription rather than context.
3. `useSessionExpiryReset` in `auth-context.tsx` — subscribes and performs the
   same teardown as `logout` minus the server round-trip that would fail
   anyway: `clearUserScopedState()`, `setAccessToken(null)`, `setUser(null)`.

Clearing `user` is what makes the redirect happen: `AuthGuard` sees an
unauthenticated user and navigates to login.

Clearing `user` is also what tears the socket down, so nothing extra is needed
and nothing is outstanding here: `SocketProvider`'s effect is keyed on
`isAuthenticated`, and on the false transition it removes all listeners,
disconnects, and nulls the ref (`hooks/socket-context.tsx`). An expired session
therefore ends with no live socket carrying a dead identity.

### Return-to

`packages/client/src/lib/login-redirect.ts` owns the round-trip target.

- `AuthGuard` redirects with `buildLoginHref(location.href)`, i.e.
  `/login?returnTo=<encoded>`, instead of a bare `/login`.
- `GuestGuard` resumes `readReturnTo(location.searchStr)` when an authenticated
  user lands on a guest route, and falls back to `/dashboard`.
- `isSafeReturnTo` gates both ends: path-absolute only, rejecting `//host` and
  `/\host` (which some browsers resolve off-origin) and the guest routes
  themselves (which would bounce straight back). The login page is not an open
  redirect.

#### Both guards stand down after their own redirect

A guard is still mounted when the navigation it just issued commits, so it gets
at least one render against the *destination* — and both guards derive their
target from the current location, which by then is the wrong input:

| Guard | Stale render sees | Recomputed target | Damage |
| --- | --- | --- | --- |
| `AuthGuard` | `/login?returnTo=…` | `buildLoginHref` rejects the guest route → bare `/login` | the return-to is dropped |
| `GuestGuard` | `/join/:code` | no `returnTo` in the search → `/dashboard` | the resume is undone |

So each guard checks `isGuestPath(location.pathname)` and renders nothing when
the location is no longer one it owns: `AuthGuard` guards non-guest routes,
`GuestGuard` guards guest routes. The router unmounts the subtree a frame later.

Both failures are invisible to the unit suite, which asserts `data-href` on a
`Navigate` stub that never changes the location. They were found by
`e2e/join-return-to.spec.ts` and are the reason it exists.

This is what keeps invite links working while logged out: `/join/:code` is
`AuthGuard`-wrapped and the invite code exists only in the URL, so before the
return-to existed, `AuthGuard` sent the user to `/login` and `GuestGuard` then
bounced them to `/dashboard` — silently discarding the code.

## Login / Logout Reset Surface

`clearUserScopedState()` in `auth-context.tsx` is the single reset helper. It is
called on **both** login and logout (so a new login never inherits the previous
user's cached data), and it resets three things:

1. `queryClient.clear()` — the entire TanStack Query cache.
2. `useCombatStore.getState().reset()` — the combat zustand store.
3. `useMapCanvasStore.getState().reset()` — the map-canvas zustand store.

Token writes happen alongside the reset:

- **login**: `clearUserScopedState()`, then `setAccessToken(result.accessToken)`,
  then `setUser(result.user)`.
- **logout**: after the `auth.logout` mutation, `clearUserScopedState()`, then
  `setAccessToken(null)`, then `setUser(null)`.
- **register** does **not** authenticate — it sets neither token nor user; the
  user logs in separately afterwards.

## Token Consumers And Writers

Everything that reads or writes the in-memory access token, in one place:

| File | Role |
| --- | --- |
| `packages/client/src/lib/token-store.ts` | The store itself (`get`/`setAccessToken`). |
| `packages/client/src/hooks/auth-context.tsx` | **Writer**: mount refresh, login, logout, session-expiry reset. Also owns the reset surface. |
| `packages/client/src/lib/trpc.ts` | **Reader + writer**: attaches `Authorization` header on every batch; 401-interceptor refresh writes the store, and announces `notifySessionExpired()` when that refresh fails. |
| `packages/client/src/hooks/socket-context.tsx` | **Reader**: reads the token to gate the Socket.io connection and again inside the `auth` callback on every (re)connect. Does **not** participate in either refresh path, but its `isAuthenticated`-keyed effect disconnects on session expiry. |
| `packages/client/src/hooks/use-map-image-upload.ts` | **Reader**: attaches the bearer token to the raw multipart upload `fetch` (uploads bypass tRPC). |
| `packages/client/src/pages/settings-page.tsx` | **Writer**: after a successful password change, `setAccessToken(data.accessToken)` (the server rotates the token and signs out other sessions). |

## Gotchas

- The Socket.io provider does not refresh. If the access token expires, an
  in-flight socket stays up, but a (re)connect re-reads `getAccessToken()` from
  the `auth` callback, so it picks up whatever the refresh paths last wrote. See
  `docs/socket-architecture.md` for the handshake side (`socket.handshake.auth.token`).
- A hard reload silently depends on the mount-time refresh; if you change that
  path, the reload-while-logged-in case is what breaks first.
- Raw (non-tRPC) requests — currently the map-image upload — do **not** get the
  401-interceptor retry. They read the token once; if it is stale, the upload
  fails and is not auto-retried.

## Test Seams

- `auth-context.test.tsx` — mount-time refresh + `setAccessToken`, login/logout
  token set/clear, the full reset surface (query cache + combat store +
  map-canvas store) on both login and logout, and the session-expiry reset plus
  its unsubscribe on unmount.
- `trpc.test.ts` — the 401 interceptor announces expiry only when a token was
  present and the refresh was itself rejected; a `502`, a `429`, an offline
  throw, and a malformed body each leave the session standing.
- `login-redirect.test.ts` / `session-expiry.test.ts` — return-to building,
  reading, and safety; notifier subscribe/unsubscribe semantics.
- `auth-guard.test.tsx` / `guest-guard.test.tsx` — the login redirect carries a
  return-to, and an authenticated guest-route visit resumes it (or falls back to
  `/dashboard`, including for an off-site value); plus each guard's stand-down
  once the location is no longer one it owns.
- `e2e/join-return-to.spec.ts` — the only coverage that drives the **real**
  router through the whole logged-out `/join/:code` → login → resume → join
  round-trip. Everything else asserts against the `Navigate` stub, so this spec
  is what stands between a router upgrade and a silently dropped invite code.
- `token-store.test.ts` — the in-memory `get`/`set` store.
- `socket-context.test.tsx` — the handshake token is read for the connection.

## See Also

- `docs/authorization.md` — server-side auth helpers, error codes, visibility.
- `docs/socket-architecture.md` — the Socket.io handshake token contract.
- `packages/client/src/hooks/MODULE.md` — client hooks orientation.
