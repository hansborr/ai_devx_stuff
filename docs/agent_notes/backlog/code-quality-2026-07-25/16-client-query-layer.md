# 16. Client query plumbing is hand-rolled where TanStack Query and existing seams already cover it

Status: Open under [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) slices
**Q1, Q2 and Q3**. All six steps remain, split across three independently
landable slices; read the plan rather than scheduling this leaf as one session.
Theme: Client data layer · Area: client · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

Three places in the client hand-write plumbing that the query layer, or an
already-established seam in the same directory, provides for free. The shared
cause is that each was written as a bespoke React construct before the tRPC/
TanStack idiom for it was in use elsewhere in the repo, and nothing pulled them
back once the idiom landed.

`lib/query-invalidation.ts` is 179 lines of hook ceremony wrapping seventeen
invalidation calls. Every one of the seventeen is a `useCallback` with the
identical `[queryClient, trpc]` dependency array, and the closing `useMemo`
repeats all seventeen identifiers twice — once in the object literal and once in
its own dependency array. Both dependencies are already stable (`useTRPC`'s
proxy is memoized by `@trpc/tanstack-react-query`'s `TRPCProvider` on
`trpcClient` + `queryClient`, and `useQueryClient` returns the context value),
so the two memoization layers do the work of one: a single `useMemo` over the
same two deps would give every member the same stable identity. That identity
is worth keeping —
`hooks/realtime-invalidation.ts:59`, `:137` and `:178` put these functions in
`useCallback` dep arrays that feed socket subscription effects — but the second
layer, and the three-places-per-entry bookkeeping it imposes, is not. The cost
is that adding one invalidation means editing the file in three places, and
forgetting the third leaves a silently stale entry.

`hooks/use-debounced-cursor-list.ts` re-implements cursor pagination by hand:
80 lines bundling a debounce timer, a `JSON.stringify` filter identity, cursor
state, reset-on-key-change, and page accumulation. Its two production consumers
both drive tRPC routers that already take a top-level `cursor` and return
`nextCursor`, and the repo already runs exactly this shape through tRPC's
`infiniteQueryOptions` twice — in the notes panel and in the inventory hook. So
the client maintains a private accumulator for two call sites while the library
mechanism is in use elsewhere for two others.

`pages/character-create-page.tsx` keeps half its length in pure wizard-state →
`CreateCharacterInput` transformation, including real domain logic (the
proficiency builder silently injects the `Common` language). The page's test is
86 lines of render assertions and never touches that path, so the entire
request-construction step for character creation is untested — even though
`components/character-create/` already holds `wizard-state.ts` +
`wizard-state.test.ts`, the exact seam this belongs in.

## Evidence

- `packages/client/src/lib/query-invalidation.ts:10-137` — seventeen `useCallback`
  wrappers, each with the same `[queryClient, trpc]` deps.
- `packages/client/src/lib/query-invalidation.ts:139-178` — `useMemo` listing all
  seventeen identifiers twice (object literal `:141-157`, dep array `:160-176`).
- `packages/client/src/lib/query-invalidation.ts:40`, `:114`, `:128` — the three
  entries that are not single-call one-liners: campaign-homebrew fires 2
  invalidations, character-sheet fires 4, homebrew-entries branches on an
  optional argument.
- `packages/client/src/lib/query-invalidation.ts:14-18` — the file's one
  load-bearing comment, on `invalidateInvitePreview`.
- `packages/client/src/lib/trpc.ts:11` — `createTRPCContext<AppRouter>()`; the
  proxy `useTRPC` returns is memoized inside `@trpc/tanstack-react-query` on
  `[trpcClient, queryClient, keyPrefix]`, so the callback deps never change
  identity.
- `packages/client/src/hooks/use-debounced-cursor-list.ts:31-38` debounce timer,
  `:40-43` `JSON.stringify` reset key, `:44-51` cursor state, `:53-56`
  reset-on-key-change effect, `:58-77` page accumulation — five concerns in one
  80-line hook.
- `packages/client/src/components/compendium/magic-item-list.tsx:127` filter-key
  construction, `:131` consumer; `packages/client/src/components/campaign/npcs/monster-tab.tsx:220`
  — the only two production consumers, structurally identical.
- `packages/client/src/components/campaign/notes/notes-panel.tsx:239-240` and
  `packages/client/src/hooks/character-sheet/use-inventory.ts:39-40` — the
  existing `infiniteQueryOptions` precedent against routers of the same shape.
- `packages/client/src/pages/character-create-page.tsx:35` `buildBoostMap`, `:89`
  `buildCreateInput`; roughly `:35-117` of a 170-line page is pure transformation,
  and `:50` injects the `Common` language.
- `packages/client/src/pages/character-create-page.test.tsx` — 86 lines of render
  assertions; `buildCreateInput` is never exercised.
- `packages/client/src/components/character-create/wizard-state.ts` +
  `wizard-state.test.ts` — the existing destination seam.

## Proposed direction

1. Collapse `query-invalidation.ts` to **one** `useMemo` returning an object of
   plain closures: delete the seventeen `useCallback` wrappers and the closing
   `useMemo`'s duplicated seventeen-identifier dependency array, and write
   `return useMemo(() => ({ invalidateCampaignList() { … }, … }), [trpc,
   queryClient])`. The result keeps a stable identity across renders (both deps
   are stable — see the `lib/trpc.ts:11` evidence — and consumers such as
   `realtime-invalidation.ts` list these functions in effect dependency arrays,
   so identity must stay stable). Adding an invalidation becomes a one-place
   edit, and the file loses roughly a third of its length with no new concepts.
   The exported object's keys and call signatures must not change. Carry the
   `invalidateInvitePreview` JSDoc at `:14-18` onto the closure verbatim — it
   records why the invite preview must be invalidated rather than left to
   `staleTime`.
   **Do not introduce a descriptor map plus a generic binder.** The seventeen
   operations do not share a shape worth tabulating. They span six:
   zero-argument (`:10`, `:103`, `:124`), one-argument against five different
   input key names (`{id}`, `{campaignId}`, `{encounterId}`, `{characterId}`,
   `{code}`), `removeQueries` rather than `invalidateQueries` (`:33`),
   `infiniteQueryFilter` rather than `queryFilter` (`:96`), two multi-filter
   entries (`:40` two filters, `:114` four filters mixing both filter builders),
   and one optional-argument branch (`:128`). A descriptor general enough to
   encode all six, plus the mapped type needed to keep each key's parameter list
   intact at every non-test call site, is longer and harder to read than the
   closures it would replace. The ceremony is the target, not the closures.
2. Write the ~10-line `useDebouncedValue` hook, with its own test. It does not
   exist today — `rg useDebouncedValue` across the repo returns nothing — so
   this is new code, not an extraction.
3. Convert `magic-item-list.tsx` to `infiniteQueryOptions` following the
   `notes-panel.tsx` / `use-inventory.ts` precedent, keeping `PAGE_SIZE` and the
   filter input identical. Re-test the `PaginatedResultList` wiring: page
   accumulation, `isFetching` vs `isLoading` semantics, and reset-on-filter-change
   all move into TanStack and their timing changes.
4. Repeat step 3 for `monster-tab.tsx`, then delete
   `hooks/use-debounced-cursor-list.ts` and its test. In the same commit, remove
   the `useDebouncedCursorList` row from `packages/client/src/hooks/MODULE.md:51`
   and add `useDebouncedValue` in its place, per
   `docs/guides/add-module-doc.md`.
5. Move `buildBoostMap`, `buildProficiencies`, `optionalString`,
   `buildBoostedScores`, `buildSpells`, and `buildCreateInput` out of
   `character-create-page.tsx` into a new module under
   `components/character-create/` (beside `wizard-state.ts`), exporting
   `buildCreateInput`. The page keeps only `createMutation.mutate(buildCreateInput(state))`.
6. Add the co-located unit test for `buildCreateInput`. This is the actual payoff
   of step 5 — the functions are already pure and well named, so the file move on
   its own buys little; do not land 5 without 6.

## Scope / caveats

- `packages/client/src/test/mock-query-invalidation.ts` type-mirrors the module
  via `typeof QueryInvalidationModule`. The refactor in step 1 must keep the
  exported shape intact or every test that mocks invalidation breaks; treat that
  mock compiling unchanged as the acceptance check.
- Steps 2-4 touch client cache and query wiring — read
  `docs/guides/add-client-feature-module-cache-socket.md` first. The risk here is
  low but not zero: the observable difference is loading-state and
  reset-timing behaviour in `PaginatedResultList`, not data correctness.
- Do not "simplify" `buildProficiencies` while moving it. The injection of the
  `Common` language is SRD domain behaviour, not boilerplate; if it needs
  changing at all that is a rules change and belongs under
  `docs/guides/change-rules-logic.md`.
- Step 5-6 (character-create extraction) shares the theme but not the mechanism
  with steps 1-4. It is cleanly separable and can be split into its own leaf or
  branch if the query-layer work is scheduled independently.
- No sequencing dependency on other leaves in this pack.
