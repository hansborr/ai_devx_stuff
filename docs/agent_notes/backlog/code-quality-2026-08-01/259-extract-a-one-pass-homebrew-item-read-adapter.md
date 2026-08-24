# 259. Extract a one-pass homebrew-item read adapter

Status: Not started
Theme: Give homebrew-item conversion a pure adapter boundary · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The homebrew-item query component also owns compatibility normalization,
persisted-data parsing, category mapping, and conversion into an inventory
create input. These policies consequently change alongside React query and
rendering code even though they form a pure read adapter.

Each rendered row also parses the same entry twice: once to obtain display
data and again inside the inventory converter. Besides duplicate work, that
split allows display and create-input derivation to acquire different parsing
or normalization behavior.

## Evidence

- `packages/client/src/components/sheet/homebrew-item-tab.tsx:46-61` — the
  component normalizes legacy title-case weapon damage types and parses the
  normalized entry through `homebrewItemDisplaySchema`, returning null on
  failure.
- `packages/client/src/components/sheet/homebrew-item-tab.tsx:64-143` — the
  same file owns equipment-category mapping, weapon and armor property
  construction, invalid-armor handling, and the complete
  `CreateInventoryItemInput` projection.
- `packages/client/src/components/sheet/homebrew-item-tab.tsx:157-176` —
  `HomebrewItemRow` calls `parseItemData` for display and then calls
  `homebrewItemToInventoryInput`, which parses the entry again at `:115`.
- `packages/client/src/components/sheet/homebrew-item-tab.test.tsx:223-242` —
  the component test file already constructs raw entries and tests the exported
  pure converter independently of rendering.

## Proposed direction

Extract a client-local homebrew-item read adapter beside the tab. Have one
function accept the entry, character id, and campaign id; normalize and parse
the entry exactly once; and return either null or an object containing both the
parsed display data and the completed `CreateInventoryItemInput`.

Move category mapping and the weapon, armor, and inventory-input builders behind
that adapter. Make those builders consume the already-parsed
`HomebrewItemDisplay` rather than raw entry data. Keep the query, empty state,
row rendering, pending state, and add callback in `homebrew-item-tab.tsx`; each
row should call the adapter once and render or submit the two returned values.

Move the existing pure conversion cases into a focused adapter test. Preserve
coverage for invalid entries, unknown categories, weight defaults, weapon
properties, armor classification, incomplete armor, and legacy title-case
damage types. Add an explicit regression that an unknown damage type still
fails and that display data and inventory input come from the same normalized
parse.

## Scope / caveats

- Do not change a persisted schema, writer, storage spelling, or database
  payload. Preserve `twoHandedDice` as the authoring/storage spelling and the
  existing downstream `twoHandedDice`/`versatileDice` translation boundary.
- Preserve the current legacy damage-type normalization and null-return
  behavior for unknown or otherwise invalid values. The extraction must not
  make parsing more permissive.
- Prior-pack CQ25-173 in
  [code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md](../code-quality-2026-07-25/SHARED-CLUSTER-PLAN.md)
  refused normalization across persisted shared schemas, reinforced by
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md).
  This leaf retains the client read seam and only separates it from React while
  making its parse one-pass.
- Keep
  [195-validate-concrete-homebrew-entry-data-before.md](./195-validate-concrete-homebrew-entry-data-before.md)
  independent. That proposal validates editor submissions; this adapter reads
  linked persisted items for inventory creation.
