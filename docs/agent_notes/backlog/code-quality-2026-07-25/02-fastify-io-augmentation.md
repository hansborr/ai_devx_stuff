# 02. The Socket.IO decorator is untyped, so a rename would silently disable every broadcast

Status: Proposed — not promoted
Theme: Framework typing seams · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`app.ts` attaches the Socket.IO server to Fastify with `server.decorate("io", io)`, but no
`declare module "fastify"` augmentation exists anywhere in the repo — a repo-wide search for
one returns zero hits. The decorator is therefore invisible to the type system, and the
consequence is concrete rather than aesthetic:

`utils/socket-helpers.ts` reaches the decorator through a runtime string probe —
`if (server && typeof server === "object" && "io" in server)` — and returns `null` when the
probe fails. Rename the decorator key, or drop the `decorate` call, and **nothing fails to
compile**: `getSocketIO` starts returning `null` forever and every broadcast in the app goes
quietly dead at runtime. The one thing that should catch this is exactly what was traded away.

The same untyped `server` value propagates outward. Ten declarations across nine files hold the
Fastify instance as bare `unknown` — six as `readonly req: { readonly server: unknown }` inside
service context types, one as a non-readonly `req: { server: unknown }`
(`services/rest-service.ts:143`), one as a plain `server: unknown` field on an opts bag
(`utils/combat-chat.ts:12`), and two as bare `server: unknown` parameters. Because `unknown`
carries no members, `utils/combat-chat.ts` has to re-derive Fastify's logger at runtime too: a
private `WarnLogger` interface and a nine-line `hasWarnLogger` type guard exist solely to prove
that `server.log.warn` is callable — something `FastifyInstance` already states statically.
`utils/character-campaign.ts:70` pays the same toll with a `framework`-marked cast to a local
`ServerWithLog` shape, and `services/map-tokens/types.ts:27-34` pays it a third time by
re-declaring `req.server` as `{ log: { warn(fields, message): void } }` for the map-delete path.

## Evidence

- `packages/server/src/app.ts:254` — `server.decorate("io", io)`, the only reference to the
  `"io"` key in the file
- `packages/server/src/app.ts:249-255` — the decoration is inside
  `if (opts.enableSocketIO !== false)`, so at the type level the property is genuinely optional
- repo-wide `declare module "fastify"` — zero occurrences
- `packages/server/src/utils/socket-helpers.ts:3-9` — `getSocketIO(server: unknown)`, the
  `"io" in server` probe, and the `framework`-marked cast at `:6`
- `packages/server/src/utils/combat-chat.ts:24-46` — `WarnLogger` interface, `hasWarnLogger`
  guard, `warnCombatChatFailure`
- `packages/server/src/utils/character-campaign.ts:26-28,67,70` — the `ServerWithLog` interface,
  `getSocketIO(ctx.req.server)`, and the `framework` cast
- Ten `server: unknown` declarations across nine files. Six as `readonly req: { readonly server:
  unknown }`: `services/encounter-combat/types.ts:8`, `services/character-live-state/types.ts:7`,
  `services/inventory-service.ts:60`, `services/weapon-mastery-service.ts:23`,
  `services/map-tokens/types.ts:17`, `utils/character-campaign.ts:32`. One as non-readonly
  `req: { server: unknown }`: `services/rest-service.ts:143`. One as a plain field on an opts
  bag: `utils/combat-chat.ts:12`. Plus bare params at `services/rest-service.ts:119` and
  `services/rest-encounter-attribution.ts:37`
- `packages/server/src/services/map-tokens/types.ts:27-34` — `MapDeleteServiceContext`
  re-narrows `req.server` to `{ readonly log: { warn(fields, message): void } }`, a hand-rolled
  partial of the port step 4 defines; `services/map-tokens/map-cascade.ts:47` dereferences
  `ctx.req.server.log.warn` through it unconditionally
- Twenty test contexts pass a server value that is not a Fastify instance: 18 write `server: {}`
  (e.g. `services/inventory-service.test.ts:108`, `utils/combat-chat.test.ts:27`) and two write
  `server: undefined` (`services/map-tokens/link-conflict.test.ts:189`,
  `services/map-tokens/empty-string-semantics.test.ts:214`).
  `packages/server/src/services/inventory-service.ts:52-55` documents why: "The full tRPC
  `Context` is structurally assignable; the narrow shape keeps the service callable from tests
  without a full Fastify request"
- `packages/server/src/trpc/context.ts:41` — `req: CreateFastifyContextOptions["req"]`, i.e.
  `ctx.req.server` is already a typed `FastifyInstance` at the tRPC boundary; routers call
  `ctx.req.server.log.warn` directly (`routers/cast-spell.ts:96`, `routers/map.ts:109`)
- `packages/server/src/socket/MODULE.md:31` — documents `getSocketIO(server)`'s signature as an
  external entry point of the socket module
- `packages/server/node_modules/fastify/types/instance.d.ts:98-113` — `DecorationMethod`
  declares `P extends string | symbol` and `T extends (P extends keyof This ? This[P] :
  unknown)`. An augmentation therefore constrains only the *value* passed for a key it knows
  about; an unrecognised key falls into the `unknown` arm and still compiles. This is why the
  augmentation on its own does not make a decorator rename a type error (see step 2)

## Proposed direction

1. **Add the module augmentation.** One new declaration file in `packages/server/src`
   (e.g. `types/fastify.d.ts` or a `declare module "fastify"` block beside `app.ts`) adding
   `io?: AppSocketServer` to `FastifyInstance`. It **must be optional** — `app.ts:249` only
   decorates when `opts.enableSocketIO !== false`, and a non-optional declaration would be a
   type-level lie in every test that disables sockets. This makes `server.io` a typed member
   for readers and constrains the *value* passed to `decorate("io", …)`. It does **not**, on
   its own, catch a rename of the key; step 2 is what does that, and the two belong in one
   commit.
2. **Pin the decorator key in a typed constant, and decorate through it.** Fastify's
   `decorate` is `DecorationMethod<This>` with `P extends string | symbol`
   (`fastify/types/instance.d.ts:98`), so `server.decorate("ixo", io)` compiles even with the
   augmentation in place — the unknown key resolves `T` to `unknown` and accepts any value,
   while every reader still says `server.io`. Add one small module (e.g.
   `packages/server/src/socket/io-decorator.ts`) exporting

   ```ts
   export const IO_DECORATOR_KEY: Extract<keyof FastifyInstance, "io"> = "io";
   ```

   and change `app.ts:254` to `server.decorate(IO_DECORATOR_KEY, io)`. Now a changed literal
   fails against the annotation, and a deleted or renamed augmentation collapses
   `Extract<…>` to `never` and fails the assignment — the rename is a compile error in both
   directions. Keep the constant beside the augmentation itself so the declared member, the
   annotation and the decorate call are one edit unit and cannot drift apart.
3. **Cover the one case types cannot catch, with a test.** Because `io` must stay optional,
   deleting the `decorate` call entirely is still not a type error — readers just get
   `undefined` forever, which is exactly the failure this leaf is about. Add two assertions
   to `packages/server/src/app.test.ts`: a server built with sockets enabled exposes `io`,
   and one built with `enableSocketIO: false` does not. Cheap, and it is the only mechanism
   that closes the deletion case.
4. **Decide the service-layer contract explicitly** — this is the design question, and it must
   be answered before step 5. The `unknown` is deliberate decoupling, not an oversight (see
   caveats). The recommended answer is a minimal server-side port rather than `FastifyInstance`:
   define one interface in the server package, which an augmented `FastifyInstance` satisfies
   structurally with no import from Fastify in any service file.

   ```ts
   interface BroadcastHost {
     readonly io?: AppSocketServer;
     readonly log?: { warn(obj: object, msg: string): void };
   }
   ```

   Both members must be optional, and the declarations retyped in step 5 must read
   `BroadcastHost | undefined`. Eighteen test contexts pass `server: {}` and two pass
   `server: undefined`, and `inventory-service.ts:52-55` states that the narrow shape exists so
   services stay callable from tests without a full Fastify request. A required `log`, or a
   non-optional `server`, turns all twenty into type errors and breaks that seam.

   `services/map-tokens/types.ts:27-34` (`MapDeleteServiceContext`) already hand-rolls the log
   half of this port. Express it as a `log`-required narrowing of `BroadcastHost` —
   `map-cascade.ts:47` dereferences `log` unconditionally, so the requirement is real — rather
   than leaving two competing structural shapes behind, which is the duplication this leaf
   exists to end.
5. **Retype the ten `server: unknown` declarations (nine files) to `BroadcastHost | undefined`**
   and narrow `getSocketIO(server: BroadcastHost | undefined): AppSocketServer | null` to a
   plain `server?.io ?? null`. The `"io" in server` probe and the `framework` cast at
   `socket-helpers.ts:6` both disappear; update the signature documented at
   `socket/MODULE.md:31` in the same commit.

   All 32 `getSocketIO(ctx.req.server)` call sites keep compiling unchanged, for two different
   reasons: the 18 under `routers/` because `ctx.req.server` is already a `FastifyInstance` that
   satisfies the port structurally, and the 14 under `services/` and `utils/` because their
   `ctx` types are the declarations this step is itself retyping. The three call sites that pass
   a bare service-level `server` value — `utils/combat-chat.ts:89` (`opts.server`),
   `services/rest-service.ts:124`, and `services/rest-encounter-attribution.ts:42` — are covered
   by the same retype of the two bare `server: unknown` params.

   One test fake needs adjusting: `services/encounter-combat/participant-action.test.ts:446`
   passes a raw `{ io: { to: vi.fn(() => ({ emit })) } }`, which only compiles today because
   `server` is `unknown`. Give it the `as unknown as AppSocketServer` the other io fakes already
   use (`services/character-live-state/encounter-attribution.test.ts:18`).
6. **Delete `WarnLogger` and `hasWarnLogger`** (`utils/combat-chat.ts:24-38`), rewriting
   `warnCombatChatFailure`'s body as `server?.log?.warn(…)`, and delete the `ServerWithLog`
   interface and cast (`utils/character-campaign.ts:26-28,70`) now that `log` is statically
   present and the call at `:71` is already optional-chained. Keep `warnCombatChatFailure`'s
   swallow-and-log behaviour exactly as it is — the guard was buying types, not implementing a
   fallback policy.

## Scope / caveats

- **Do NOT retype the service contexts as `{ req: { server: FastifyInstance } }`.** That is the
  obvious refactor and it is the wrong one: it re-couples every one of those nine files (seven
  under `services/`, two under `utils/`) to Fastify, and the `unknown` is a deliberate
  service-layer decoupling. `trpc/context.ts:41` already types `req` as
  `CreateFastifyContextOptions["req"]`, so routers *do* have a real `FastifyInstance`; the
  widening to `unknown` happens on purpose as values cross into `services/`. Step 4's port
  interface is what preserves that boundary while still recovering the types.
- **The augmentation alone does not solve the headline problem — do not stop after step 1.**
  `decorate`'s key parameter is `P extends string | symbol`, so an augmented
  `FastifyInstance` still accepts `server.decorate("ixo", io)` without complaint. Steps 1-3
  are one unit of work: the augmentation types the readers, the pinned key catches a rename,
  and the `app.test.ts` assertions catch a deletion. Landing step 1 by itself buys editor
  completion on `server.io` and nothing else.
- **Steps 5 and 6 depend on step 4.** The augmentation alone does not remove the cast in
  `getSocketIO`, because narrowing an `unknown`-typed parameter with `"io" in server` still
  cannot produce `AppSocketServer`. If the team decides against step 4, stop after step 3 —
  that is a real, self-contained win, not a partial failure.
- **The optionality of `io` is load-bearing** and must survive: tests and any deployment path
  that sets `enableSocketIO: false` run without the decorator, which is why `getSocketIO`
  returns `null` rather than throwing. Do not "tighten" it to a required property once the
  augmentation exists.
- `packages/server/src/services/README.md:79-137` is the rubric step 4 must satisfy — it defines
  the two legitimate service context shapes and assigns the post-commit broadcast to the
  request-facing `(ctx, input)` service, so the port has to stay usable from a shape-1 `ctx`
  without dragging Fastify into it. `docs/socket-architecture.md` is background on
  broadcast-after-persistence only; it says nothing about the decorator, `getSocketIO`, or the
  `server: unknown` seam. Read `docs/guides/add-socket-broadcast.md` if any broadcast helper
  signature moves, and
  `docs/guides/local-eslint-rules.md#type-assertion-boundary-marker` because steps 5-6 delete
  `framework` markers.
- **Overlaps leaf 01 in `services/inventory-service.ts` only.** Step 5 rewrites the
  `readonly req: { readonly server: unknown }` declaration at `:60`; leaf 01 retypes the
  where-clause at `:148` and the update helper at `:171`. Different hunks, so a plain merge
  resolves it and no ordering is required. No other dependency on leaves in this pack.
- A correctly marked cast emits no lint message
  (`eslint-rules/type-assertion-boundary.js:270` returns before `context.report`), so
  `ratchet/local-type-assertion-boundary` carries an empty `items` map in
  `lint-ratchet.baseline.json` and deleting markers here moves no ratchet count.
