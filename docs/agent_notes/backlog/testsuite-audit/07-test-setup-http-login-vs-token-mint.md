# 7. Per-test setup uses full HTTP `auth.login` round-trips where an in-process token mint would do

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: speed · Area: server · Severity: med · Size: S-M · Confidence: high
Theme: setup-bootstrap-cost · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
Bearer auth in `trpc/context.ts:45` is verified by `verifyAccessToken` — a pure JWT verify with **no** database session lookup. The token is the only thing the request context derives from the header; nothing about the cookie or the `Session` row is consulted on a normal authenticated tRPC call.

Yet every server context helper authenticates its test users by driving the full `/trpc/auth.login` route through `loginUser` (`auth-helper.ts:14-40`). That path is expensive relative to what the setup actually needs: a real `app.inject` HTTP round-trip into Fastify + tRPC, a `bcrypt.compare` inside the login resolver, a `Session` row INSERT, then `JSON.parse(response.body)` and a Zod parse back in the helper — paid per user, per `it()`. `createLoggedInTestUser` at `campaign-test-context.ts:138-140` calls `loginUser` and then returns only `login.accessToken`, discarding the `setCookieHeader` (and the session it represents). The spell/inventory/rest helpers do the same: they log in two users apiece and keep only `.accessToken` (`spell-test-helper.ts:48-49`, `inventory-test-helper.ts:129-132`, `rest-test-helper.ts:52-53`). So none of the cookie/session machinery these logins create is exercised by the setup that creates it — it is built and thrown away.

The same JWT the tests consume is mintable in-process via `createAccessToken` (`auth-service.ts:62`), with no HTTP, no `bcrypt.compare`, and no session write. Ten socket/broadcast/presence test files already mint setup tokens exactly this way (`createAccessToken(TEST_USER)`), so the setup demonstrably needs neither the session row nor the cookie — the HTTP-login bootstrap in the tRPC context helpers is redundant cost.

There are 112 static `loginUser` call sites across 43 files; the per-run count is higher still, because the `setup*Context` helpers log in 1 DM plus N players per `it()`. Across a full run this is well over a hundred avoidable HTTP-login round-trips, each with an attendant session INSERT and parse.

## Evidence
- `packages/server/src/trpc/context.ts:45` — `const user = token ? await verifyAccessToken(token) : null` — JWT verify only; no DB/session lookup, so an authenticated request never reads the session row a login creates.
- `packages/server/src/test/auth-helper.ts:19-26,37` — `loginUser` does `app.inject` `POST /trpc/auth.login` (full HTTP into the login resolver: `bcrypt.compare` + `Session` INSERT), then `JSON.parse(response.body)` and a Zod parse, returning `accessToken` + `setCookieHeader`.
- `packages/server/src/test/campaign-test-context.ts:138-140` — `createLoggedInTestUser` calls `loginUser` then returns `{ token: login.accessToken, user }`, discarding the session/cookie. (`DEFAULT_PLAYER_COUNT = 1` at line 12, so the common case logs in DM + 1 player per `it()`; tests overriding `playerCount` log in more.)
- `packages/server/src/test/spell-test-helper.ts:22-23,48-49` (and `inventory-test-helper.ts:101-132`, `rest-test-helper.ts:21-53`) — each logs in two users via `loginUser` and keeps only `.accessToken`, never the `setCookieHeader`.
- `packages/server/src/services/auth-service.ts:62` — `createAccessToken(user)` mints the same JWT in-process, no HTTP / bcrypt / session write.
- 112 static `loginUser` call sites across 43 files; 10 test files already mint setup tokens via `createAccessToken` (e.g. `socket/socket-auth.test.ts:25`, `socket/connection-handler.test.ts:36`, `socket/encounter-broadcast.test.ts:70`), proving the mint path is an established norm.

## Proposed direction
Add a small test helper that mints a token directly via `createAccessToken({ id, email, displayName })` (or a thin wrapper over it), and have the campaign/spell/inventory/rest/homebrew context helpers use it instead of `loginUser` for the common setup case. The migrated helpers already discard `setCookieHeader` and the session, so swapping the bootstrap from "login over HTTP" to "mint a token" changes nothing they assert on — `verifyAccessToken` accepts the minted JWT identically (it is the same signing path).

Keep `loginUser` intact and in use only where a test specifically asserts on the login route, cookies, refresh, or session rows — the `auth-refresh.test.ts` / `auth-logout.test.ts` / `auth-change-password.test.ts` / `auth-delete-account.test.ts` family, the rate-limiting tests (`auth-rate-limit.test.ts`, where the login route itself is the rate-limited subject), and anything referencing `setCookieHeader` or `prisma.session`. Login-route coverage stays where it belongs (the `auth*.test.ts` files); the setup-only logins lose nothing they were verifying, because they were verifying nothing — they were a fixture-build step.

Estimated impact: eliminates the HTTP `app.inject` + `Session` INSERT + `JSON.parse`/Zod parse for every setup login — well over 112 per run once DM + players are counted. The saving per call is real but modest: note the `bcrypt.compare` here runs against `TEST_BCRYPT_ROUNDS = 4` fixture hashes (`fixtures.ts:6`), not production `rounds=12`, so bcrypt is **not** the dominant cost — the savings are the inject round-trip, the session write, and the parse, likely a couple of seconds of server-suite wall time plus reduced DB and rate-limiter contention during setup. No coverage change.

## Scope / caveats
Touch only the test context helpers (`campaign-test-context.ts`, `spell-test-helper.ts`, `inventory-test-helper.ts`, `rest-test-helper.ts`, `homebrew-test-helper.ts`) and add the mint helper. Do **not** delete `loginUser`; leave it for tests that assert on login/cookie/session/refresh behavior. Before switching each migrated call site, audit it for any assertion on the discarded `setCookieHeader`/session — none of the helpers above carry one today, but confirm per site to preserve coverage.

This finding was merged from a duplicate observation ("Per-test bootstrap uses full HTTP `auth.login` round-trips where an in-process token mint would do") — same target, folded in here. It is distinct from, and independently committable alongside, the double-clean finding (which removes redundant `cleanDb` calls); this one removes redundant HTTP logins. Low risk: the mint path is already the established pattern in 10 socket/presence test files, so this is consolidation toward an existing norm, not a novel technique.

One narrative correction carried from re-verification: the original problem text said the default is 2 players; the live `DEFAULT_PLAYER_COUNT` is 1, and the bcrypt cost is against rounds=4 test hashes, so the dominant saving is the HTTP/DB round-trip, not bcrypt.
