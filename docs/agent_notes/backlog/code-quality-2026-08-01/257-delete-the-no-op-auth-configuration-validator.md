# 257. Delete the no-op auth configuration validator

Status: Not started
Theme: Delete the no-op validateAuthConfig startup boundary · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`buildServer` appears to perform an explicit auth-configuration validation
step, but `validateAuthConfig` only reads and discards a JWT secret that was
already parsed eagerly when the environment module loaded. The named function
therefore owns no validation rule and cannot catch any configuration state
that survived the real boundary.

That extra layer misstates where startup safety lives. A maintainer looking to
add or review an auth configuration requirement can reasonably choose the
no-op validator instead of the environment schema, splitting future checks
across a false boundary.

## Evidence

- `packages/server/src/config/auth.ts:56-62` — `getJwtSecret` returns the already
  materialized `serverEnv.jwtSecret`; `validateAuthConfig` merely invokes that
  getter and discards its result.
- `packages/server/src/config/env.ts:88-101` — the environment schema requires
  `JWT_SECRET` and enforces its minimum length before producing `serverEnv`.
- `packages/server/src/config/env.ts:179-185` — `loadServerEnv` performs the
  schema parse and throws on invalid input, and the module initializes
  `serverEnv` by calling it eagerly.
- `packages/server/src/app.ts:12,188-195` — `buildServer` imports and invokes
  `validateAuthConfig` before the rest of startup, presenting the no-op as an
  independent bootstrap check.
- `packages/server/src/services/auth-service.ts:6-20,97-103` —
  authentication primitives still consume `getJwtSecret` to encode JWT keys
  and hash refresh tokens, so that getter has real callers independent of the
  no-op validator.

## Proposed direction

Delete `validateAuthConfig` from `config/auth.ts`, remove its import from
`app.ts`, and remove the corresponding `buildServer` call. Make no replacement
startup function: importing `serverEnv` already runs `loadServerEnv`, and that
eager schema parse remains the sole configuration-validation boundary.

Retain `getJwtSecret` and its existing consumers. Keep JWT-secret rules in the
environment schema and keep authentication primitives responsible only for
using the validated value. Preserve the focused environment-schema coverage
for missing, malformed, and production-unsafe values, and update any app test
mock or import that names the deleted export. A typecheck and unused-export
check should be sufficient for the removal itself; authentication behavior
must remain unchanged.

## Scope / caveats

- Do not weaken, defer, or make lazy the environment parse. This proposal
  removes only a redundant read after successful parsing.
- Do not inline the JWT secret into consumers or remove `getJwtSecret`; it
  remains the real access boundary for token signing and refresh-token hashing.
- Do not broaden the change into auth-service naming, token primitives,
  session lifecycle, router workflows, cookies, or authentication policy.
  [205-rename-auth-service-to-reflect-its.md](./205-rename-auth-service-to-reflect-its.md)
  separately covers the service-path rename while preserving those primitives.
- No prior-pack record covers this no-op startup validator.
