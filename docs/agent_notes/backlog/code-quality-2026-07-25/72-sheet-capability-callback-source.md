# 72. Sheet capability gating can fail open when a prop builder gains a callback

Status: **Open — post-merge hardening for leaf 66; owner priority required.**
The empty viewer item-details region is an opportunistic cosmetic substep and
does not justify independent scheduling.
Theme: Capability-safe prop composition · Area: client · Severity: low · Size: S

Source: leaf 66 pre-merge panel, 2026-07-31. Fable identified the fail-open
callback source; Opus 4.8 identified the empty viewer details region. Both were
P2, non-blocking findings and both reviewers still recommended merge.
Confidence: high for the present shape; the primary risk is future drift, not a
currently exposed affordance.

Evidence is pinned to `1fcd9341b`. Re-resolve symbols before implementation.

## Problem

Leaf 66 correctly gates every mutation callback the sheet exposes today, and
its owner/DM/viewer matrix covers that current inventory. The composition shape
can nevertheless fail open when the surface grows.

`buildInventoryProps` and `buildSpellsProps` return the full panel prop types,
including ungated mutation callbacks. `sheet-layout.tsx` spreads those objects
into `SheetBody`, then overwrites the callbacks it knows about with the
structural or live-state projections. A future callback added to either helper
therefore flows through the spread to a viewer unless the contributor also adds
the exact override at the composition root. The callback is optional at the
presentation boundary, so omission from the two capability buckets need not be
a compile error.

There is no current authorization or affordance defect: the explicit override
list covers today's mutation props and the server remains authoritative. This
leaf records compile-time hardening against the next callback rather than
reopening leaf 66's shipped behavior.

The same panel found one cosmetic consequence of read-only rendering. When an
inventory item has no description and all mutation callbacks are absent,
expanding it renders a labelled details region whose only child is an empty
action row. No information or entitlement is lost, so this does not warrant its
own leaf.

## Evidence

- `packages/client/src/pages/character-sheet/sheet-helpers.ts:117-140` returns
  `InventoryPanelProps` with `onCreateItem`, `onUpdateItem`, and `onDeleteItem`.
- `packages/client/src/pages/character-sheet/sheet-helpers.ts:149-215` returns
  `SpellsPanelProps` with prepared, cast, concentration, slot, and add-spell
  callbacks. `onSelectSpell` is the separate read-only dialog affordance.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:180-203` builds
  the two capability projections by enumerating the current callback names.
- `packages/client/src/pages/character-sheet/sheet-layout.tsx:244-258` spreads
  both helper results before enumerating those names again as overrides. A new
  helper callback not added to this second list survives unchanged.
- `packages/client/src/pages/character-sheet/sheet-layout.test.tsx:165-252`
  proves the current owner/DM/viewer matrix in both directions. It is an
  inventory of today's controls, not a type-level guard over future keys.
- `packages/client/src/components/sheet/inventory-item-row.tsx:39-147` always
  renders the details region and action-row container. With no description,
  `onUpdate`, or `onDelete`, both are visually empty.

## Proposed direction

1. Make the view-data helpers incapable of returning gated callbacks. Separate
   inventory and spell view props from required structural/live-state callback
   source objects; make only the final presentation props partial. Keep
   `onSelectSpell` in the read-affordance side of the boundary.
2. Make adding a mutation callback fail compilation until it is classified into
   the owner-only or owner-or-DM source and projected at the composition root.
   Demonstrate this with a temporary callback addition whose type error names
   the unclassified key; do not rely only on the rendered control matrix.
3. Preserve the existing owner/DM/viewer behavior and matrix. This is a source
   and type-boundary change, not a new capability system or a read-policy
   change.
4. Opportunistically avoid the empty viewer details experience while touching
   this seam — either do not offer a disclosure with no description or actions,
   or render meaningful empty copy. If that requires unrelated interaction or
   accessibility redesign, close this cosmetic substep as declined and record
   why; the substantive callback-source hardening remains independent.

## Scope / caveats

- Do not reopen leaf 66's server authorization, inventory/spell read gates,
  dialog lifecycle, campaign inputs, or the declined whole-sheet `readOnly`
  mode.
- Do not treat `onSelectSpell` as a mutation merely because it is a callback;
  viewers intentionally retain the read-only spell details dialog.
- Do not claim a current viewer leak. The panel traced the present controls and
  found none; the risk is that an unclassified future callback silently bypasses
  the enumerated overrides.

## Verify

Follow TDD with the temporary unclassified-callback type probe, then run:

```
bun run test -- packages/client/src/pages/character-sheet/sheet-helpers.test.ts packages/client/src/pages/character-sheet/sheet-layout.test.tsx packages/client/src/components/sheet/inventory-item-row.test.tsx
bun run typecheck
```
