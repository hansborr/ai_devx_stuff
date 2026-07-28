# 56. Every infinite list replays all loaded pages on refetch, and the SRD compendium reads pay it for immutable data

Status: Proposed — not promoted
Theme: One caching policy for cursor-paginated reads · Area: client · Severity: low · Size: S

Source: client-cluster pre-merge panel and adjudication, 2026-07-27 (raised
against slice Q3; deferred out of that branch's charter) · Confidence: high

**Evidence in this leaf is pinned to `709b27668` (`feat/cq-slice-h`).**

## Problem

TanStack Query v5 refetches an infinite query by replaying **every loaded page
sequentially**. The client has four such queries and none of them sets
`staleTime`, `maxPages`, or any refetch override, so all four inherit the app
default of 30 s (`packages/client/src/lib/query-client.ts`) plus
refetch-on-mount-when-stale and refetch-on-window-focus.

The consequence is worst on the two compendium lists, because their data cannot
change at runtime:

- `monster.list` and `magicItem.list` read the seeded SRD tables. There is no
  `monster.create` or `magicItem.create` router — nothing writes to them outside
  the seed. They are effectively immutable, yet they re-fetch every loaded page
  on any mount past the 30 s window.
- `MonsterTab` mounts inside `add-participant-dialog.tsx`, so this fires on
  every encounter "add participant" dialog open.
- `PAGE_SIZE` is 20 against roughly 330 SRD monsters, so a user who has paged
  down several times pays that many requests per refetch.

Since `feat/cq-slice-h` these lists correctly gate Load more on `isFetching`
(see [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md), slice Q3), which is the
right call for correctness — but it means Load more is disabled for the whole
replay sequence. The gate did not create the cost; it made it visible.

## Evidence

- App default: `packages/client/src/lib/query-client.ts`, `staleTime: 30_000`.
- No `maxPages` anywhere: `grep -rn "maxPages" packages/client/src` returns 0.
- No `cancelRefetch` outside doc comments; no `refetchOnWindowFocus` /
  `refetchOnMount` overrides in non-test client source.
- The four infinite queries: `components/compendium/magic-item-list.tsx`,
  `components/campaign/npcs/monster-tab.tsx`,
  `components/campaign/notes/notes-panel.tsx`,
  `hooks/character-sheet/use-inventory.ts`. None sets `staleTime` or `maxPages`.
- Existing precedent for the fix: `hooks/use-srd-lookups.ts` already pins
  `staleTime`/`gcTime` to `Infinity` for SRD reference data.

## Proposed direction

Decide the policy once rather than patching two call sites:

1. **Which reads are SRD-immutable?** `use-srd-lookups.ts` says the codebase
   already has an answer for lookup data; the compendium list reads belong in
   the same bucket. Give them the same `staleTime`/`gcTime` treatment.
2. **Is `maxPages` a house rule for cursor lists?** It bounds replay cost for
   the two genuinely mutable lists (notes, inventory) but changes what "all
   loaded rows" means for the user. This is a UX decision, not a perf tweak.
3. Whatever is decided, record it beside the Load more gating rule in
   `packages/client/src/hooks/MODULE.md`, which is now the shared home for
   infinite-list invariants.

## Why it was not fixed in the client cluster

Q3's charter was the migration of two lists off a bespoke accumulation hook.
Changing caching policy for compendium reads is a separate decision that should
be made across all four infinite queries at once and needs a ruling on point 2,
which a cleanup branch has no standing to make. Nothing here is a correctness
defect.
