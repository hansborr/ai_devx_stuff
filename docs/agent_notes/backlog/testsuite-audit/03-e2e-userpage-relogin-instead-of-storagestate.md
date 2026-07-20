# 3. e2e re-drives a full browser UI login per test instead of reusing Playwright storageState

Status: Implemented 2026-07-19 (branch auto/ready-b-e2e) — see Design decision below.
Lens: speed · Area: e2e · Severity: med · Size: M · Confidence: high
Theme: redundant-per-test-setup · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Design decision (2026-07-19)

**Chosen: per-context API login. No `storageState` file is written or restored at all.**

- The `userPage` fixture performs one headless `POST /trpc/auth.login` through `context.request`,
  routed via the browser-visible client origin (Vite proxies `/trpc` to this worktree's server),
  so the host-scoped `musi_refresh` cookie is set on the same host the page later loads from
  regardless of how `E2E_SERVER_URL` spells the server hostname. Playwright stores the
  `Set-Cookie` in that browser context's
  private cookie jar, so every context owns a distinct session row and a distinct `musi_refresh`
  cookie. The rotation hazard only exists when a cookie is *shared*: `auth.refresh` deletes and
  re-mints only the session addressed by the presented token (`routers/auth.ts` session
  delete/create pair is keyed to the looked-up session id), so a context's boot-time rotation can
  never invalidate any other context or worker. Nothing is shared, so nothing goes stale.
- **Rejected — single project-wide `use.storageState`:** the first restored context's boot refresh
  rotates the one shared cookie and breaks the 2nd..Nth contexts (the trap this leaf documents).
- **Rejected — per-worker captured `storageState`:** every restored context's boot refresh rotates
  the worker's saved cookie, so the file goes stale after one use and needs re-capture
  bookkeeping; API-per-context has no persisted state that can go stale, for the same per-login
  cost (one cheap headless request instead of a file restore).
- The `setup` project still registers the shared user once (UI `/register` flow) and writes
  `.auth/user-info.json`; only the per-test UI login is replaced.
- After API login the fixture opens `/dashboard`; the client boots without an in-memory access
  token (`token-store.ts`), `AuthGuard` renders a spinner while `isLoading`, and the mount-time
  `auth.refresh` re-hydrates the token from the cookie — the URL never transits `/login`. The
  fixture waits for that refresh response, mirroring `loginViaUi`'s waitForResponse pattern.
- Auth-subject fencing per Scope: the `auth-refresh.spec.ts` blocks "tRPC requests include
  Authorization header", "refresh token cookie is present after login", and "logout clears
  session" now drive the raw `page` with a real `loginViaUi` (shared user via
  `readSharedUser()`), so they keep asserting post-*login* state rather than a pre-seeded
  session. `auth-smoke.spec.ts`'s register → login → logout block already used the raw `page`
  and is untouched.

## Problem

> **Historical (pre-change snapshot).** Everything below this point describes the tree as it
> stood at the 2026-06-13 audit, before this leaf was implemented; its present tense, line
> numbers, and counts are from that snapshot and are retained as the rationale for the Design
> decision above. As implemented, the per-test UI login is gone: `userPage` does a headless API
> login per context, and the fixture now has 24 consuming `test()` blocks across 9 spec files
> (`wizard-validation`: 8, `navigation-errors`: 5, `character-create`: 4, `auth-refresh`: 2,
> plus one each in `auth-smoke`, `a11y`, `mobile-nav`, `character-data-integrity`,
> `homebrew-sharing`).

The Playwright `storageState` pattern was half-scaffolded but never wired, so every `userPage`-consuming test pays a full browser-UI login round-trip purely as setup. The `setup` project runs `e2e/storage.setup.ts` once before the suite: it registers a shared user via the real `/register` form, waits for the redirect to `/login`, and writes the user's credentials to `.auth/user-info.json` (`storage.setup.ts:12-30`). Crucially it stops there — it neither logs the user in nor calls `page.context().storageState({ path })`, so no authenticated browser state is ever persisted. (Note: the setup as written ends on `/login` having only *registered*; capturing an authenticated `storageState` would require adding a login step inside setup, see Proposed direction.)

As a result the `userPage` fixture opens a brand-new, cookieless browser context and performs a complete UI login on **every** test that consumes it: `browser.newContext()` then `loginViaUi(page, ...)` (`fixtures.ts:34-41`). `loginViaUi` is the full flow — `goto /login`, fill email + password, click "Log in", `waitForResponse(auth.login POST)`, and `await expect(page).toHaveURL(/\/dashboard/)` (`auth.setup.ts:7-17`). `userPage` is destructured per individual `test()` block (not once per file), and it is consumed across 8 spec files: `wizard-validation` (8 blocks), `navigation-errors` (5), `auth-refresh` (5), `character-create` (4), `homebrew-sharing` (1), plus one block each in `mobile-nav`, `character-data-integrity`, and `auth-smoke` — 26 `userPage`-consuming `test()` blocks in total. So the suite pays roughly two dozen sequential UI logins — each a page load + network round-trip + redirect wait — as setup for tests whose subject is **not** login.

Everything needed to fix this already exists except the save/restore wiring: the `setup` project, the `.auth` directory, and `dependencies: ["setup"]` on the `e2e` project are all in place (`playwright.config.ts:36-44`). Only `use.storageState` on the `e2e` project (or a `{ storageState }` passed to `browser.newContext()`) is missing — `rg 'storageState'` across `e2e/` and `playwright.config.ts` returns zero hits. This matters for run-time: with cold-start logins removed from non-auth tests, the per-test browser context boots already authenticated and goes straight to the test subject.

## Evidence
- `e2e/storage.setup.ts:12-30` — the `setup` body registers the shared user via the `/register` UI and writes `.auth/user-info.json` (line 29), but never calls `page.context().storageState({ path })`; it ends on `/login` (line 27) having only registered, so no authenticated state is captured.
- `e2e/fixtures.ts:34-41` — the `userPage` fixture does `browser.newContext()` (line 36) + `loginViaUi(page, user.email, user.password)` (line 39) for *every* consuming test; no `storageState` is passed to `newContext()`.
- `e2e/helpers/auth.setup.ts:7-17` — `loginViaUi`: `goto /login`, fill email + password, click "Log in", `waitForResponse(auth.login POST)`, `await expect(page).toHaveURL(/\/dashboard/)` — the full UI flow paid per test.
- `playwright.config.ts:36-44` — the `setup` → `e2e` dependency chain exists (`dependencies: ["setup"]`, line 43), but `use.storageState` is never set on the `e2e` project; `fullyParallel: false` and `workers: 4` are configured (lines 27, 30).
- `rg 'storageState'` over `e2e/` + `playwright.config.ts` returns **zero** hits; `userPage` is consumed across 8 spec files (`wizard-validation`:8, `navigation-errors`:5, `auth-refresh`:5, `character-create`:4, `homebrew-sharing`:1, `mobile-nav`:1, `character-data-integrity`:1, `auth-smoke`:1 `test()` blocks = 26 total).
- `packages/client/src/lib/token-store.ts:1` — the access token lives **in-memory** (`let accessToken: string | null = null;`, with named `getAccessToken`/`setAccessToken`), not in `localStorage`; only the `musi_refresh` httpOnly cookie persists. This bounds what `storageState` can restore (cookies + origin storage, never an in-memory variable) and is why auth-subject tests must keep a real login (see Scope).

## Proposed direction
Wire the existing scaffold so authenticated state is captured once and reused:

1. In `storage.setup.ts`, after registration redirects to `/login`, add a `loginViaUi(page, user.email, user.password)` so the context reaches an authenticated `/dashboard`, then call `await page.context().storageState({ path: ".auth/user.json" })`. (The setup currently registers only; the login step is required so the saved state actually carries the session cookie.)
2. Restore an authenticated state per context/worker — **not** one static project-wide cookie. **Caveat (do not skip):** the app *rotates* refresh tokens — `auth.ts` deletes the prior session and mints a new `musi_refresh` cookie on every refresh — and the client refreshes from the cookie on boot. So a single shared `storageState` (`use: { storageState: ".auth/user.json" }` on the whole `e2e` project) goes stale the moment the *first* restored context boots and refreshes: that rotation invalidates the one shared `musi_refresh` cookie, breaking the 2nd..Nth context/worker. Prefer a **per-context or per-worker** authenticated state instead — the cheapest being an API login per context (hit the login endpoint and inject the cookie) which sidesteps the shared-cookie rotation trap entirely; alternatively, capture one saved state per parallel worker.
3. Drop the per-test `loginViaUi` from the `userPage` fixture for tests whose subject is not auth — the per-context restored/issued cookie already authenticates the context, and the client re-hydrates its in-memory access token from the `musi_refresh` cookie on boot.

Keep an explicit real-login path (`loginViaUi` / `registerAndLogin`) **only** for auth-subject tests: `auth-smoke.spec.ts`'s `register → login → dashboard → logout` block already drives the raw `page` and stays untouched, and the `auth-refresh.spec.ts` blocks that assert post-login session/header/cookie state must keep a real `loginViaUi` rather than a restored session (see Scope). Coverage is preserved — the change only removes redundant re-logins from tests whose subject is NOT login; nothing that was asserted stops being asserted.

Estimated impact: avoids the **UI form-fill** for roughly two dozen logins per e2e run (each a `/login` page-load + form fill + click + network round-trip + redirect wait), which is the single biggest e2e wall-clock lever here. Note the saving is form-fill avoidance, **not** login-count elimination — an API-login-per-context approach still pays one (much cheaper, headless) login per context; it just swaps the slow UI flow for a direct endpoint call. `workers: 4` already parallelizes, but each worker still pays the redundant UI login per test today, so the saving compounds across workers. No coverage loss, because the auth-subject tests retain their real login flow.

## Scope / caveats
Touch: `storage.setup.ts` (add the login + `storageState` save), `playwright.config.ts` or `fixtures.ts` (restore the state), and the `userPage` fixture (drop the per-test `loginViaUi` for non-auth tests). Do NOT touch the `auth-smoke.spec.ts` `register → login → logout` block (already raw `page`) or the `auth-refresh.spec.ts` post-login blocks — "tRPC requests include Authorization header" (asserts the in-memory `Authorization` header, which `storageState` cannot restore), "refresh token cookie is present after login" (its subject is that login *produces* the `musi_refresh` cookie), and "logout clears session" — these must keep a real login so the post-login assertion still tests login rather than a pre-seeded session.

`storageState` serializes cookies including the httpOnly `musi_refresh` cookie, so authenticated-redirect tests still pass after the change — e.g. `auth-smoke.spec.ts`'s "/login while authenticated redirects to /dashboard" (which consumes `userPage`) keeps working off the restored cookie. The one nuance to verify when implementing: because the access token is in-memory (`token-store.ts`), a restored context starts without it and the client must refresh it from the cookie on first load; confirm the non-auth tests tolerate that boot-time refresh (they navigate to a page before asserting, so they should). **Critically, that very boot-time refresh is also the rotation hazard above:** `auth.ts` deletes the prior session and issues a *new* `musi_refresh` cookie on every refresh, so the boot refresh is not a benign one-off — it invalidates the cookie that any *other* context shares. This is precisely why a single static project-wide `storageState` cannot be reused across contexts/workers, and why step 2 calls for per-context/per-worker auth (API login per context being the cleanest, since it never depends on a shared rotating cookie).

Low-to-medium risk: the change is config + fixture wiring, with the auth-subject tests fenced off. This finding is DISTINCT from `e2e-fullyparallel-serializes-independent-tests` (finding 4 — that is about the `fullyParallel`/parallelism config; this is about login reuse) and from `e2e-single-user-character-setup-duplicated` (finding 46 — data-setup dedup, not auth). The three are independent levers and can be sequenced in any order, though landing this one first makes the parallelism finding's wins easier to measure (cheaper per-test setup). This finding was merged from a single source (the storageState-reuse observation); no other findings fold into it.
