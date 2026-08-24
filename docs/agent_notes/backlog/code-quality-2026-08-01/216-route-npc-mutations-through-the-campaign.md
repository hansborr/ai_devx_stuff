# 216. Route NPC mutations through the campaign invalidation facade

Status: Not started
Theme: NPC mutations bypass the campaign invalidation facade · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

NPC-list invalidation is a campaign CRUD policy hidden inside its
feature panel instead of being exposed through the campaign-wide invalidation
facade. A future NPC consumer cannot discover or reuse that policy from the
facade, and must know the panel's raw query-key construction. This defeats the
documented one-place extension boundary and lets equivalent mutations drift
toward different invalidation scopes.

## Evidence

- `packages/client/src/lib/query-invalidation.ts:6-16` — the facade documents
  ownership of campaign-wide cache invalidations and says adding one should be
  a one-place closure edit.
- `packages/client/src/lib/query-invalidation.ts:21-115` — the returned
  registry covers campaign, invite, homebrew, encounter, map, chat, note, and
  character invalidations but exposes no NPC-list operation.
- `packages/client/src/components/campaign/npcs/npc-panel.tsx:162-172` — the
  panel constructs a private `invalidateNpcs` callback from
  `npc.list.queryOptions(...).queryKey`.
- `packages/client/src/components/campaign/npcs/npc-panel.tsx:179-205` —
  successful create, update, and delete mutations all call that panel-local
  invalidator.
- `packages/client/src/lib/query-invalidation.test.tsx:47-73` — the facade test
  pins its complete public key set, so adding the missing closure requires an
  explicit contract update.
- `packages/client/src/lib/query-invalidation.test.tsx:96-109,242-250` — the
  routing table verifies that each facade member sends the expected filter to
  `invalidateQueries`.

## Proposed direction

Add `invalidateNpcs(campaignId)` to the object returned by
`useQueryInvalidation`. Implement it as one explicit closure that invalidates
`trpc.npc.list.queryFilter({ campaignId })`, retaining the current
campaign-scoped NPC-list key and invalidation breadth.

In `useNpcMutations`, obtain that closure from `useQueryInvalidation` and call
`invalidateNpcs(campaignId)` after successful create, update, and delete
mutations. Remove the panel's direct `QueryClient` access and private
`useCallback` if they become unused. Preserve the existing ordering of
invalidation, editor closure, and success toasts.

Update the facade's exact-key and routing-table tests for the new member, then
adjust the focused NPC-panel tests to prove successful create, update, and delete mutations
delegate through the facade with the current campaign ID.

## Scope / caveats

- Do not introduce a descriptor map, generic invalidation binder, or new
  abstraction above `useQueryInvalidation`; the settled shape is one named
  closure.
- Preserve the existing query family, campaign-ID scoping, prefix matching,
  and refetch behavior. Do not broaden this into campaign-detail or unrelated
  NPC-cache invalidation.
- Keep mutation ownership and editor/toast behavior in `npc-panel.tsx`; this
  leaf moves only cache-invalidation policy.
- `CQ25-196` in
  [code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md](../code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md)
  at lines 260 and 592-593 already simplified the facade and rejected a
  generic binder. The explicit NPC closure remained uncovered and is the only
  residual addressed here.
