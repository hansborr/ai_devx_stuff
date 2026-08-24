# 41-PLAN. Binding the client tRPC mock to the router: scheduling plan

Status: Scheduled work finished — **41.1 and 41.2 are implemented on
`fix/cq-41-mock-trpc-binding`; 41.3 remains optional and is not scheduled.** The
plan shrinks leaf 41 from L to two S slices plus one optional tidy; three of its
six steps are dropped permanently; it supersedes the Proposed direction in
[`41-mock-trpc-typing.md`](./41-mock-trpc-typing.md).

Date: 2026-07-31 · Area: tests · Source leaf: 41 (L)

Cross-model planning session: `consult codex`, `consult claude -m
claude-opus-4-8`, and `consult cursor` (Grok), all given the same question
independently. All three answered; no backend was unavailable. Where they
disagreed, the call and the reason are in
[Rulings where the consults split](#rulings-where-the-consults-split) and
[Rejected alternatives](#rejected-alternatives--why). Every anchor below was
re-resolved by symbol name against `51065bc7c`, and the type mechanism in
[The mechanism that works](#the-mechanism-that-works-measured) was measured, not
reasoned about.

## Verdict

**Two small slices, one optional tidy, three steps that leave the backlog.**

All three consults independently ranked the *runtime* unknown-access guard first
and independently dropped the domain split as a prerequisite, full per-procedure
value typing, generalized input parsing, and deleting `AnyRecord` as a goal.

The deciding observation is one the leaf half-states and then walks past: **the
type system cannot catch the failure in the title.** A newly added server
procedure that a component starts calling is invisible to any binding that
respects the intentional-omission rule — the leaf says so itself at its step 5.
So the runtime guard carries the entire guarantee, and the type binding is cheap
insurance against a *stale supplied name*, which is a different and much smaller
failure. Ranking them the other way round — the leaf's order, split first, then
type, then guard last — puts the only load-bearing step behind two that are not.

## Corrections to the leaf, verified

**1. The size evidence and every anchor are stale.** `mock-trpc.tsx` is 616
lines (the leaf acknowledges this) and `mock-trpc-helpers.ts` is **350**, not the
leaf's 212 — it grew failable-mutation, gated-refetch and cursor-list plumbing.
`AnyRecord` is `mock-trpc-helpers.ts:17`, not `:16`. Re-resolved: `buildSrdMock`
`:73`, `buildCharacterMock` `:134`, `buildHomebrewMock` `:446`, `buildTRPCMock`
`:529`, `buildMockTRPC` `:568`, `MockTRPCHolder` `:585`,
`buildLazyMockTRPCModule` `:603`. The knip alias is `knip.config.ts:83`, not
`:82`. The counts survive: 27 server namespaces (`app-router.ts:32-60`), 26
mocked (`mock-trpc.tsx:529-565`), `health` omitted, 16 in-file builders, 9
imported from five domain modules.

**2. `MODULE.md` does not document the target shape the leaf attributes to it.**
`packages/client/src/test/MODULE.md:29-35` reads "`mock-trpc.tsx` +
`mock-trpc-control.ts` + per-router `mock-trpc-encounter` / `-invite` / `-map` /
`-monster` / `-magic-item`, the `mock-use-*` hook fakes …". That is an
**inventory of what exists**, in a bulleted discovery map alongside the fixture
and shim inventories — not a declared destination. The leaf's "already documents
the intended shape" and "finishes a pattern the codebase already chose" are
readings, not quotations. Codex caught this; the leaf, cursor and opus did not.

**3. Step 1 is not "move only, no behaviour change".** `cursorIdFromPageParam`
(`mock-trpc.tsx:264`) is shared by the note paginator (`:196`) and the inventory
paginator (`:289`), and the leaf's own grouping puts those two in *different*
modules (`mock-trpc-campaign.ts` and `mock-trpc-inventory.ts`). The extraction
therefore requires relocation, duplication, or a new shared seam — a decision,
not a `git mv`.

**4. The leaf's step-3 mechanism does not do what step 3 says, for two
independent reasons.**

- *"values checked" is unreachable.* The real `useTRPC()` values are tRPC/TanStack
  decorated procedure types carrying `queryKey`/`mutationKey`/`queryFilter` and
  exact option overloads; the mock's nodes are crude `{ queryOptions }` /
  `{ mutationOptions }` objects from `makeListQuery`/`makeMutation`
  (`mock-trpc-helpers.ts:212-249`). Assignability does not hold without a flood
  of casts. Worse, tRPC's decorated router record maps **every** procedure as
  required, so a namespace value checked against its real namespace type is
  *exhaustive* — the exact thing the leaf's own caveat forbids. Cursor and codex
  raised this independently.
- *A root-level `Partial<Record<…>>` cannot see procedure keys.* Excess-property
  checking fires on fresh object literals. In `buildTRPCMock`, `srd:
  buildSrdMock()` is a **function call result**, not a literal, so no check
  reaches inside it. The form the leaf proposes catches renamed *namespaces* and
  nothing else. Codex found this; it is why the binding must be a computed
  key-difference type rather than a `satisfies` at the seam.

**5. Procedure-level omission is already normal, not a future hypothetical.**
The server `character` router exports `addCondition` and `removeCondition`
(`packages/server/src/routers/character.ts:146-147`) which
`buildCharacterMock` (`mock-trpc.tsx:134-160`) does not supply; server `srd`
carries `listClassFeatures`, `listEquipment`, `getEquipment`, and the nine
reference-table procedures in the local `refList` spread
(`packages/server/src/routers/srd.ts:548,560`) which `buildSrdMock` omits; server
`auth` carries `me` (`packages/server/src/routers/auth.ts:333-342`) which the
inline `auth` mock (`mock-trpc.tsx:556-564`) omits. The one client consumer of
`auth.me` reaches it through the vanilla `trpcClient`, not `useTRPC`
(`packages/client/src/lib/trpc.ts:114`), so nothing renders against an unmocked
procedure today. **The "omission must stay legal" constraint therefore binds at
depth 2 as well as depth 1**, and the guard's first run should be expected to be
green rather than to redden the suite.

**6. "Silently returns `undefined`" overstates how often drift is silent.** The
dominant access shape is `useQuery(trpc.ns.proc.queryOptions())`. When `proc` is
absent that already throws `TypeError: Cannot read properties of undefined
(reading 'queryOptions')` today, with no guard. The guard's real payoff is (a) a
precise, correctly located message instead of an ugly one, and (b) the genuinely
silent subset — reads behind `?.` or `data ?? []`. Both are worth having; the
headline is a bit louder than the mechanism. Opus caught this.

**7. The max-lines exception is not a forcing function.** The leaf estimates ~553
effective lines against the 600 cap (~47 headroom); codex re-measured ~559 (~41).
Neither number matters much: the entry is `lifecycle: permanent` **and**
`ratchetExcluded: true` (`eslint-config/max-lines-exceptions.baseline.json`, the
`mock-trpc.tsx` entry), so the cap never tightens on its own and nothing forces
the split. Re-measure before relying on either figure.

## The mechanism that works (measured)

`AppRouterInputs` is **already exported** and is exactly a `[routerKey][procedureKey]`
map: `export type AppRouterInputs = inferRouterInputs<AppRouter>` at
`packages/server/src/routers/app-router.ts:74`, documented at `:64-73`, reachable
type-only through the existing `@musi/server/router-type` export
(`packages/server/package.json:7-11`). It carries **names**, not TanStack
decorate types, which is the whole problem with binding against the options
proxy. Codex found this; it is the plan's central technical correction.

The binding is a computed difference, not a `satisfies`:

```ts
type KnownNs = keyof AppRouterInputs;
type ExtraNamespaces<M> = Exclude<keyof M, KnownNs>;
type ExtraProcedures<M> = {
  [N in keyof M & KnownNs]: Exclude<keyof M[N], keyof AppRouterInputs[N]> extends infer E
    ? E extends string ? `${N & string}.${E}` : never
    : never;
}[keyof M & KnownNs];
```

Measured on `51065bc7c` with a scratch module under `packages/client/src/test/`
and `bun x tsc -p packages/client/tsconfig.json --noEmit` (scratch file deleted
afterwards; the tree is clean):

| Probe | Result |
|---|---|
| `const _ : Drift extends never ? true : Drift = true` over the live `MockTRPCClient` | **exit 0** — the mock supplies **no** namespace and **no** procedure key the router lacks today, so the check is adoptable as-is with zero mock edits |
| the same assertion over a hand-broken shape carrying `characterz` and `character.getRenamed` | **TS2322** — the assertion is **non-vacuous** (CONSTRAINTS rows 41/42) |
| the union value for that broken shape | resolves to `"characterz" \| "character.getRenamed"` — the dotted diagnostic codex asked for |
| naming that union through a `type` alias before asserting | the error reads `Type 'true' is not assignable to type 'BrokenDrift'` — **the dotted key is hidden**. Keep the union inline in the conditional's false branch, or the diagnostic is useless |

`MockTRPCClient` already exists as `ReturnType<MockTRPCModule["useTRPC"]>`
(`mock-trpc-control.ts:36`), so the check needs no new export from the mock.

**Where it lives matters.** `packages/client/src/test/` has no `__type-tests__`
registration: `knip.config.ts:41-42` and `:116-117` and
`eslint-config/shared-policy.js:132` register the **server** directories only, so
a new client `__type-tests__` directory would cost registration in at least knip
and the shared lint policy before it asserts anything. Put the assertion in a
client `.test.ts` instead, where an unexported `const` consumed by one `expect`
satisfies `noUnusedLocals` (`tsconfig.base.json:19`) and needs no registration at
all. It fails under `bun run typecheck`, not under Vitest — Vitest strips types.

## Step disposition

| Step | Call | Reason |
|---|---|---|
| 1. Extract the 16 in-file builders into per-router modules | **Optional, not scheduled** → 41.3 | No gate forces it, `MODULE.md` does not mandate it (correction 2), and it is not the pure move the leaf claims (correction 3). Codex and cursor dropped it outright; opus kept it as low-priority navigability. |
| 2. Leave `mock-trpc.tsx` as composition only + refresh `MODULE.md` | **Optional, travels with step 1** → 41.3 | Same reasoning; meaningless without step 1. |
| 3. Partial type binding at the composition seam | **Keep, mechanism replaced** → 41.2 | The intent is right and the stated mechanism is wrong twice over (correction 4). Bind names against `AppRouterInputs` at both depths with a computed key difference. |
| 4. Type one namespace module at a time against procedure input/output types | **Drop permanently** | All three consults rejected it. It forces the deliberately partial nodes toward `queryKey`, branded keys, exact option overloads and output compatibility — literally the second TanStack implementation the leaf says to avoid — for a marginal catch that 41.2 already gets by names alone. |
| 5. Fail loudly on an unmocked access | **Keep, promoted to first** → 41.1 | The only step that addresses the title. Independent of everything else; lands first and alone. |
| 6. Replace/delete `AnyRecord` as the finish line | **Drop as a goal** | It is the correct type at the dynamic string-path boundaries (`mock-trpc-helpers.ts:94-113`, `:163-209`), which index an opaque graph by `"router.procedure"`. Narrow it opportunistically if a builder no longer needs it; do not schedule it, and do not treat its survival as an unfinished leaf. |
| — Generalizing the `listSpells` input parsing | **Drop permanently** | All three consults, unprompted and unanimous. See [ruling](#the-input-parsing-ruling-generalize-to-zero). |

## Rulings where the consults split

### The override re-wrap: mandatory (cursor + codex over opus)

Every bespoke test patches the mock through `overrideMockTRPC`
(`mock-trpc-control.ts:59-66`) and its convenience wrapper
`armMockTRPCMutationFailure` (`:74-78`), and the transforms **spread**:
`{ ...trpc, encounterMap: { ...trpc.encounterMap, … } }`. `grep -rn "\.\.\.trpc,"
packages/client/src` returns **43 sites across 35 files**. Spreading a Proxy
copies its own keys onto a *plain* object and drops the trap.

Opus said document the hole and do not re-wrap, on the grounds that re-wrapping
"reopens `buildLazyMockTRPCModule`/timing territory the caveat forbids". **That
reason does not hold.** The leaf's caveat forbids putting the guard on
`buildLazyMockTRPCModule`'s fixed five-key delegate (`mock-trpc.tsx:603-616`);
`overrideMockTRPC` is a different module that already rebuilds the module object
on every call, and re-wrapping is one call inside its existing
`useTRPC: () => transform(innerUseTRPC())`. Cursor's phrasing is the right one:
without the re-wrap the guard "silently stops working on the tests that most
mutate the graph" — a guard that is absent exactly where the mock is most
hand-edited. **Call: re-wrap at `mock-trpc-control.ts:64`**, with codex's
`WeakSet` marker so composed overrides do not stack proxies.

### The domain split: optional, not scheduled (codex + cursor over opus)

Opus kept it as worth-doing-but-low-priority on the strength of the
`MODULE.md` precedent. Codex and cursor both dropped it, and correction 2 removes
the precedent opus was leaning on. Three further grounds:

- **No gate forces it.** The 600 exception is permanent and ratchet-excluded
  (correction 7). This is the same shape as 40-PLAN's
  [step 8 ruling](./40-PLAN.md#step-8-ruling-dropped-with-the-conditions-to-revisit):
  no gate, so the only argument is navigation.
- **It is not the riskless mechanical move the leaf promises** (correction 3).
- **The leaf's own justification for it evaporates.** "Split first so the typing
  pass is reviewable file by file" is an argument about step 4, and step 4 is
  dropped. 41.1 and 41.2 touch one wrapper call, one control-module line, and one
  test file; neither needs the split, and sequencing 16 move commits ahead of the
  only safety work is exactly backwards.

**Call: keep it as 41.3, `Open (optional)`, explicitly not scheduled.** Do it if
someone is already in the file for behavioural reasons, or if the cap ever blocks
a change worth making; do not spend a session on it otherwise.

### The type binding's source: `AppRouterInputs`, not the options proxy

Opus proposed `keyof ReturnType<typeof import("@/lib/trpc.js").useTRPC>` at the
seam; cursor proposed `keyof AppRouter` in a type-test file; codex proposed
`AppRouterInputs`. **Codex's is correct and the other two are worse for concrete
reasons.** The options proxy drags the TanStack decorate surface into the
diagnostic and, per correction 4, cannot be made to check values without becoming
exhaustive. `keyof AppRouter` includes tRPC's own router members (`_def` and
friends), so it is a noisier key set than the inputs map. `AppRouterInputs` is
already exported, already documented as a `[routerKey][procedureKey]` map,
already reachable, and gives both depths from one type.

Opus additionally warned that a standalone `extends`-style type test would be a
CONSTRAINTS-row-42 vacuousness trap. The warning is right in general and does not
apply to this form — the measured non-vacuity probe above is the proof, and
reproducing it is a Done criterion of 41.2 rather than an assumption.

### The input-parsing ruling: generalize to zero

Unanimous, and the plan adopts it as a permanent refusal. `srd.listSpells` is
justified because its filter vocabulary is closed — `classId` is an eight-value
enum — and the code says so at `mock-trpc.tsx:85-94`. Nearly every other mock
input is an opaque id or free string where parsing buys nothing. Generalizing
would import ~26 input schemas into the test harness, make a server-side
tightening of an unrelated field redden client *component* tests, and convert
every render test into a server-contract test. The correct generalization size is
**zero**; `listSpells` stays the lone commented exception. The two already
declined follow-ups — comparing `enabled` to `true`, and evaluating
function-valued `enabled` — stay declined.

## Slices

Three slices. 41.1 and 41.2 are one agent session each and are independently
landable; 41.3 is not scheduled.

| # | State | Scope | Done criteria | Verification |
|---|---|---|---|---|
| **41.1** | **Implemented** (`fix/cq-41-mock-trpc-binding`) | **Loud unknown access (S).** Add a new `packages/client/src/test/mock-trpc-guard.ts` exporting `withStrictMockAccess<T extends object>(value: T): T` — a `get`-trap-only `Proxy`, applied at **depth 0 (the root) and depth 1 (each namespace object) only**. Call it once at `mock-trpc.tsx:571` (`useTRPC: () => withStrictMockAccess(buildTRPCMock(state, options))`) and once at `mock-trpc-control.ts:64` (`useTRPC: () => withStrictMockAccess(transform(innerUseTRPC()))`), guarded by a module-level `WeakSet` so composed overrides do not stack proxies. Throw `Mocked tRPC namespace "<ns>" is not implemented` at the root and exactly `Mocked tRPC procedure "<ns>.<proc>" is not implemented` at depth 1. Forward, never throw, when: the key is a `symbol`; the key is `in` the target (which covers the whole `Object.prototype` chain — `constructor`, `toString`, `valueOf`, `hasOwnProperty`); or the key is one of the reproduced probe allowlist `then`, `toJSON`, `$$typeof`, `nodeType`, `tagName`, `@@__IMMUTABLE_ITERABLE__@@`, `@@__IMMUTABLE_RECORD__@@`, `_isMockFunction`, `asymmetricMatch`. Do **not** add a `has`/`ownKeys`/`set` trap. Do **not** proxy procedure nodes (depth 2+). Do **not** touch `buildLazyMockTRPCModule` / `MockTRPCHolder` (`mock-trpc.tsx:585-616`) or `buildMockTRPC`'s module seam. The signature must be identity-typed (`T -> T`) so `MockTRPCClient` (`mock-trpc-control.ts:36`) is unchanged and the 43 spread-override sites still type-check. | A new `mock-trpc-guard.test.ts` asserts, non-vacuously and **by message**: an unknown root key throws the namespace message; an unknown key on a known namespace throws the dotted procedure message; a known access, `Object.keys`, `in`, and `{ ...trpc }` are unaffected; every allowlisted probe key and an arbitrary `symbol` return `undefined` rather than throwing; real failing equality and inline-snapshot assertions preserve their original diagnostics at both guarded depths; **and an `overrideMockTRPC` transform that spreads both root and namespace still throws on a sibling missing procedure** (this is the regression the re-wrap exists for). `withStrictMockAccess` applied twice returns the same proxy. No pre-existing test's assertions changed. | `bun run typecheck`, then the **whole** client suite — `bun run test -- packages/client` — not a subset: the probe keys fire from `expect`/pretty-format paths that only run while formatting a failing or serialized assertion |
| **41.2** | **Implemented** (`fix/cq-41-mock-trpc-binding`) | **Names-only router binding (S).** In a new `packages/client/src/test/mock-trpc-router-binding.test.ts`, import `AppRouterInputs` **type-only** from `@musi/server/router-type` and `MockTRPCClient` from `./mock-trpc-control.js`, declare the `ExtraNamespaces` / `ExtraProcedures` types from [The mechanism that works](#the-mechanism-that-works-measured), and assert both directions are empty in a single `it` that consumes the value with an `expect` (so `noUnusedLocals` is satisfied without an export). Keep the drift union **inline** in the conditional's false branch — an intermediate `type` alias hides the offending key from the diagnostic (measured). Add nothing to `mock-trpc.tsx`; it needs no import of its own. Do **not** create a client `__type-tests__` directory. Do **not** check values, outputs, or completeness in either direction. | `bun run typecheck` is clean as-is (measured: zero mock edits required). The file carries a short comment stating that the check is one-directional by design and that legal omissions include `health`, `character.addCondition`, `character.removeCondition`, `srd.listClassFeatures`, `srd.listEquipment`, `srd.getEquipment`, the nine reference-table routes spread into `srdRouter`, and `auth.me`. **Non-vacuity is demonstrated, not asserted**: the commit message or a comment records the two-line temporary edit (rename one mocked namespace key, rename one mocked procedure key) that was shown to produce a `TS2322` naming the dotted key, and the tree is left unmodified | `bun run typecheck`, then `bun run test -- packages/client/src/test/mock-trpc-router-binding.test.ts` |
| **41.3** | Open (optional) — **not scheduled** | **Domain split (M).** Extract the 16 in-file builders into per-domain `mock-trpc-*.ts` modules, leave `mock-trpc.tsx` as composition only, refresh `MODULE.md`, and lower or delete the max-lines exception via `bun run lint:max-lines-exceptions:update` in the same series. `mock-trpc-invite.ts` keeps `MockTRPCState` and `createMockTRPCState`. **Any attempt must first decide where `cursorIdFromPageParam` (`mock-trpc.tsx:264`) lives** — the note (`:196`) and inventory (`:289`) paginators share it across the leaf's proposed module boundary. Do only if someone is already in the file for behavioural reasons, or if the cap blocks an otherwise valuable change. | Each builder has exactly one definition under a `mock-trpc-*.ts`; `mock-trpc.tsx` holds only `buildTRPCMock`, `buildMockTRPC`, `createMockTRPCModule`, `MockTRPCHolder`, `buildLazyMockTRPCModule` and imports; no builder signature changed; the shared cursor helper has one home, not two | `bun run test -- packages/client` and `bun run lint` |

### Dependency edges

- **`41.1 ∥ 41.2`** — different files, no shared symbol, either order. 41.1 edits
  `mock-trpc.tsx:571` and `mock-trpc-control.ts:64`; 41.2 adds one test file and
  edits nothing else.
- **`41.1 → 41.3` and `41.2 → 41.3` (soft, and only if 41.3 ever happens).**
  Moving 16 builders while a guard or binding lands guarantees a rebase, and both
  scheduled slices are cheap enough to land first.
- Independent of leaves 40 and 42, as the leaf says. No other open leaf in this
  pack touches `packages/client/src/test/`.

### Index reconciliation (whichever slice lands first applies these)

1. `00-index.md`, `## Open leaves`: row 41 already points at this file and
   already carries `L\*`, the leaf's pre-plan size. Change it to `S` — the plan
   re-scopes leaf 41 into two S slices — and drop 41 from the "Rows for 07, 34,
   40, 41, 42 and 53 carry the *leaf's* pre-plan `Sev`/`Size`" rule above the
   table, including its `L → S` clause.
2. `41-mock-trpc-typing.md`: add a `Status` pointer to this plan and record that
   steps 4 and 6 and the input-parsing generalization are dropped permanently, so
   they are not re-scheduled from the leaf.

## Operational risks

- **The Proxy allowlist is the whole risk surface of 41.1.** Under-cover it and
  unrelated, currently-green tests start throwing while Vitest formats an
  assertion. Over-cover it and every allowed string weakens the guarantee the
  slice exists to create. The discipline: `symbol` always forwards, `key in
  target` always forwards (this is what makes `constructor`/`toString`/`valueOf`
  safe without naming them), and the string allowlist grows **only** by a
  reproduced failure — add a key because the suite failed on it, never because it
  looked plausible. Tune against the full client suite, not a file.
- **Do not proxy depth 2 or deeper.** Procedure nodes are option bags, and the
  helpers deliberately put function identities into query keys
  (`mock-trpc-helpers.ts:265-303`) while `SRD_GETALL_FIXTURE` is held at module
  scope precisely so repeated `useTRPC()` calls hand back the same reference for
  the identity-stability tests (`mock-trpc.tsx:49-54`). Wrapping there changes
  identity and breaks those tests for no gain.
- **Without the re-wrap at `mock-trpc-control.ts:64`, 41.1 is theatre.** 43
  spread sites across 35 files strip the proxy. The re-wrap test named in the
  Done criteria is not optional decoration — it is the assertion that the slice
  works where it matters.
- **41.1's intentional holes must keep throwing.** `auth.me`,
  `character.addCondition`/`removeCondition` and the unmocked SRD lists are
  deliberate omissions (correction 5). If a future component reaches one, the
  guard firing is the **finding**; do not silence it by stubbing an empty
  procedure into the mock. Add the procedure with real fixture behaviour, or fix
  the component.
- **41.2 is one-directional on purpose and must stay that way.** It checks that
  what the mock supplies exists on the router. It says nothing about coverage,
  and it cannot catch a newly added procedure a component starts calling — that
  is 41.1's job. Do not "improve" it into a completeness check; that is the
  rejection the leaf's own caveats predict would fail review.
- **41.2's diagnostic quality is a Done criterion, not a nicety.** Measured: an
  intermediate `type` alias reduces the error to the alias name and hides the
  dotted key. If the readable form cannot be kept, the slice is not worth landing
  — codex's condition, and this plan adopts it.
- **Router imports in client test code must stay type-only.** A value import of
  the server router transitively loads all 27 routers assembled at
  `app-router.ts:3-30` into every mocked client test. 41.2 imports a `type` from
  `@musi/server/router-type` and nothing else; no dependency, package export or
  knip alias is added, because all three already exist
  (`packages/client/package.json:44`, `packages/client/src/lib/trpc.ts:1`,
  `knip.config.ts:83`).
- **Neither slice changes what any mock returns**, only how absent keys behave
  and what the compiler checks. If a mock *return payload* ever changes, read
  [`docs/guides/add-client-feature-module-cache-socket.md`](../../../guides/add-client-feature-module-cache-socket.md)
  first — that is a different kind of change with different conventions.
- **Do not constrain `buildMockTRPC`'s module seam.** `fetchCurrentUser` resolving
  `null` (`mock-trpc.tsx:574`) against production's `Promise<AuthUser>`
  (`lib/trpc.ts:111-115`), and the empty `useTRPCClient`/`trpcClient`, are
  deliberate. Reconciling that seam is a separate decision and has no bearing on
  missing procedures. All three consults said so independently.

## Rejected alternatives — why

| Rejected | Why |
|---|---|
| **Scheduling leaf 41 as a single L "typed shadow router" pass** | It conflates navigation, type binding, runtime behaviour and input validation, which share no mechanism. All three consults returned "shrink" independently. |
| **The leaf's step ordering (split → seam type → per-namespace type → runtime guard)** | Puts the only step that fixes the title last, behind two that do not. Unanimous across the consults: the guard goes first and alone. |
| **Binding against `ReturnType<typeof useTRPC>`** | Correction 4: values cannot be checked without a flood of casts, and a namespace value checked against its real namespace type is exhaustive — which the leaf itself forbids. `AppRouterInputs` gives the same names with none of the surface. |
| **`keyof AppRouter` as the key source** | Includes tRPC's own router members alongside the namespaces. `AppRouterInputs` is the already-exported, already-documented `[routerKey][procedureKey]` map. |
| **A `satisfies Partial<Record<…, unknown>>` on `buildTRPCMock`'s return literal** | Catches renamed namespaces only. `srd: buildSrdMock()` is a call result, so excess-property checking never reaches the procedure keys — the drift most likely to occur. |
| **Full per-procedure value typing (leaf step 4)** | Rejected by all three. Forces the deliberately partial nodes toward `queryKey`, branded query keys, exact option overloads and output compatibility; unreadable structural diagnostics; a permanent tax on every future procedure edit; marginal catch over names-only + the runtime guard. |
| **Making the binding exhaustive over the router** | Out of bounds by the leaf's own constraint, and correction 5 shows omission is already normal at procedure level too. It would force a fake `health` and make every new server procedure a mandatory client-test edit. |
| **A standalone `X extends Partial<Record<…>>` type test** | Vacuous — assignability ignores excess properties on non-literals, which is CONSTRAINTS row 42's exact failure. The computed key-difference form is not vacuous, and 41.2 proves it rather than assuming it. |
| **A client `__type-tests__` directory** | The convention is registered for `packages/server/**` only (`knip.config.ts:41-42,116-117`, `eslint-config/shared-policy.js:132`). A client copy costs registration in at least two harness surfaces before it asserts anything; an unexported `const` inside a `.test.ts` gets the same guarantee for free. |
| **MSW, or a real `createTRPCClient` over a fake link** | Both replace the harness rather than bind it. `@/lib/trpc.js` is the module `vi.mock` substitutes (`setup.ts:45`), so routing through a real client drags the production client and transport into every mocked test; and the mock is deliberately a *synchronous* options double seeding `initialData`, so a faithful transport makes every component test asynchronous. All three consults rejected it. |
| **A generated double** | Adds a generator, a freshness gate and an exhaustive generated surface to buy two small checks, and an exhaustive generated surface contradicts the intentional-omission rule outright. |
| **`satisfies typeof import("@/lib/trpc.js")` on the mock module** | Checks only `buildMockTRPC`'s five keys and immediately fails on three deliberate divergences (`fetchCurrentUser`, `useTRPCClient`, `trpcClient`). It has no bearing on missing procedures. |
| **Documenting the post-override proxy hole instead of re-wrapping** | Opus's position, rejected 2-1. The stated reason — that re-wrapping reopens lazy-holder timing — is wrong: the re-wrap is one call in `mock-trpc-control.ts`, which already rebuilds the module object. Leaving the hole means the guard is absent on the 35 files that most edit the mock. |
| **Scheduling the domain split** | See the [ruling](#the-domain-split-optional-not-scheduled-codex--cursor-over-opus). No gate, an overstated `MODULE.md` mandate, a shared cursor helper that makes it more than a move, and a justification that only existed to serve the dropped step 4. |
| **Generalized input-schema parsing** | See the [ruling](#the-input-parsing-ruling-generalize-to-zero). Unanimous; correct size is zero. |
| **Comparing `enabled` to `true`, or evaluating function-valued `enabled`** | Already declined in the leaf and re-endorsed by all three consults. No affected component produces a function, and partial emulation would add a branch with no caller while still not making the mock a faithful Query observer. |
| **Deleting `AnyRecord` as the leaf's "finish line"** | It is the right type where the override helpers index an opaque graph by `"router.procedure"` string paths (`mock-trpc-helpers.ts:94-113`, `:163-209`). Narrow it opportunistically; its survival is not an open leaf. |
