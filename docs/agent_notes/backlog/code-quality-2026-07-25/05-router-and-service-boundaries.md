# 05. Router/service boundaries drift from the repo's own promotion rubric — rule logic left inline, a service MODULE doc that describes a layout the tree no longer has, and one router reaching into tRPC's private `_def`

Status: **Done 2026-07-29** in
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md)
slice **S6 landed steps 1, 2 and 4a** on 2026-07-29, branch
`feat/cq-broadcast-registry-cleanup`, merge `08d9443ad`: `trpc.ts` exports
`mergeRouters` and `routers/homebrew.ts` no longer spreads `._def.procedures`,
`getRefreshTokenFromCookie` returns `string | null` with the hand-inlined
`parseCookies` gone, and `services/rest-MODULE.md` describes the file set the
tree actually has. **Step 5 landed too, by slice S7 on branch
`feat/cq-server-authz-and-spell-rule`, merge `48ff021ed`**: `calcMaxPrepared` and
a pure `assertPreparedLimit` live in
`packages/server/src/utils/prepared-spells.ts`
with unit tests that need no tRPC caller, no database and no race, and
`services/README.md`'s placement rubric was updated to describe the resulting
two-module split — the pure cap rule beside the Serializable check-and-write in
`utils/prepared-spell-toggle.ts`, both staying utilities. See
[Landed](./00-index.md#landed). **Nothing of
this leaf is left to schedule** — and only that remained:
step 3 rides on the optional S19 (leaf 46 owns the `routers/srd.ts` rename, and
if S19 is skipped neither happens), and steps 4b, 6 and 7 are dropped
permanently. Step 4b resolved to "do nothing" for a recorded reason: S5
dissolved `services/rest-encounter-attribution.ts`, so rest has two internal
files, `services/README.md:21-28` criterion 3 fails, and rest stays a flat
service with the corrected companion doc. **Do not re-schedule steps 1, 2, 3,
4a, 4b, 6 or 7 from this leaf.** See
[Second landing outcome](./SERVER-COMMENTS-PLAN.md#second-landing-outcome) and
[Third landing outcome](./SERVER-COMMENTS-PLAN.md#third-landing-outcome).
The plan shrank this leaf L→S and rules the layering itself
sound. **Step 5 was reframed**: the extraction buys testability only. It does not
touch concurrency — but neither is there a race left for it to disclaim, because
leaf 51 closed that one first (`6246c73cf`). No serialization follow-on was
filed and none is owed.
The three drops mean: do not promote rest to `services/rest/`, do not split
`routers/srd.ts` by content family, and do not merge the two `assertTurnLock`
branches. Step 7's drop is also the answer leaf 45's "Sequencing with leaf 05"
caveat asks for.
Theme: layer boundaries · Area: server · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/server/src/services/README.md` is an unusually good document: it states
a three-question rubric for when logic earns a `services/<name>/` folder versus a
flat service versus `utils/`, and it names the shapes a router may legitimately
keep inline. The value of that rubric is that it makes "where does this belong?"
answerable without argument. The cost of it is that every place the tree has
drifted from it is now a place where the next maintainer has to decide whether
the code or the rubric is right.

This leaf is that drift. It is under-extraction plus stale documentation. One
heavily-wrapped surface (`services/combat-actions/assert-turn.ts`) is listed
below as an inventory entry only: it is documented and load-bearing, and this
leaf does not propose changing it — see caveats.

**Under-extracted.** `routers/character-spell.ts` carries ~50 lines of pure 5E
rule enforcement — the max-prepared calculation and the guard that rejects
over-preparing — inline in a procedure, where it cannot be unit-tested without
standing up a tRPC call. `routers/auth.ts` hand-inlines a cookie read *and*
ships a four-line comment explaining why it had to, because the shared helper's
signature (throw, don't return) is wrong for one of its two callers. In both
cases the comment or the shape is compensating for a helper that should just be
reshaped.

**Heavily wrapped.** `services/combat-actions/assert-turn.ts` is a 20-line file
whose entire body is `return assertTurnLock(tx, opts);`, wrapped in a 10-line
comment, with an alias pair in `types.ts`, a compile-time drift-guard file that
pins those aliases, and a facade re-export — five artifacts around one rename.
Unlike the other items in this leaf, each of those artifacts has a written
rationale (`combat-actions/MODULE.md:36-42`, the alias comment at
`types.ts:62-66`, the facade-cycle note in the file's own JSDoc), so this is
recorded here as an inventory observation, not as drift to undo. See caveats.

**Stale doc.** `services/rest-MODULE.md` calls rest a "single-file flat service
(`rest-service.ts`)" and says to "promote to `services/rest/` only when the
implementation actually wants multiple internal files". It already wants two
siblings, neither of which has a consumer outside `rest-service.ts`, so the
doc is factually stale today regardless of what happens to the folder layout.
Whether the promotion criteria in `services/README.md:21-28` are *met* is a
live question rather than a settled one — leaf 04 step 5 is scheduled to
dissolve one of those two siblings — so the doc fix and the promotion are two
different decisions and are separated in the direction below.

**Boundary crossed illegitimately.** `routers/homebrew.ts` merges two sub-routers
by spreading `._def.procedures` — reaching into tRPC's explicitly-private surface
when the installed version ships `mergeRouters` for exactly this. It is the only
production `_def` reach-in in `packages/server/src`.

Finally, `routers/srd.ts` at 561 lines is navigationally hard for a reason that
is *not* a boundary problem, and one race-sensitive primitive
(`assertTurnLock`) has two near-identical branches. Both are included here
because they sit on the same files; see caveats for why neither should be
treated as urgent.

## Evidence

- `packages/server/src/routers/character-spell.ts:46` — `calcMaxPrepared`, no second caller; `:85-95` spell-class availability; `:195-224` the max-prepared enforcement block (`maxPrepared` at `:206`, the throw at `:216-219`). File is 281 lines.
- `packages/server/src/services/README.md:108-118` — a router doing `assertCharacterOwner` + `emitCharacterUpdate` inline when calling a shape-2 service is "correct for shape 2 and not a bug".
- `packages/server/src/services/README.md:203-207` — already names `character-spell.ts`'s inline spell-rule enforcement (`calcMaxPrepared`, spell-class availability, max-prepared checks) as known and deliberately scoped out of a closed audit's C2 leaf.
- `packages/server/src/services/README.md:253-265` — the three-question rubric; Q1 routes a pure helper with no transaction boundary to `utils/`.
- `packages/server/src/services/README.md:21-28` — the "promote when all three hold" criteria for a `services/<name>/` folder.
- `packages/server/src/services/rest-MODULE.md:5-8` — "Single-file flat service (`rest-service.ts`)… Promote to `services/rest/` only when the implementation actually wants multiple internal files."
- `packages/server/src/services/rest-service.ts:29-30` — imports `toCharacterForRest` from `rest-character-mapping.ts` (50 lines) and `logRestHpChange`/`broadcastRestHpAttribution` from `rest-encounter-attribution.ts` (44 lines); neither sibling has any consumer outside `rest-service.ts`. File is 457 lines.
- `packages/server/src/services/rest-service.ts` — the long-rest core uses
  `{ isolationLevel: "Serializable" }`, the shared two-shape
  `isPrismaSerializationFailure` predicate, a bounded retry loop, and explicitly
  checked versus unchecked mutation helpers; see `docs/CONCURRENCY.md` for the
  current isolation rationale.
- `packages/server/src/routers/homebrew.ts:403-406` — `router({ ...homebrewCrudRouter._def.procedures, ...homebrewCampaignRouter._def.procedures })`. The only non-test `_def` reach-in in `packages/server/src`.
- `packages/server/src/trpc/trpc.ts:82`, `:84`, `:93` — exports `router`, `publicProcedure`, `protectedProcedure` only; `mergeRouters` is not re-exported. It exists on the root object in the installed `@trpc/server` 11.17.0.
- `packages/server/src/routers/auth.ts:181-184` — four-line comment explaining the hand-inlined cookie read; `:185-186` the inlined `parseCookies`; `:52-63` the `getRefreshTokenFromCookie` helper that throws `TRPCError` UNAUTHORIZED / `INVALID_REFRESH_MESSAGE`; `:253` its only remaining caller (logout). Union of callers is exactly two.
- `packages/server/src/services/combat-actions/assert-turn.ts:15-20` — 20-line file, body is `return assertTurnLock(tx, opts);` at `:19` under a 10-line comment at `:5-14`.
- `packages/server/src/services/combat-actions/types.ts:67-70` — the alias re-export; `:62-66` states its purpose ("so the input/result contract has a single source of truth and any field drift is a compile error rather than a silent structural coercion"). `packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts:9`, `:25-26` — a compile-time guard file that exists solely to pin this alias pair.
- `packages/server/src/services/combat-actions/assert-turn.ts:5-14` — the JSDoc records both the lock invariant it exists to name (pins `round` *and* `currentTurnIndex` so a stale action cannot land after a turn wrap) and the facade-cycle rule that explains the direct-import convention.
- `packages/server/src/services/combat-actions/MODULE.md:36-42` — documents the facade/internal-import split as deliberate and advertises the domain-facing name `assertTurnInsideTx`.
- `packages/server/src/services/combat-actions/combat-actions.ts:38` — facade re-export consumed cross-module by `packages/server/src/services/spell-casting/combat-transaction.ts:9`, `:160`. Only two runtime call sites total (the other is `attack-transaction.ts:28`).
- `packages/server/src/routers/srd.ts:113`, `:120`, `:125`, `:130`, `:142`, `:155`, `:214` — single-letter parameters `sp`, `st`, `sub`, `sst`, `f`, `c`. File is 561 lines.
- `packages/server/src/routers/srd.ts:88` `SUBCLASS_REFERENCE_SELECT` (used at `:417` and `:446`), `:214` `mapFeat` (used at `:208` by `mapBackground`, at `:315` as the `map:` field of the `listFeats` `srdListProcedure` call, and at `:461`), `:142` `mapClassFeature` (used at `:179` and `:189` by the class *and* subclass mappers, and at `:299` as the `map:` field of the `listClassFeatures` `srdListProcedureWithInput` call) — real cross-family reuse, including inside the shared list-procedure factory calls.
- `packages/server/src/utils/encounter-state-mutations.ts:209-264` — `assertTurnLock`; DM branch `:218-238`, non-DM `:240-263`. The only substantive differences are the extra `currentTurnIndex: actorSortOrder` in the non-DM WHERE and the thrown error on `count === 0` (CONFLICT "Encounter round has changed" versus FORBIDDEN `NOT_PARTICIPANT_TURN`). The `state !== "active"` guard and the whole tail are byte-identical.
- `packages/server/src/utils/encounter-state-mutations.test.ts:28-95` — exercises the DM branch only.

## Proposed direction

Ordered cheapest-and-safest first. Steps 1, 2, 3, 4a and 5 are each one commit;
4b is a decision that may resolve to "do nothing".

1. **Replace the `_def` reach-in.** Add `export const mergeRouters = t.mergeRouters;` to `packages/server/src/trpc/trpc.ts`, then rewrite `routers/homebrew.ts:403-406` to use it. Procedure keys and the client-facing `trpc.homebrew.*` surface are unchanged. See `docs/guides/add-trpc-procedure.md`. In the same commit, update the router map at `packages/server/src/routers/routers-MODULE.md:109`, which currently reads "`homebrewRouter` composes `homebrew-campaign.ts`'s procedures via `..._def.procedures`, so it has **no own mount key**": swap `..._def.procedures` for `mergeRouters` and keep the "no own mount key" note. That cell is the only reference to `_def` in any doc outside `docs/agent_notes/`, so leaving it behind means the repo's router map describes a composition mechanism the tree no longer uses.
2. **Reshape `getRefreshTokenFromCookie` to return `string | null`.** Let logout throw at its own site; delete the hand-inlined `parseCookies` at `auth.ts:185-186` and the four-line comment at `:181-184` that only exists to explain the divergence.
3. **Rename the single-letter parameters in `routers/srd.ts`** (`sp`, `st`, `sub`, `sst`, `f`, `c`). Independent of any file split, and the highest value-per-line change in this leaf — **but leaf 46 step 3 prescribes the same sweep with a fuller inventory** (ten spellings, plus the `item`/`fetch`/`output` parameters in `utils/srd-query-helpers.ts` and its call sites). Do it once, under leaf 46, and drop this step if leaf 46 lands first. See caveats.
4. **Fix `rest-MODULE.md` first; treat the folder promotion as a separate, conditional step.**
   - 4a (unconditional): rewrite `rest-MODULE.md:5-8` so it describes the actual file set instead of asserting rest is a single file. This is true whatever the layout ends up being, and it is the part of this finding that is not contingent on other leaves.
   - 4b (conditional, only after leaf 04 step 5): re-count rest's internal files against `services/README.md:21-28`. Criterion 3 wants ≥3 internal files carrying their weight after the split. Rest has three today (`rest-service.ts`, `rest-character-mapping.ts`, `rest-encounter-attribution.ts`), but leaf 04 step 5 dissolves `rest-encounter-attribution.ts` into a single shared HP-attribution broadcaster. If that lands, rest has two files, criterion 3 fails, and rest stays a flat service with the corrected `-MODULE.md` companion — which is the shape `services/README.md:40` describes for exactly this case. If leaf 04 step 5 is dropped or lands differently and three files still carry weight, then promote: move all three into `services/rest/`, rewrite imports, and refresh the doc per `docs/guides/add-module-doc.md`. The promoted folder must satisfy the facade convention at `services/README.md:33-38` — a named, logic-bearing `services/rest/rest.ts`, explicitly *not* a re-export-only `index.ts` barrel — with `rest-character-mapping.ts` and `rest-encounter-attribution.ts` as its internal splits, and `rest-MODULE.md` becoming `services/rest/MODULE.md`. Moving `rest-service.ts` in under its current name lands a folder whose facade does not match the pattern `level-up/`, `spell-casting/`, `combat-actions/`, `character-live-state/` and `map-tokens/` all follow. Pure file moves plus import rewrites; runtime behaviour must not change.
5. **Move the prepared-spell rule enforcement to `packages/server/src/utils/prepared-spells.ts`** — `calcMaxPrepared` plus the prepare-limit guard from `character-spell.ts:195-224` — with direct unit tests. Write the tests first; the payoff of this step *is* testability, not deduplication.
6. *(Optional, lowest payoff.)* Split `routers/srd.ts` by content family, but only after hoisting `SUBCLASS_REFERENCE_SELECT`, `mapFeat` and `mapClassFeature` into one shared module that the family files import.
7. *(Optional, medium risk, gated.)* Merge the two `assertTurnLock` branches in `utils/encounter-state-mutations.ts:209-264`, non-DM test first. Do not start this without reading the caveats below. **Deleting `assert-turn.ts` is not part of this leaf's direction** — see the caveat; keep the facade.

## Scope / caveats

- **Do not create `services/character-spells/`.** There is no transaction boundary, no multi-write sequencing, no shared concurrency state and no 3+ internal files, so `services/README.md:253-265` Q1 routes this to `utils/`, and `services/README.md:203-207` already records the inline enforcement as known and deliberately scoped out of a closed audit. Step 5 is a ~50-line helper extraction, nothing more.
- Two things not to claim in the commit message: mapping is *already* extracted (`mapSpell` from `utils/spell-mapping.ts`, `resolveCombatEligibility` from `services/spell-casting/combat-eligibility.ts`), and inline single-row persistence plus `emitCharacterUpdate` is the *documented correct* shape for a router calling a shape-2 helper (`services/README.md:108-118`). "Peer routers are thin" holds only inside the spell family — at 281 lines `character-spell.ts` is the 5th largest router, behind `srd.ts` (561), `homebrew.ts` (406), `auth.ts` (348) and `campaign.ts` (299).
- **`routers/srd.ts` is not "unrelated content families".** It is one uniform read-only catalog: every procedure is 5–10 lines built on three shared factories (`srdListProcedure`, `srdListProcedureWithInput`, `srdGetByIdProcedure` from `utils/srd-query-helpers.ts`), and the file is already banner-sectioned. A naive family split does not cut cleanly — `SUBCLASS_REFERENCE_SELECT`, `mapFeat` and `mapClassFeature` each straddle families. The payoff is navigational file size only, so if step 6 is cut, nothing of substance is lost; what must **not** happen is per-family copies of those shared selects and mappers.
- **Do not delete `assert-turn.ts`.** Every one of its five artifacts does work that is written down, so deleting the file trades a real asset for a file count. `assertTurnInsideTx` is the domain-facing, transaction-scoped name that `combat-actions/MODULE.md:36-42` advertises as the module's cross-module turn-validation primitive, and its JSDoc at `assert-turn.ts:5-14` is the only place the lock invariant (pins both `round` and `currentTurnIndex` so a stale action cannot land after a turn wrap) and the direct-import/facade-cycle convention are stated together. The alias pair at `types.ts:67-70` exists so field drift against `utils/encounter-state-mutations.ts` is a compile error (`:62-66`), and `utils/__type-tests__/assert-turn-opts-dedup.ts` is what makes that guarantee enforced rather than aspirational. Deleting the file would also cost four files plus a MODULE.md edit and would break the facade export at `combat-actions/combat-actions.ts:38` that `spell-casting/combat-transaction.ts:160` consumes cross-module. If the five-artifact footprint still reads as heavy to a future maintainer, the correct response is a sentence in `combat-actions/MODULE.md` explaining why, not a removal.
- **`assertTurnLock` is race-sensitive locking code and its exact WHERE clause *is* the lock semantics.** Read `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` before touching it. Two flat, separately auditable branches have review value that a conditionally-built WHERE object destroys — a reviewer can currently read each lock predicate end to end. And `utils/encounter-state-mutations.test.ts:28-95` covers the DM branch only, so a merge would refactor the non-DM path with no direct unit coverage. If step 7 happens at all: write the non-DM test first, then merge. Body is 52 lines and merges to roughly 28 — a small win for a real risk.
- **Preserve verbatim during step 4b:** the `Serializable` isolation choice and
  its isolation rationale, the bounded retry loop using the shared two-shape
  serialization-failure predicate, the checked/unchecked mutation-helper
  distinctions, and the documented Stats→CC lock ordering. The one thing in
  `rest-MODULE.md` that is *not* preserved is the "single-file flat service /
  promote only when…" sentence at `:5-8` — step 4a rewrites it either way.
- **Preserve behaviour during step 2:** logout must keep throwing the same UNAUTHORIZED / `INVALID_REFRESH_MESSAGE` pair, and refresh must keep emitting `logMutation({ event: 'auth.refresh', outcome: 'failure', reason: 'invalid_refresh' })` before throwing. Both look asserted-on; this is mechanical but not zero-thought.
- **Sequencing with leaf 04.** This is a decision dependency, not just a merge conflict. Leaf 04 step 5 consolidates the HP-attribution vocabulary and dissolves `services/rest-encounter-attribution.ts`; that file is one of the three internal files this leaf counts to satisfy `services/README.md:21-28` criterion 3. Land leaf 04 step 5 first, then evaluate step 4b against what is left. Do not promote rest to a folder while leaf 04 step 5 is in flight, and do not run both edits on that file at once.
- **Sequencing with leaf 46.** Two overlaps, both real. (1) Leaf 46 step 3 is the same `routers/srd.ts` mapper-parameter rename as step 3 here, with a wider inventory; give the naming sweep a single owner — leaf 46 — and let this leaf drop its step 3 rather than renaming the same parameters twice. (2) Leaf 46 step 2 renames `chatMsg`/`chatPayload` inside `services/rest-service.ts`, which step 4b would move to `services/rest/`. Sequence them: either land leaf 46 step 2 before the move, or do the move first and let leaf 46 retarget the path. Do not run them concurrently.
- **Sequencing with leaf 45 — decided: step 7 is dropped.** Leaf 45 steps 1 and 4 rewrite the `encounter-state-mutations.ts` header whose shape 5 (`:37-41`) describes the two `assertTurnLock` branches step 7 here would merge. The question this caveat asks is answered by [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md): **step 7 is dropped permanently**, so shape 5 stays verbatim, leaf 45's S14 can land immediately, and the edge dissolves. Do not re-open the merge; the reasoning is in the plan's rejected-alternatives table.
- Steps 6 and 7 are the two items that do not share this leaf's cause and can be split into their own leaves if the rest lands without them.
