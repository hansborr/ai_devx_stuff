# 16. Presence and session cleanup accept the unrestricted generated Prisma client although each needs exactly one delegate, bypassing the compile-time `DbClient` boundary

Status: Not started
Theme: narrow database ports · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`DbClient` in `packages/server/src/utils/prisma-types.ts` is the server's
declared business boundary over Prisma: gated direct writes are banned,
`$transaction` callbacks are narrowed, and raw-returning `$extends` is omitted.
Its companion `toDbClient` is documented as *the* single greppable narrowing
point, so an auditor can enumerate every place production code crosses from the
raw client into the restricted shape.

Two production consumers sit outside that story entirely.
`createPresenceService` and `cleanExpiredSessions` each need exactly one
delegate method — `campaignMember.updateMany` and `session.deleteMany`
respectively — yet both type their parameter as the raw generated
`PrismaClient`, statically granting every delegate plus `$extends` and the
unrestricted `$transaction`. The runtime nested-write guard is still installed
(both callers pass the guarded singleton built by `createPrismaClient`), so
nothing misbehaves today; the gap is purely compile-time. But that is exactly
the layer `DbClient` exists to close: the one-place `toDbClient` audit silently
misses these two paths, and a contributor adding the next small service has two
in-tree precedents that say importing the generated client type directly is
normal. In a repo meant to be copied as a harness-engineering reference, the
easy-to-copy exception undermines the auditable-boundary pattern more than the
two files themselves do.

## Evidence

- `packages/server/src/services/presence-service.ts:5` — imports
  `PrismaClient` directly from `../generated/prisma/client.js`.
- `packages/server/src/services/presence-service.ts:72` —
  `createPresenceService(io: AppSocketServer, prisma: PrismaClient)`; the only
  database use in the factory is `prisma.campaignMember.updateMany` at `:80`.
- `packages/server/src/utils/session-cleanup.ts:1-8` — the whole file:
  `cleanExpiredSessions(prisma: PrismaClient)` at `:3`, and its only database
  use is `prisma.session.deleteMany` at `:4`.
- `packages/server/src/utils/prisma-types.ts:163-171` — `DbClient` (doc comment
  `:163-167`, type `:168-171`): omits the restricted delegates, `$transaction`,
  and `$extends`, then re-adds restricted delegates and a `SafeTransactionFn`.
- `packages/server/src/utils/prisma-types.ts:173-181` — the `toDbClient`
  docblock names `trpc/context.ts` and `routes/upload-routes.ts` as the only
  production narrowings and `test/test-db.ts` as the test one, and says the
  boundary "can be audited in one place". The two files above are invisible to
  that audit because they never narrow at all.
- `packages/server/src/utils/prisma-types.ts:124-130` — `RestrictedDelegates`
  lists `characterStats`, `encounterParticipant`, `encounter`,
  `characterSpellSlot`, `characterClass`. Neither `campaignMember` nor
  `session` is restricted, so both delegates pass through `DbClient`'s `Omit`
  unchanged — which is what makes the fix below cast-free.
- `packages/server/src/utils/prisma-types.ts:137-140` — `RawWriteClient` is
  already `Pick<RawTxClient, DelegateName>`: the in-file precedent for
  single-delegate structural ports.
- Runtime guard intact at both call sites: `packages/server/src/socket/index.ts:61`
  and `packages/server/src/app.ts:247` pass the `prisma` singleton from
  `packages/server/src/prisma/client.ts:12`, built by `createPrismaClient`
  (`packages/server/src/prisma/create-client.ts:31-34`), which installs the
  nested-write guard via `$extends`. Only the static type is over-wide.
- `packages/server/src/services/presence-service.test.ts:72` and `:97` — mock
  clients cast `as unknown as PrismaClient`; a one-delegate port would make the
  `:72` mock a plain object literal.

## Proposed direction

Narrow the two signatures to minimal structural ports; do **not** widen them to
full `DbClient`.

1. In `packages/server/src/services/presence-service.ts`, change
   `createPresenceService` to accept `Pick<DbClient, "campaignMember">`,
   importing `type DbClient` from `../utils/prisma-types.js` and dropping the
   direct generated-client import at `:5`.
2. In `packages/server/src/utils/session-cleanup.ts`, change
   `cleanExpiredSessions` to accept `Pick<DbClient, "session">`, importing
   `type DbClient` from `./prisma-types.js` and dropping the generated-client
   import at `:1`.

Why this shape works with zero call-site changes: neither `campaignMember` nor
`session` is in `RestrictedDelegates` (`prisma-types.ts:124-130`), so both
delegates pass through `DbClient` unmodified and the runtime-guarded raw client
held by both callers (`socket/index.ts:61`, `app.ts:247`) is structurally
assignable to the ports — no casts, and no new `toDbClient` narrowing sites
(the docblock at `prisma-types.ts:173-181` enumerates the sanctioned sites and
would otherwise need extending). The shape mirrors the existing
`RawWriteClient = Pick<RawTxClient, DelegateName>` pattern at
`prisma-types.ts:137-140`.

Name the port only if it gets reused (e.g.
`type PresenceDb = Pick<DbClient, "campaignMember">`); inline `Pick` is fine
for a single use. While there, simplify the test mock casts in
`presence-service.test.ts:72` and `:97` to the port types instead of
`as unknown as PrismaClient`.

Do **not** take the full-`DbClient` alternative: typing the parameters as
`DbClient` re-grants every delegate in miniature, and because the callers hold
the raw client it would force two new `toDbClient` call sites plus churn in the
enumerated-sites docblock. The `Pick` ports compile as-is.

Verification is the focused suites beside each file:
`bun run test -- packages/server/src/services/presence-service.test.ts` and
`bun run test -- packages/server/src/utils/session-cleanup.test.ts` (the latter
passes the real guarded singleton from `prisma/client.js`, which exercises the
assignability claim directly).

## Scope / caveats

- **Out of scope:** any change to `DbClient`, `toDbClient`, or
  `RestrictedDelegates` themselves; any runtime behavior; the callers'
  `prisma` plumbing in `app.ts` / `socket/index.ts` (both compile unchanged by
  construction). Adding `campaignMember` or `session` to the restricted set is
  a separate policy question, not this leaf.
- Do not add new `toDbClient` call sites or extend its enumerated-sites
  docblock — the whole point of the `Pick`-port arm is that neither is needed.
- `packages/server/src/socket/MODULE.md` does not document the `prisma`
  parameter of the socket setup, so no module-doc carry is needed.
- Prior pack: CQ25-102 (standing ruling in
  [`code-quality-2026-07-25/CONSTRAINTS.md`](../code-quality-2026-07-25/CONSTRAINTS.md))
  established the narrow-port shape for Fastify request/socket contexts — the
  `BroadcastHost` port landed instead of retyping contexts against Fastify.
  That ruling is an analog, not an overlap: it covers transport ports, this
  leaf applies the same discipline to database ports. Prior-pack leaves 50/60
  (both Done) fixed delegate gating and construction-site factories but never
  narrowed these two consumer signatures, and CQ25-101's ban on raw-client
  factories/bypasses points the same direction as this change.
- No sequencing edges: no other leaf in this pack edits these three files'
  signatures.
