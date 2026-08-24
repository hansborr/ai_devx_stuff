# 205. Rename auth-service to reflect its authentication-primitive boundary

Status: Not started
Theme: auth-service is named and catalogued as orchestration although it contains only authentication primitives · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The `auth-service.ts` name and services inventory suggest a request-level
authentication orchestration boundary. The module actually owns cryptographic,
password, timing-oracle, and token primitives, while the auth router coordinates
account and session workflows.

That mismatch sends maintainers looking for lifecycle behavior in the wrong
file and obscures the intentional boundary between reusable authentication
mechanisms and request orchestration.

Bearer-header interpretation is also split across the two authenticated HTTP
boundaries. tRPC context and the upload route each privately define the prefix,
check it, slice the token, and then delegate to the same verifier. Their
scheme, whitespace, or empty-token policies can therefore drift independently
even though they represent one transport-level authentication boundary.

## Evidence

- `packages/server/src/services/auth-service.ts:23-114` — the exported surface
  hashes and verifies passwords, primes the missing-user timing guard, signs
  and verifies access tokens, and generates, hashes, and compares refresh
  tokens; it contains no account or session workflow.
- `packages/server/src/routers/auth.ts:69-98` — the router-local
  `createSessionAndTokens` helper persists the session with request metadata,
  creates the access token, and sets the refresh cookie.
- `packages/server/src/routers/auth.ts:100-341` — registration, login, refresh,
  logout, profile update, password change, and account deletion remain
  coordinated in the router.
- `packages/server/src/services/README.md:198-202` — the service inventory
  lists `auth-service.ts` among flat services.
- `packages/server/src/services/README.md:208-211` — the placement rubric says
  request-level orchestration coordinates reads, writes, and
  post-persistence effects, while narrower helpers belong outside that
  category.
- `packages/server/src/trpc/context.ts:14-20` — the tRPC boundary privately
  declares the exact `Bearer ` prefix and extracts the remaining header
  substring.
- `packages/server/src/routes/upload-routes.ts:49-68` — the upload boundary
  repeats the prefix declaration, prefix check, slicing, and call to
  `verifyAccessToken`.

## Proposed direction

Rename `packages/server/src/services/auth-service.ts` to
`auth-primitives.ts`, and rename its colocated test to match. Update production
imports, test imports, mock paths, and comments that name the old module in the
same change.

Update both references in `packages/server/src/services/README.md` (reproduced
with `rg -n 'auth-service\.ts' packages/server/src/services/README.md`) so the
examples and inventory describe `auth-primitives.ts` accurately rather than
presenting it as request-level orchestration. Keep the existing exported
function names and implementations unchanged, and retain focused coverage for
password, timing-oracle, JWT, and refresh-token behavior under the new module
path.

After the module names settle, add one neutral Bearer-token extractor and use
it in both `createContext` and upload authentication before calling
`verifyAccessToken`. Place the transport parser in a cycle-free auth-header
helper rather than forcing it into `auth-primitives.ts` if doing so would blur
that module's cryptographic focus.

Define and test the existing policy explicitly: accept only the exact
case-sensitive `Bearer ` prefix, return no token for missing, malformed, or
empty headers, and do not trim, case-fold, or otherwise normalize token bytes
before verification. Add focused cases for a valid header, absent header,
wrong scheme or casing, missing separator, empty token, and extra whitespace.
Keep the upload route's HTTP status and reply mapping local to that route.

## Scope / caveats

- Do not extract registration, session rotation, logout, password-change, or
  account-deletion workflows from the router.
- Do not alter authentication behavior, token formats, cookie behavior,
  timing-oracle protection, or any existing exported function. The one API
  addition permitted here is the named shared Bearer-token extractor.
- Avoid a runtime route/context cycle. The shared extractor must be a neutral
  transport helper consumed by both boundaries, not owned by either caller.
- Preserve the upload route's REST-specific unauthorized reply behavior; only
  header interpretation and token extraction are shared.
- Coordinate the `services/README.md` edit with
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md)
  if the two leaves are implemented nearby; that leaf changes the same
  inventory for character creation but does not cover this rename.
- No prior-pack record covers either the naming or Bearer-header residual.
