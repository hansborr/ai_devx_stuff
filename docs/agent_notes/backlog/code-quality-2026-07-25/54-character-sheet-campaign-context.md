# 54. Character sheet campaign context must come only from the character's authoritative link

Status: **Done 2026-07-28** on branch `feat/cq-client-followups`, merge
`c5985d1da`; see [Landed](./00-index.md#landed). The route search param is
deleted rather than reconciled against a second id, and the sheet context
separates authoritative campaign identity from resolved member capability at the
type level. Cross-client association freshness is deliberately **not** closed
here — that is leaf 63 plus Branch B.
Theme: Single authoritative campaign identity and route simplification · Area: client · Severity: low · Size: S

Source: client-cluster pre-merge panel and adjudication, 2026-07-27 (surfaced
while reviewing slices V1/V2) · Confidence: high

**Evidence in this leaf is pinned to `6cf8c78d5` (`main`), not the pack's
`883d48bf`.** The sheet wiring, route reachability, server authorization seam
and pages-module gap were all re-verified against that commit.

**The owner ruling and route-reader/emitter sweep added in this decision pass
are pinned to `2decbb56a`, current `main` on 2026-07-27.** The sweep covered all
production links and navigations to `/characters/$characterId`, the route's
search validator and every `useSearch` call in the client.

## Problem

The character sheet has two independently editable campaign identities:

- `character.campaignId`, the authoritative link returned with the character;
- the optional `?campaignId=` URL search parameter, supplied as navigation
  context.

Room membership and the character socket already use the authoritative link.
The sheet's viewer, roll permission, roll/stat mutation callbacks, rendered
campaign props, compact game log and back link still use the URL value. A
hand-edited URL can therefore pair a public character from campaign A with
campaign B. If the viewer is a DM in B, the client renders the same DM
affordances it renders for a matching pair even though the character is not
linked to B.

The adjudicator reproduced that result with a throwaway component test:
matching and mismatched pairs rendered the DM affordance identically. The
server then correctly refused the mismatched mutation with `NOT_FOUND`.
`assertCharacterAccess` requires both DM membership in the supplied campaign
and `character.campaignId === campaignId`.

This is **not an authorization hole**. The server fails closed. It is misleading
UI and avoidable failed requests.

Reachability is narrow:

1. the URL must be hand-edited — the members panel is the only production link
   that emits `?campaignId=`, and it uses the campaign whose member character it
   links; and
2. for someone else's character, the character must be public or
   `character.get` returns `NOT_FOUND` before the sheet mounts.

The mismatch was deliberately excluded from leaf 12. That leaf says to feed
the new hook the same id its predecessor received, calls deriving DM-ness from
`character.campaignId` a separate behaviour change requiring its own doc
update, and V2 repeats “do not fold in `campaignId`.” The exclusion was correct:
changing the authoritative id is broader than replacing the viewer predicate.

The owner has now removed the navigation-provenance question: **there does not
need to be a “Back” link. There should be a Campaign link, and it must always
use `character.campaignId`.** Once that link and every authorization-shaped
boundary use the authoritative id, the search parameter has no remaining
reader. The correct shape is therefore to remove the second identity from the
route, not to validate or reconcile it.

## Evidence

- `packages/client/src/pages/character-sheet-page.tsx:23-28,62` reads
  `campaignId` from unconstrained route search state, queries the character
  independently by `characterId`, and passes both values to
  `CharacterSheetContent`. Nothing validates that the pair belongs together.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:105-125` makes the
  split explicit. `sheetCampaignId = character.campaignId ?? null` feeds
  presence and the character socket at `:112-114`; the URL `campaignId` feeds
  `useCampaignViewer`, `useRollPermission`, `useSheetState` and
  `useDmStatsCallbacks` at `:116-125`.
- The same URL value continues into `SheetBackLink` at `sheet-layout.tsx:191`,
  the sheet body at `:245`, and `SheetGameLog` at `:276`.
- `packages/client/src/pages/character-sheet/sheet-state.ts:31-50` resolves
  campaign membership and `isDm` from the supplied URL id.
  `useRollPermission` at `:54-60` gates campaign rolls on that result;
  `useSheetState` threads the id into both roll hooks at `:63-65,121-122`; and
  `useDmStatsCallbacks` merges it into DM stat/HP inputs at `:133-170`.
- `packages/server/src/utils/character-auth.ts:123-189` is the fail-closed seam:
  for a non-owner it loads the supplied campaign membership and the character's
  linked campaign, then permits only `member.role === "dm" &&
  linkedCampaignId === campaignId` at `:160-178`; every other mismatch becomes
  the intentional `NOT_FOUND` at `:181-189`.
- `packages/server/src/routers/character.ts:60-64` makes the non-owner route
  reachable only for `visibility === "public"`.
- `packages/client/src/components/campaign/members/members-panel.tsx:26-49` is
  the only production character-sheet link that supplies the search param. It
  emits its own `campaignId` alongside `member.character.id`, so normal
  navigation produces a matching pair.
- `packages/client/src/pages/MODULE.md:101-110` records the gap at the exact
  composition seam and says the fix is a separate behaviour change.
- [Leaf 12](./12-campaign-context-prop-drilling.md), `## Scope / caveats`,
  explicitly preserves the two-id split for V1/V2; this leaf is the promised
  separate decision, not unfinished slice work.
- **Current-main reader sweep (`2decbb56a`):**
  `packages/client/src/routes/character-sheet-route.ts:16-22` declares
  `campaignId` as the sheet route's only validated search value;
  `packages/client/src/pages/character-sheet-page.tsx:23-25,62` is its only
  production reader and passes it directly to `CharacterSheetContent`.
  `rg` found no other production `useSearch` consumer for the character-sheet
  route.
- **Current-main emitter sweep (`2decbb56a`):**
  `packages/client/src/components/campaign/members/members-panel.tsx:38-42` is
  the only production navigation to `/characters/$characterId` that emits
  search state. The other production entry points,
  `packages/client/src/components/character-card.tsx:40-43` and
  `packages/client/src/pages/character-create-page.tsx:126-131`, navigate with
  `characterId` alone. No reader genuinely needs navigation provenance after
  the affected sheet boundaries move to the authoritative id.

## Decided direction

Remove the second campaign identity instead of managing it:

1. Write the behavior tests first. A linked sheet must feed
   `character.campaignId` to viewer resolution, campaign roll permission, both
   roll hooks, DM stat/HP callbacks, the sheet-body campaign contract, the
   compact game log, presence, the character socket and the Campaign link. An
   unlinked sheet must feed none of those campaign behaviors.
2. Derive one local authoritative campaign id from `character.campaignId` in
   `sheet-layout.tsx` and use it for every boundary above. Preserve owner-local
   sheet behavior where the current hooks intentionally support it.
3. Replace `SheetBackLink` with a Campaign link that renders only for a linked
   character and always targets `/campaigns/${character.campaignId}`. It is not
   a history-sensitive “Back” control, and there is no dashboard fallback to
   preserve as part of that component.
4. Delete `validateSearch` from
   `packages/client/src/routes/character-sheet-route.ts`, delete the
   `useSearch` read and `campaignId` prop plumbing from
   `character-sheet-page.tsx`, and delete the members-panel link's
   `search={...}` emitter. Update the members-panel link test to prove the
   character route has no query parameter.
5. Preserve the unlinked-character contract: an unlinked character must not
   acquire campaign viewer, roll, stat, game-log or presence behavior merely
   because a stale or hand-written URL parameter is present. With no route
   reader, the parameter is inert rather than an alternate identity.
6. Update `packages/client/src/pages/MODULE.md` in the same slice. Replace its
   two-identity warning with the single-authoritative-id contract only when the
   tests prove the whole boundary matrix.

Verification should include the focused sheet-layout/page tests, sheet-state
tests, roll/stat mutation tests touched by the id change, and
`bun run module:index:check`.

## Scope / caveats

- **Do not reopen V1/V2.** Their membership-role resolver and provider are
  correct; this leaf changes which campaign the standalone sheet asks them to
  resolve.
- **Do not weaken the server's `NOT_FOUND` semantics.** The matching-link check
  is intentional authorization behaviour and the reason this defect fails
  closed.
- **Presence and the character socket are already corrected on current
  `main`.** They use `character.campaignId`; keep them in the test plan because
  the leaf is settling the whole seam, but do not schedule a redundant rewrite.
- **Do not retain or validate the search parameter as provenance.** The
  current-main sweep found no remaining consumer once the listed boundaries use
  the authoritative id. This decision removes the two-identity problem rather
  than adding a consistency check between two ids.
- **Unlinked characters make this more than one line.** Removing the URL
  fallback changes rendered campaign UI and mutation routing for a real state
  the app supports; test it deliberately.
- Low severity because reachability requires a hand-edited URL and, for a
  non-owner, a public character, and because the server refuses the request.
- This follow-on leaf had no sequencing dependency on the client cluster's
  then-remaining eight slices and was not part of that remainder.

## Implementation

Branch A on `feat/cq-client-followups` implements this decision and its
round-three type-enforcement follow-up. The route search identity is gone;
`SheetCampaignContext` now separates the character's authoritative campaign
identity from resolved member capability; member-only consumers require
`SheetCampaignMember`; and the rendered nonmember-state matrix plus both roll
hooks are pinned in focused tests. The branch is complete but not merged.

Cross-client assignment/deletion freshness remains deliberately separate in
Branch B's user-targeted `character:associationChanged` leaf, as recorded in
`CLIENT-CLUSTER-PLAN.md`.

`00-index.md`'s row 54 carries the implemented-but-unmerged status. It was held
at main's wording while the branch was unmerged, because editing it collided
with main's adjacent leaf-55 landing hunk; merging `main` into the branch
dissolved that constraint, so the row is reconciled here rather than deferred.
The `## Landed` entry still belongs to the post-merge commit, because it records
the merge sha.
