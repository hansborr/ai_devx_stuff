# 41. The client's tRPC test mock is a 603-line untyped shadow router that silently returns `undefined` when the real router changes

Status: Superseded by [`41-PLAN.md`](./41-PLAN.md). **Slices 41.1 and 41.2 are
implemented; 41.3 remains optional and is not scheduled.** Leaf steps 4 and 6
and the input-parsing generalization are dropped permanently and must not be
re-scheduled from this leaf. **Partly pre-applied by merge `ec4d732c4`:**
`srd.listSpells` alone now parses its input with the router's shared schema and
withholds fixture `initialData` when `enabled === false`. This is a required I3
test pin, not a piecemeal implementation plan for this leaf; see the note below.
Theme: typed test doubles · Area: tests · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Post-audit partial hardening (pinned to `ec4d732c4`, current `main`)

`packages/client/src/test/mock-trpc.tsx:83-100` now makes two behaviours real for
`srd.listSpells`: an input the router's own `listSpellsInputSchema` rejects also
fails the client test, and a query disabled with the boolean literal `false`
does not receive fixture data. Without both, I3's new tests were false pins: the
mock accepted an illegal `classId` and returned spells even when the component
had deliberately chosen not to ask.

That hardening is accepted in place, with its blast radius explicit. A future
client test now fails if it builds a `listSpells` filter the router rejects or
reads data from a query it disabled; those failures expose a mismatch rather
than preserve a compatibility surface. The file is now 616 lines rather than
the 603 measured below, so that count and its downstream line anchors are stale.

**Do not grow this pattern one query at a time.** This leaf already owns the
mock's router binding, domain split and loud failure semantics. Any broader
input parsing or TanStack option emulation belongs in that harness-sized pass,
with shared helpers and cross-query tests, rather than another production slice.
In particular, two proposed follow-ups were correctly declined here: comparing
`enabled` to `true`, or evaluating function-valued `enabled`. TanStack Query v5
accepts a function, but neither affected component produces one, so adding
partial emulation would create a branch with no caller and still would not make
the mock a faithful Query observer.

## Problem

`packages/client/src/test/mock-trpc.tsx` is a hand-maintained double for most of
the server router, and nothing connects it to the router it imitates. The file is
603 lines, `buildTRPCMock` assembles 25 namespace mocks plus one inline `auth`
object, and every one of them threads through
`AnyRecord = Record<string, unknown>`. The string `AppRouter` does not appear
anywhere in `mock-trpc.tsx` or in its 212-line `mock-trpc-helpers.ts`.

It is not a copy of the *entire* router, and that distinction matters for the
fix: `appRouter` has 27 namespaces and the mock supplies 26, deliberately
omitting `health` (nothing in the client renders it). Any direction that makes
the mock exhaustive over the router is therefore wrong — the goal is that what
the mock *does* supply is checked, not that it supplies everything.

The failure mode is concrete: the mock can keep a namespace or procedure key the
server no longer has, or lack one the server gained, and it still compiles. The
component under test reaches `trpc.character.somethingRenamed`, gets `undefined`
at render time, and the test either fails with an unrelated null-deref deep
inside a component or — worse — passes because the component's empty state
happens to render. There is no type error on the mock side and no runtime signal
that the double has drifted from the thing it doubles.

The same file is also stuck partway through its own documented refactor.
`packages/client/src/test/MODULE.md:30-31` already describes the intended shape:
"`mock-trpc.tsx` + `mock-trpc-control.ts` + per-router `mock-trpc-encounter` /
`-invite` / `-map` / `-monster` / `-magic-item`". Only 9 of the 25 builders
actually live in domain modules; the other 16 are still defined inline,
including an ~82-line `buildHomebrewMock`. So the file that most needs to be
checked against the router is also the one that is hardest to read, and the two
problems compound: a 603-line untyped blob is exactly where drift hides.

These are one piece of work with one cause — the mock was never wired to its
source of truth — and they have a natural order, because splitting first makes
the typing pass reviewable file by file instead of as one enormous diff.

## Evidence

- `packages/client/src/test/mock-trpc.tsx` — 603 lines; zero occurrences of
  `AppRouter`.
- `packages/client/src/test/mock-trpc-helpers.ts:16` — `export type AnyRecord =
  Record<string, unknown>`, the untyped spine every builder threads through. 212
  lines, also with zero `AppRouter` references.
- `packages/client/src/test/mock-trpc.tsx:516` — `buildTRPCMock(state, options)`
  assembles exactly 25 `build*Mock(...)` calls plus one inline `auth` object.
- 16 builders still defined in-file: `buildSrdMock` (`:72`),
  `buildCharacterMock` (`:121`), `buildCampaignMock` (`:149`), `buildNoteMock`
  (`:167`), `buildChatMock` (`:220`), `buildNpcMock` (`:235`),
  `buildInventoryMock` (`:292`), `buildCharacterSpellMock` (`:316`),
  `buildCastSpellMock` (`:337`), `buildSpellSlotMock` (`:348`), `buildRestMock`
  (`:356`), `buildDiceMock` (`:373`), `buildNotificationMock` (`:379`),
  `buildSorceryPointMock` (`:394`), `buildWeaponMasteryMock` (`:417`),
  `buildHomebrewMock` (`:433`, the largest at ~82 lines).
- Only 9 come from domain modules: `mock-trpc-encounter.js` ×3,
  `mock-trpc-map.js` ×3, `mock-trpc-monster.js`, `mock-trpc-magic-item.js`,
  `mock-trpc-invite.js`.
- `packages/client/src/test/mock-trpc-invite.ts:1-8` — the invite module also
  owns `MockTRPCState` (`:27`) and `createMockTRPCState` (`:31`), because invite
  is the only namespace carrying mutable cross-procedure state: "`invite.create`
  must show up in a later `invite.list`". `mock-trpc.tsx:36` imports all three
  from there.
- `packages/client/src/test/mock-trpc.tsx:555` (`buildMockTRPC`), `:572`
  (`MockTRPCHolder`), `:590` (`buildLazyMockTRPCModule`) — the holder/composition
  plumbing that legitimately stays in the root file after extraction.
- `packages/client/src/test/MODULE.md:30-31` — already documents the target shape.
- `packages/client/package.json:44` — `"@musi/server": "workspace:*"`; the
  dependency already exists.
- `packages/server/src/routers/app-router.ts:30` — `appRouter` composes 27
  namespaces; `buildTRPCMock` supplies 26. `health` is present on the server and
  absent from the mock, on purpose.
- `packages/client/src/lib/trpc.ts:1,11` — already does
  `import type { AppRouter } from "@musi/server/router-type"` and
  `createTRPCContext<AppRouter>()`, and exports `useTRPC` at `:13`, so the
  pattern is in use in production client code. Note what this implies for the
  binding: the mock stands in for `useTRPC()`, whose type is the tRPC/TanStack
  options proxy over `AppRouter` (`ReturnType<typeof useTRPC>`), not `AppRouter`
  itself.
- `knip.config.ts:82` — `"@musi/server/router-type": ["packages/server/src/routers/app-router.ts"]`
  path alias is already registered.

## Proposed direction

1. **Extract the 16 in-file builders into per-router modules**, following the
   existing `mock-trpc-encounter.ts` / `-invite` / `-map` / `-monster` /
   `-magic-item` pattern. Group by domain rather than one file per builder — e.g.
   `mock-trpc-character.ts` (`buildCharacterMock`, `buildCharacterSpellMock`,
   `buildSpellSlotMock`, `buildSorceryPointMock`, `buildWeaponMasteryMock`,
   `buildRestMock`), `mock-trpc-campaign.ts` (`buildCampaignMock`,
   `buildNoteMock`, `buildChatMock`, `buildNpcMock`), `mock-trpc-homebrew.ts`,
   `mock-trpc-inventory.ts`, `mock-trpc-srd.ts`, `mock-trpc-misc.ts`
   (`buildDiceMock`, `buildNotificationMock`, `buildCastSpellMock`).
   `mock-trpc-invite.ts` is the precedent to copy, and it stays as it is:
   `buildInviteMock`, `MockTRPCState`, and `createMockTRPCState` live together
   there because invite is the only namespace with mutable cross-procedure
   state. Do not fold any of the three into `mock-trpc-campaign.ts`, and do not
   let the campaign module reclaim `createMockTRPCState`. Move only — no
   behaviour change, no signature change. One commit per module keeps each diff
   a pure file move.
2. **Leave `mock-trpc.tsx` as composition only**: `buildTRPCMock` (`:516`),
   `buildMockTRPC` (`:555`), `MockTRPCHolder` (`:572`),
   `buildLazyMockTRPCModule` (`:590`), and the imports. Refresh
   `packages/client/src/test/MODULE.md` so the module list at `:30-31` names the
   new files — see [`docs/guides/add-module-doc.md`](../../../guides/add-module-doc.md).
3. **Introduce a *partial* type binding at the composition seam.** In
   `mock-trpc.tsx`, derive the constraint from the real hook's type with a
   **type-only** import — `import type { useTRPC } from "@/lib/trpc.js"`, or
   `typeof import("@/lib/trpc.js").useTRPC`. Never a value import: this module is
   what `vi.mock` substitutes for `@/lib/trpc.js`, so a value import would drag
   the real client into every mocked test. `@/lib/trpc.js` already resolves
   `AppRouter` for you (`packages/client/src/lib/trpc.ts:1,11`), so
   `mock-trpc.tsx` needs no `@musi/server/router-type` import of its own —
   adding one alongside a `ReturnType<typeof useTRPC>` derivation leaves it
   unused, which `noUnusedLocals` (`tsconfig.base.json:19`) rejects. Constrain
   what `buildTRPCMock` returns against that options-proxy type — keys optional,
   values checked. Concretely: a mapped type over
   `keyof ReturnType<typeof useTRPC>` whose properties are all optional, so an
   unknown or renamed **namespace** key is a compile error while an
   intentionally unmocked namespace (`health` today) stays legal. **Do not make
   the constraint exhaustive.** Requiring every server namespace couples the
   client test double to the whole server surface, and the first thing it would
   force is a fake `health` namespace that no client test uses. **Constrain
   `buildTRPCMock` only**, not `buildMockTRPC`: the mock's `fetchCurrentUser`
   resolves `null` (`mock-trpc.tsx:561`) where the real one returns
   `Promise<AuthUser>` (`packages/client/src/lib/trpc.ts:113`), and
   `useTRPCClient` / `trpcClient` are empty objects (`:559`, `:560`).
   Reconciling that module-level seam is a separate decision.
4. **Type one namespace module at a time**, in ascending size order, so each
   commit is a bounded set of shape mismatches. Start with the small ones
   (`buildDiceMock`, `buildNotificationMock`, `buildSpellSlotMock`) to establish
   the idiom for expressing a `queryOptions`/`mutationOptions` result against a
   router procedure's input/output types, then work up to `buildHomebrewMock`.
   Keep the same rule inside a namespace: procedure keys the mock supplies must
   match the router; procedure keys it omits are allowed.
5. **Close the runtime half of the gap: fail loudly on an unmocked access.**
   The optional-key constraint deliberately cannot catch a *newly added* server
   procedure a test then calls, so the "silently returns `undefined`" behaviour
   in the title has to be fixed at runtime, not in the type system. Wrap the
   object `buildTRPCMock` returns (and each namespace object) so that reading an
   unknown key throws `Mocked tRPC procedure "<namespace>.<procedure>" is not
   implemented` instead of yielding `undefined`. This is the step that turns the
   headline failure mode into an actionable message; it is also independent of
   steps 3-4 and can land first if the typing work stalls.
6. **Replace `AnyRecord` in `mock-trpc-helpers.ts:16`** with the router-derived
   types once the callers no longer need it, or narrow it to the genuinely
   opaque positions if some remain. Deleting it is the finish line for this leaf.

## Scope / caveats

- **Intentional omission must stay legal — this is the constraint that shapes
  the whole leaf.** `appRouter` has 27 namespaces; the mock has 26 and omits
  `health` because no client test renders it. The same will be true of
  procedures inside namespaces. A binding that demands exhaustive coverage of
  the server router would be rejected on its first review, and would make every
  new server procedure a mandatory edit to a client test file. Check names and
  shapes of what is supplied; do not check completeness.
- **`mock-trpc.tsx` sits under a hard line cap, and clearing that cap is what
  finishes step 1.** `local/max-lines` caps files at 300 effective lines
  (`eslint-config/rule-groups.js:28`) and is switched off only for
  `**/*.test.{ts,tsx}` / `**/*.spec.ts` (`eslint-config/test-configs.js:96,101`,
  `eslint-config/shared-policy.js:120`), which `mock-trpc.tsx` does not match.
  It runs instead on a committed exception of 600
  (`eslint-config/max-lines-exceptions.baseline.json:122-129`, `severity:
  error`, `lifecycle: permanent`, `ratchetExcluded: true`) and sits at ~553
  effective lines — roughly 47 of headroom. Because the entry is
  ratchet-excluded the cap never tightens on its own: lower it as the moves land
  and delete it at the end, via `bun run lint:max-lines-exceptions:update` in
  the same commit series.
- **Step 1 is small and riskless; steps 3-6 are neither.** The extraction is a
  mechanical file move with no behaviour change. Typing 603 lines of hand-rolled
  mock against the real router will surface a large number of shape mismatches at
  once, and it is not mechanical — each mismatch is a decision about whether the
  mock was wrong or the test's expectation was. Do not schedule them as one unit
  of work and do not let a reviewer treat the typing commits as "the same kind of
  change" as the moves.
- **Do the split before the typing.** Reversing the order produces one
  unreviewable diff touching every namespace in a single 603-line file. This is
  also why step 3 (bind at the composition seam) comes before step 4 (bind
  per-namespace): the cheap namespace-level check catches the highest-value class
  of drift immediately, and the expensive per-procedure work can then land
  incrementally without blocking.
- **The direction is not a speculative abstraction.** Steps 1-2 finish a pattern
  the codebase already chose and documented at
  `packages/client/src/test/MODULE.md:30-31`; five `mock-trpc-*` router modules
  already exist. Match their conventions rather than inventing new ones.
- **No new dependency wiring is required.** `packages/client/package.json:44`
  already declares `"@musi/server": "workspace:*"`,
  `packages/client/src/lib/trpc.ts:1` already imports `AppRouter` from
  `@musi/server/router-type`, and `knip.config.ts:82` already carries the path
  alias. Do not add a dependency, an export, or a knip alias for this work.
- **Preserve `buildLazyMockTRPCModule` / `MockTRPCHolder` semantics exactly.**
  The lazy holder exists so `vi.mock` factories can reference the mock before it
  is built; changing when the object is constructed will break module-mocking
  order across the client suite in ways that surface as unrelated failures. The
  step 5 wrapper must therefore sit on the object `buildTRPCMock` returns, not
  on `buildLazyMockTRPCModule`'s fixed five-key delegate, and must leave
  `useTRPC` / `useTRPCClient` / `trpcClient` / `fetchCurrentUser` /
  `TRPCProvider` readable as before.
- Client test/mock boundaries interact with the cache and socket conventions in
  [`docs/guides/add-client-feature-module-cache-socket.md`](../../../guides/add-client-feature-module-cache-socket.md);
  read it before changing what any mock *returns*, as opposed to where it lives.
- Independent of leaves 40 and 42; can be scheduled in parallel with either.
