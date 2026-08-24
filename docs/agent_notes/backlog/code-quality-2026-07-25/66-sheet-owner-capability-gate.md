# 66. A public character sheet offers its whole mutation surface to a viewer who does not own it

Status: **Implemented on `fix/cq-66-sheet-owner-capability` as `f0f180778`, with
review corrections through `2f478da92`; merged as `51065bc7c`.** The pre-merge
panel's non-blocking callback-source and empty-details follow-ups are filed as
[leaf 72](./72-sheet-capability-callback-source.md). The first implementation
was reviewed and withdrawn as over-scoped 2026-07-30 at discarded tip
`d552c6b9d`. The withdrawn
`fix/cq-62-66-67-client-affordances` attempt mixed the affordance rule with
capability plumbing, whole-sheet gating, dialog lifecycle work, and inventory
behavior. Rebuild at the existing sheet composition root with one
`owner | dm | viewer` access discriminant projected into owner-only structural
and owner-or-DM live-state capability buckets, then spend those capabilities
through the sheet's existing optional callbacks; do not introduce a whole-sheet
`readOnly` mode. The independent campaign-input defect began with rest/sorcery
in `1d12fced2` and was completed across the sheet's existing owner-or-DM
mutation callbacks in `b83a6bd91`; it is no longer part of this leaf.
Theme: Viewer capability on a shared sheet · Area: client · Severity: low · Size: S

Source: the `feat/cq-client-followups` round-two review (2026-07-28), which
scoped the Homebrew half into that branch and recorded the wider gap as "noted
for a separate leaf, not for round three"
([CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md), `## Decided — design panel,
2026-07-28`) · Confidence: high — re-verified against the live tree

**Evidence in this leaf is pinned to `d703c2e6b`.** Re-resolve line anchors by
symbol before implementation.

## Problem

The character sheet models one viewer axis and not the other. Round three built
`SheetCampaignContext` so that *member* capability is a type, not a raw id — the
Homebrew tab, the campaign link, the game log and the mobile Log gate all take
the narrowed member variant. **Owner capability was never modelled at all.**

`character.get` serves any authenticated viewer a character whose `visibility`
is `"public"` (`routers/character.ts:60-62`). Nothing in the sheet compares that
character's `userId` to the viewer's: the only read of `character.userId` in the
whole page is the one `useRollPermission` takes (`sheet-layout.tsx:137`). So a
non-owner opening a shared public sheet is presented the full mutation surface —
inventory Add and per-row Edit/Delete, stat and personality edits, rest and
level-up — every one of which the server refuses.

**This is an affordance defect, not an authorization hole, and the leaf should
not be scheduled as if it were one.** Inventory list/create/delete are
owner-gated server-side by `assertCharacterOwner`, which throws `NOT_FOUND` for
a non-owner (`utils/character-auth.ts:16-55`). `inventory.update` is the one
owner-or-DM operation and now receives resolved campaign scope. Because the
*read* remains owner-gated (`routers/inventory.ts` `list`), a DM or other
non-owner still cannot populate the panel; a public-sheet viewer is nevertheless
offered buttons whose owner-only paths will fail.

Inventory is the instance the review recorded and the one this leaf carries. The
class is wider, and step 3 below is what keeps the leaf honest about that.

## Evidence

- **Public read for a non-owner:** `packages/server/src/routers/character.ts:60-62`
  — `character.userId !== ctx.user.id && character.visibility !== "public"` is
  the only refusal.
- **No owner axis in the sheet:** `packages/client/src/pages/character-sheet/sheet-layout.tsx:118-133`
  reasons carefully about `campaignIdentity` vs `memberCapability` and says
  nothing about ownership; `:137` is the page's only `character.userId` read.
- **Mutation callbacks passed unconditionally:**
  `packages/client/src/pages/character-sheet/sheet-helpers.ts:117-141`
  (`buildInventoryProps` — `onCreateItem`, `onUpdateItem`, `onDeleteItem`), whose
  JSDoc documents the *member* contract and not an owner one.
- **The affordances themselves:**
  `packages/client/src/components/sheet/inventory-panel.tsx:42-60` (`PanelHeader`'s
  `+ Add`) and `:89-94`/`:144-145` (per-row `onEdit`/`onDelete` into
  `InventoryItemRow`).
- **The server gates:** `packages/server/src/routers/inventory.ts` keeps `list`
  and `delete` owner-only; `inventory-service.ts` keeps create owner-only and
  admits owner-or-DM update when `campaignId` is present.

## Proposed direction

1. **Add an owner capability to the sheet context**, alongside the existing
   member capability — derived during render from the character and the
   authenticated viewer, not an effect, per `docs/guides/client-effects.md`.
2. **Match inventory mutation props to the server capabilities at the type
   level:** create/delete are owner-only; update is owner-or-DM only where the
   inventory is actually readable. A viewer build produces a read-only panel
   rather than callbacks that 404. Pin it with the mechanical acceptance test
   the member change used — the ungated call must fail to compile.
3. **Sweep the rest of the sheet for the same class** — stats, personality, rest,
   level-up and spells all take mutation callbacks through `SheetBody` with no
   owner check. Either bring them into the same gate in this leaf or record
   explicitly which surfaces were left and why; do not close the leaf having
   fixed only inventory.

## Scope / caveats

- **Do not present this as closing a security gap.** The server already refuses
  every path; re-framing it that way invites a fix that duplicates the server
  gate client-side and treats the client's answer as authoritative. The
  deliverable is that a viewer is not offered what they cannot do.
- **Read policy is settled and outside this mutation-affordance change.**
  `inventory.list` is owner-only, including a named DM-denial test;
  `characterSpell.list` is likewise owner-only for enriched spell rows, also
  with DM denial. Raw known-spell junction rows remain present in public
  `character.get` output. This leaf must not widen any of those read gates.
- **Ownership is not membership, and the two must not be collapsed.** A campaign
  DM is not the character's owner; `assertCharacterOwner` refuses them on
  inventory list/create/delete, while `assertCharacterOwnerOrAccess`
  (`character-auth.ts`) admits them on inventory update and other live-state
  operations. A single "can edit" boolean over both axes would misstate the
  server's own contract.

## Outcome

The live-tree audit confirmed that less remained than the original problem
statement: `b83a6bd91` had already completed DM campaign scoping for every
owner-or-DM live-state hook. This delivery therefore changed no hook inputs,
server authorization, read gate, query, socket, or dialog lifecycle.

`sheet-layout.tsx` now derives one render-time `owner | dm | viewer` access
discriminant and projects it into two callback buckets:

- owner-only structural callbacks cover level-up, personality, inventory
  create/delete, known-spell addition, and weapon masteries;
- owner-or-DM live-state callbacks cover stats/HP/death saves, rest, inventory
  update, prepared/cast/concentration/slot operations, and sorcery points.

Mutation props are optional at the presentation boundary. Omitting them removes
HP adjustment and death-save controls, inventory and spell buttons,
preparation checkboxes, flexible-casting controls, and interactive spell-slot
pips while leaving HP/death-save values, inventory/spell content, sorcery-point
current/max values, and static slot state mounted. An owner still receives the
full callback set. Membership affordances and roll permission retain their
existing, separate rules.

Deliberately declined: a whole-sheet `readOnly` prop, a capability framework,
dialog remount/reset work, campaign-input plumbing, changed inventory copy, and
any client-side defensive authorization layer. Each was either part of the
withdrawn over-scope or duplicated a server contract this affordance fix does
not own.

## Verify

```
bun run test -- --project client src/components/sheet/inventory-panel.test.tsx
bun run test -- --project client src/components/sheet/hp-adjuster.test.tsx
bun run test -- --project client src/components/sheet/death-saves-interactive.test.tsx
bun run test -- --project client src/components/sheet/sorcery-points-panel.test.tsx
bun run test -- --project client src/components/sheet/spell-slot-pips.test.tsx
bun run test -- --project client src/pages/character-sheet/sheet-helpers.test.ts
bun run test -- --project client src/pages/character-sheet/sheet-layout.test.tsx
bun run typecheck
```
