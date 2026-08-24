# 2. Request and socket boundaries capture the production Prisma singleton at module load, so `buildServer` composes dependencies it never actually provides

Status: Not started
Theme: composition-root dependency injection · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`buildServer` looks like the server's composition root — it registers routes,
constructs the tRPC plugin, starts Socket.io, and schedules session cleanup —
but three of the boundaries it assembles have already chosen their database
dependency before `buildServer` runs. The upload route module, the tRPC context
module, and the campaign-room socket handler each import the Prisma singleton
at module load and use it directly. The signatures lie in both directions:
`BuildServerOptions` is a bag of feature flags with no dependency slot, and
`registerUploadRoutes(server)` / `registerCampaignRoomHandlers(io, socket,
presenceService)` read as if they had no database dependency at all, while the
one collaborator that *is* injected (`PresenceService`) sits right next to a
hidden global reach in the same function.

The cost is not test unblocking — the suites run against real per-worktree
Postgres and never mock these modules — it is signature honesty and
copyability. A contributor reading `buildServer` cannot see where the database
enters the system; alternate construction (a second server against a different
client, an embedded harness copy) requires module replacement rather than an
argument; and the repo's own convention already points the other way:
`createPresenceService(io, prisma)` and `cleanExpiredSessions(prisma)` take
the client as a parameter, and the prior audit's socket cleanup landed injected
socket collaborators. This leaf finishes that pattern for the three remaining dependency boundaries,
which span four module-load capture sites.

## Evidence

- `packages/server/src/routes/upload-routes.ts:34` imports the singleton and
  `:43` binds `const db = toDbClient(prisma)` at module scope (with the
  sanctioned narrowing comment at `:40-42`);
  `registerUploadRoutes(server: FastifyInstance)` at `:134` takes no database
  argument. `packages/server/src/app.ts:185` calls it as
  `registerUploadRoutes(server)`.
- `packages/server/src/trpc/context.ts:3` imports the singleton at module
  scope; `createContext` narrows it per-request at `:56`
  (`prisma: toDbClient(prisma)`), and `app.ts:221` passes `createContext` by
  reference into `fastifyTRPCPlugin` — no seam for a different client.
- `packages/server/src/socket/campaign-room-handler.ts:14` imports the
  singleton and uses it for membership re-validation in the heartbeat handler
  (`:39-42`) and in `campaign:join` (`:78-80`), while the same functions take
  `PresenceService` as an injected parameter (`:26`, `:63`) — one collaborator
  injected, the other reached for globally, in the same signatures.
- `packages/server/src/app.ts:153-159` — `BuildServerOptions` is
  `logger`/`enableSessionCleanup`/`enableRateLimit`/`enableSocketIO`/`corsOrigin`
  only; no dependency slot exists.
- `packages/server/src/socket/index.ts:8` imports the singleton;
  `:61` passes it into `createPresenceService(io, prisma)` (the injected
  convention), but `:72` forwards only the rate limiter and presence service
  into `registerConnectionHandler`, whose signature
  (`socket/connection-handler.ts:6-10`) and forwarding call (`:22`) have no
  database parameter — so the room handler has no choice but the global.
- `packages/server/src/app.ts:247` — `cleanExpiredSessions(prisma)` and
  `socket/index.ts:61` already demonstrate the parameter-passing convention
  this leaf extends.
- Measured at the pin: 116 files in `packages/server/src` value-import
  `prisma` from `prisma/client.js`; 111 are `*.test.ts` / `*-test-helper.ts` /
  `src/test/**` files. The five production sites are `app.ts:14` (the
  composition root) plus the four capture sites above
  (`upload-routes.ts:34`, `trpc/context.ts:3`, `campaign-room-handler.ts:14`,
  `socket/index.ts:8`).
- `packages/server/src/utils/prisma-types.ts:173-181` — the `toDbClient` doc
  comment enumerates the production narrowing sites by filename
  (`trpc/context.ts`, `routes/upload-routes.ts`); it must move with them.
- `packages/server/src/app.test.ts:156` and `:268` import `createContext`
  directly (used at `:171`, `:282`), so "tests are untouched" is false for
  this file specifically.
- Negative findings that bound the fix: `handleDisconnect`
  (`campaign-room-handler.ts:136-166`) touches no Prisma — only
  `presenceService` and `fetchSockets`; and
  `services/auth-service.ts:1-12` imports only `node:crypto`, `bcryptjs`,
  `jose`, auth config, and a type — it captures no Prisma state, so the
  original observation that these boundaries capture "the auth service" is
  inaccurate and `verifyAccessToken` needs no injection.

## Proposed direction

Finish the injection pattern the prior pack's socket cleanup started, via
plain parameter injection at the existing composition roots — no DI container,
no new port interfaces beyond the existing `PrismaClient`/`DbClient` surfaces,
no auth-function injection. Hard requirement throughout: `main.ts`,
`test/app-helper.ts`, and `test/socket-helper.ts` stay byte-identical (all
three call `buildServer` without a client — `main.ts:7`, `app-helper.ts:7`,
`socket-helper.ts:36`); assert this with `git diff` on those paths before each
slice lands. The payoff is signature honesty, not test changes.

1. **HTTP path** (one slice). `BuildServerOptions` gains a flat optional
   `prisma?: PrismaClient` (not a nested deps bundle), resolved exactly once
   in `buildServer` — `const prismaClient = opts.prisma ?? prisma;` — with a
   short comment stating the rule: production defaults are resolved only at
   the composition root; every interior signature is required. `buildServer`
   derives `const db = toDbClient(prismaClient)` (carrying the sanctioned
   narrowing comment and its `docs/CONCURRENCY.md` reference, currently at
   `upload-routes.ts:40-42` / `context.ts:47-54`) and feeds it to:
   - `registerUploadRoutes(server, db: DbClient)` — delete the module-level
     binding at `upload-routes.ts:40-43` and the singleton import at `:34`;
     keep `verifyAccessToken` as a direct import.
   - A tRPC context factory: convert `trpc/context.ts` to
     `createContextFactory({ db }: { db: DbClient })` returning the
     `CreateFastifyContextOptions` handler; `app.ts` constructs it where it
     registers `fastifyTRPCPlugin` (`:217-231`). Promote the inline return
     type (`context.ts:37-43`) to an explicit exported `Context` interface
     with the handler annotated `Promise<Context>`, so the five existing
     type importers (`trpc/trpc.ts:6`, `routers/auth.ts:31`,
     `routers/cast-spell.ts:11`, `utils/srd-query-helpers.ts:5`,
     `services/auth-service.ts:12` for `SessionUser`) stay untouched.
     Update `app.test.ts:156`/`:268` to adopt the factory.
   - `cleanExpiredSessions(prismaClient)` at `app.ts:247`.
   In the same slice: update the `prisma-types.ts:173-181` doc comment to name
   the composition roots instead of the old narrowing sites, and update
   `routes/MODULE.md`'s data-flow prose.
2. **Socket path** (one slice). `SetupSocketIOOptions`
   (`socket/index.ts:15-18`) gains a **required** `prisma: PrismaClient` — no
   default; `buildServer` is the sole defaulting site and passes
   `prismaClient` at `app.ts:235-238`. `socket/index.ts` drops its singleton
   import (`:8`), keeps `createPresenceService(io, opts.prisma)` unchanged in
   shape, derives `const db = toDbClient(opts.prisma)` beside presence
   creation, and threads `db` (as `DbClient`, not the raw client — least
   authority; `campaignMember` is not a restricted delegate in
   `prisma-types.ts:124-130`, so `findFirst` typechecks) through
   `registerConnectionHandler` (`connection-handler.ts:6-10`, forwarding at
   `:22`) into `registerCampaignRoomHandlers` and `registerHeartbeatHandler`,
   replacing the global reads at `campaign-room-handler.ts:39` and `:78` and
   deleting the import at `:14`. `handleDisconnect`'s signature does **not**
   change. Update `socket/MODULE.md`'s data-flow lines.
3. **Optional enforcement slice.** Once production importers of the singleton
   collapse to `app.ts`, add a lint restriction (following
   `docs/guides/lint-ratchet.md` and registering any new config file per
   `eslint-config/config-surface-manifest.json`) allowing `prisma/client.js`
   value imports only from the composition root, test surfaces, and
   seeds/scripts. Calibrate the allowlist against the measured reality first:
   the 111 test importers are `*.test.ts` and `*-test-helper.ts` files spread
   across `routers/`, `services/`, `utils/`, `socket/`, and `test/` — an
   allowlist limited to `src/test/**` would flag over a hundred files.

Slices 1 and 2 are independently landable; land them as two pieces plus the
optional third, not four per-boundary fragments and not one monolith — the
combined implementation is M-sized despite this leaf's L label, which prices
in the doc and enforcement surfaces.

## Scope / caveats

- **Binding rulings** from review of this direction:
  - Do not inject `verifyAccessToken` or any auth-service function — it
    captures no Prisma state; keep direct imports.
  - Do not create a "room membership port", any new port interface, or a DI
    container — plain parameter injection with the existing
    `PrismaClient`/`DbClient` types, matching the presence-service and
    `cleanExpiredSessions` convention.
  - Do not change `handleDisconnect`'s signature
    (`campaign-room-handler.ts:136-166` touches no Prisma); thread `db` only
    into `registerCampaignRoomHandlers` and `registerHeartbeatHandler`.
  - Do not put a singleton default anywhere below `buildServer`: resolve
    `opts.prisma ?? prisma` exactly once there;
    `SetupSocketIOOptions.prisma` and every interior parameter are required,
    not optional.
  - Do not use a nested deps bundle on `BuildServerOptions` — a flat
    `prisma?: PrismaClient`; introduce a bundle only when a second injectable
    dependency actually exists.
  - Do not hand the raw write-capable `PrismaClient` to the room handlers —
    narrow to `DbClient` at the socket composition root; presence-service
    keeps the raw client unchanged.
  - Do not claim test surfaces are untouched — `app.test.ts:156`/`:268` must
    adopt the factory; `main.ts`, `test/app-helper.ts`, and
    `test/socket-helper.ts` must stay byte-identical (assert via `git diff`).
  - Do not move the `toDbClient` narrowing without updating the
    `prisma-types.ts:173-181` comment that enumerates narrowing sites by
    filename, alongside the `routes/MODULE.md` and `socket/MODULE.md`
    updates.
  - Do not split into four per-boundary slices or land as one L monolith —
    two implementation slices plus the optional lint-enforcement slice.
- **Out of scope:** changing which client presence-service receives, the
  upload route's REST error-mapping conventions (see the header at
  `upload-routes.ts:1-29` — that behavior is deliberate), tRPC middleware, and
  any broader service-layer injection beyond the three capture sites.
- **Prior pack:** the 2026-07-25 pack's
  [02-fastify-io-augmentation.md](../code-quality-2026-07-25/02-fastify-io-augmentation.md)
  (landed 2026-07-28) covered socket decorator typing and the `BroadcastHost`
  port — injected socket *collaborators*, not composition-root database
  injection — and left the room handler's global untouched. This leaf is the
  complement; do not reopen that leaf's recorded decisions. No ruling in that
  pack's plan or constraints opposes injecting the client at
  `buildServer`/`setupSocketIO`.
- Leaf 205 renames the auth-primitives import and consolidates Bearer-header
  extraction in `upload-routes.ts` and `trpc/context.ts`, while this leaf
  refactors both request boundaries for database injection. Either order works,
  but do not implement the two leaves concurrently. Slice 3 depends on slices 1
  and 2 having landed (the restriction is only satisfiable once production
  importers collapse to the composition root).
- Read `docs/CONCURRENCY.md` before touching the narrowing sites — the
  `toDbClient` boundary is the sanctioned escape hatch it documents — and
  `docs/guides/lint-ratchet.md` before slice 3.
