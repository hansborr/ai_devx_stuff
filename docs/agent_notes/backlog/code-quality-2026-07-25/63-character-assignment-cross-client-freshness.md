# 63. Character assignment invalidation cannot establish authoritative cross-client freshness

Status: **Done 2026-07-30 with a narrow same-client guarantee** on branch
`fix/cq-56-63-client-freshness`, finalized in `5fd87705c`. Successful assignment
and unassignment invalidate campaign detail plus the initiating client's entire
`character.get` query family. This makes old/new character identity and socket
callback ordering irrelevant: all local detail matches become stale, active
sheets refetch immediately, and inactive sheets refetch when next opened. The
authoritative `character:associationChanged` event is deliberately declined as
a product tradeoff: the remaining cross-client mismatch has **no time bound**
and can persist until an applicable refetch trigger. Building the event would
add a shared contract, global subscription and reconnect policy, user-targeted
registry delivery, and affected-id capture across assignment, unassignment,
and campaign deletion. Reopen if real-session impact justifies that machinery.
The unrelated roll-test residue formerly kept here remains open as
[leaf 69](./69-roll-affordance-positive-control.md).
Theme: Character association cache freshness · Area: client + socket · Severity: low · Size: S

Source: `feat/cq-client-followups` final review, 2026-07-28 (Opus and Codex
value-ordering reproductions; Fable premature-rebase reproduction) · Confidence: high

**Evidence in this leaf was originally pinned to `34b012780`.** Re-resolve line
anchors by symbol before implementation.

## Problem

Character assignment rewrites `character.campaignId`, which is the character
sheet's campaign identity. One swap can therefore make two cached
`character.get` results wrong: the outgoing character still appears linked and
the incoming character still appears unlinked.

A client-side implementation that tries to invalidate only those two ids must
retain or reconstruct the outgoing identity while campaign detail can refetch
through the mutation's socket broadcast. That made ordinary rapid
reassignment, prop transitions, and mutation callback ordering part of the
cache-correctness mechanism.

Even a correct initiating-client invalidation cannot establish authoritative
freshness on another browser or device. No user-targeted association event is
delivered there, and `staleTime` does not schedule a future refetch, so a wrong
association may remain visible until an independent trigger.

## Evidence

- `packages/client/src/components/campaign/members/members-panel.tsx` calls one
  success helper for both assignment mutations. It invalidates
  `campaign.get(campaignId)` and the full local `character.get` family; it does
  not read member props or mutation ordering to identify affected sheets.
- `packages/client/src/lib/query-invalidation.ts` expresses the family operation
  as `trpc.character.get.queryFilter()` with no input.
- `packages/client/src/lib/query-invalidation.test.tsx` proves family
  invalidation marks inactive detail queries stale, refetches an active detail
  query, and leaves an unrelated query untouched.
- `packages/client/src/components/campaign/members/members-panel.test.tsx`
  verifies the family filter after assign and unassign and preserves campaign
  detail invalidation.
- TanStack Query invalidation matches every query in the family but defaults
  refetching to active observers. A campaign with many members therefore does
  not refetch every cached sheet at mutation success.
- `packages/server/src/routers/campaign.ts` broadcasts `campaign:updated`
  before the assignment mutation returns. Family invalidation remains correct
  regardless of whether that campaign refetch lands before or after success.

## Declined authoritative direction

The original proposal was to add the Branch B association-freshness design from
`CLIENT-CLUSTER-PLAN.md`:

- emit a user-targeted `character:associationChanged` event after persistence
  for every writer that changes or removes a character association;
- invalidate affected `character.get` entries even when a sheet is unlinked;
- cover assignment, unassignment, campaign deletion, and reconnect delivery.

That remains the mechanism required for authoritative cross-client freshness,
but it is deliberately unscheduled at this severity. Local family invalidation
is a small initiating-client guarantee, not a substitute for delivery to other
clients.

## Scope / caveats if reopened

- Do not widen `character:updated`. It is campaign-room scoped and requires a
  campaign id, while the affected sheet may be unlinked.
- Capture affected character ids at the server persistence boundary. A client
  that did not initiate the write cannot infer every writer or ordering.
- Define reconnect behavior as part of the event design; a transient live event
  alone is not authoritative after a disconnected write.
- Keep local family invalidation unless the replacement provides an equivalent
  initiating-client guarantee. It is cheap because only active detail observers
  refetch.
