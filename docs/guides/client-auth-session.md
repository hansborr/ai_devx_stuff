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
- If the refresh fails (or there was no token to begin with), the original
  `401` response is returned unchanged.

### Why both exist

The mount-time path exists to **bootstrap** a session that has no in-memory
token yet (cold start / reload). The 401 path exists to **recover** an
already-running session when its short-lived access token expires mid-use. They
serve different moments in the session lifecycle, which is why both write the
same store but live in different files.

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
| `packages/client/src/hooks/auth-context.tsx` | **Writer**: mount refresh, login, logout. Also owns the reset surface. |
| `packages/client/src/lib/trpc.ts` | **Reader + writer**: attaches `Authorization` header on every batch; 401-interceptor refresh writes the store. |
| `packages/client/src/hooks/socket-context.tsx` | **Reader**: reads the token to gate the Socket.io connection and again inside the `auth` callback on every (re)connect. Does **not** participate in either refresh path. |
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
  token set/clear, and the full reset surface (query cache + combat store +
  map-canvas store) on both login and logout.
- `token-store.test.ts` — the in-memory `get`/`set` store.
- `socket-context.test.tsx` — the handshake token is read for the connection.

## See Also

- `docs/authorization.md` — server-side auth helpers, error codes, visibility.
- `docs/socket-architecture.md` — the Socket.io handshake token contract.
- `packages/client/src/hooks/MODULE.md` — client hooks orientation.
