# 44. Three optimistic writers separate transport control fields from cached entity data with three incompatible conventions, and one of them leaks `campaignId` into cached rows today

Status: Not started
Theme: transport vs domain projection · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every optimistic writer in the character-sheet hooks has to answer the same
question in `onMutate`: which fields of the mutation input belong on the cached
entity, and which are transport control data — identifiers, authorization
scope, CAS tokens — that must never land in a cached row? Three hooks answer it
three different ways, and none of the three answers is checked by the compiler:

1. **Inventory doesn't project at all.** `use-inventory.ts` spreads the entire
   `UpdateInventoryItemInput` into cached `InventoryItem` rows
   (`{ ...i, ...variables }`). Because `useCampaignScopedMutation` injects
   `campaignId` into the variables *after* the component's call and *before*
   `onMutate` sees them, every DM-scoped inventory update writes a `campaignId`
   field onto cached `InventoryItem` rows — a field the entity schema does not
   have. Structural typing swallows the excess property, so there is no
   compiler feedback; the stray field sits on the row until the `onSettled`
   refetch wipes it.
2. **Stats maintains a hand-written denylist.** `use-character-stats.ts` filters
   variables through `UPDATE_STATS_CONTROL_FIELDS`, a `ReadonlySet<string>` of
   three names, and its own comment warns that any *future* control field
   someone forgets to add here leaks "a stale, type-invisible field" into the
   cache. The projection's output type is `Record<string, unknown>`, so the
   patch that reaches `applyStatsPatch` has no relationship to `CharacterStats`
   the compiler can see.
3. **Personality filters exactly one key.** `use-character-personality.ts`
   removes only `"id"` with an inline `Object.entries` filter — a third,
   file-local convention.

The cost is twofold. Concretely, the exact hazard the stats comment documents
is live in the inventory hook right now. Structurally, a contributor adding the
next scoped or CAS-guarded mutation has three contradictory examples to copy
from, and whichever they pick, nothing — not the type checker, not a test —
tells them when a new control field on the wire input starts flowing into
cached domain objects.

## Evidence

- `packages/client/src/hooks/character-sheet/use-inventory.ts:66` — the update
  writer's cache patch is `i.id === variables.id ? { ...i, ...variables } : i`,
  spreading the complete `UpdateInventoryItemInput` into the row (`onMutate` at
  `:61-68`).
- `packages/client/src/hooks/character-sheet/use-campaign-scoped-mutation.ts:14`
  — `mutate(campaignId ? { ...input, campaignId } : input)` attaches the
  resolved campaign scope before `onMutate` runs; `use-inventory.ts:92` wraps
  the update mutation in it.
- `packages/shared/src/schemas/inventory-inputs.ts:57-71` —
  `updateInventoryItemInputSchema` is `id` + optional `campaignId` + nine
  optional entity fields, `.strict()`; `packages/shared/src/schemas/inventory.ts:81-97`
  — `inventoryItemSchema` has **no** `campaignId` field (`InventoryItem` at
  `:99`). The spread therefore puts a field on cached rows that the entity
  contract does not admit. No component under
  `packages/client/src/components/sheet/` reads `campaignId` from an inventory
  row today; targeted searches for an inventory-item member access or
  destructure return zero. A broad `campaignId` grep also finds unrelated
  homebrew and campaign props, so it is not the supporting measurement. The
  leak is latent, not yet load-bearing.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:60-64` —
  `UPDATE_STATS_CONTROL_FIELDS: ReadonlySet<string>` =
  `{"characterId", "campaignId", "expectedVersion"}`; `:66-70` —
  `buildUpdateStatsPatch` filters against it and returns
  `Record<string, unknown>`.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:55-59` —
  the denylist's comment is the repo's own statement of this hazard class:
  control fields "would leave a stale, type-invisible field on the cached
  stats object until onSettled wipes it. Add any future control field here,
  not to the stats schema."
- `packages/shared/src/schemas/character-inputs.ts:157-163` —
  `expectedVersion` is a required CAS token on `updateCharacterStatsInputSchema`
  (schema at `:153-187`, `.strict()`), documented against `docs/CONCURRENCY.md`
  — exactly the kind of field the projection exists to keep out of rows.
- `packages/client/src/hooks/character-sheet/use-character-personality.ts:22` —
  the third convention:
  `Object.fromEntries(Object.entries(variables).filter(([k]) => k !== "id"))`,
  then spread into `CharacterDetail` at `:23-26`.
  `updateCharacterPersonalityInputSchema`
  (`packages/shared/src/schemas/character-inputs.ts:134-145`) confirms `id` is
  its only control field, so this filter is correct today — but only by hand.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:72-92` —
  `buildAdjustHpOptimisticPatch` is already a positive, computed patch (built
  from `applyHpAdjustment` output), showing the target shape — but it too is
  typed `Record<string, unknown>`.

## Proposed direction

Give each writer a positive, typed domain-patch projection, and source it from
the shared Zod contract instead of hand-listing fields in the client.

1. **Split the shared input schemas into patch + control layers.** In
   `packages/shared/src/schemas/inventory-inputs.ts` and
   `packages/shared/src/schemas/character-inputs.ts`, extract a positive
   entity-patch schema per affected mutation — e.g. `inventoryItemPatchSchema`,
   `characterStatsPatchSchema`, `characterPersonalityPatchSchema` — containing
   only persisted-entity fields, and recompose each existing wire input as
   `patchSchema.extend({ id/characterId, campaignId, expectedVersion — as
   applicable }).strict()`, exporting the inferred patch types. Wire validation
   semantics must stay byte-identical (see caveats).
2. **Project through strip-mode parse in each writer.** In `onMutate`, build
   the cache patch as
   `const patch: InventoryItemPatch = inventoryItemPatchSchema.parse(variables)`
   (Zod 4 plain objects strip unknown keys by default). This is a positive,
   typed, assertion-free projection: control fields — `id`/`characterId`, the
   `campaignId` that `useCampaignScopedMutation` injects, `expectedVersion` —
   can never reach cached rows, and any future control field added to a wire
   input via `.extend` is stripped automatically with no denylist to maintain.
   Concretely: replace `use-inventory.ts`'s `{ ...i, ...variables }` spread;
   delete `UPDATE_STATS_CONTROL_FIELDS` and `buildUpdateStatsPatch`'s
   `Record<string, unknown>` return, typing `applyStatsPatch` against the new
   stats patch type (its `version: prev.stats.version + 1` increment stays
   exactly where it is); replace personality's `id`-filter with its patch
   parse. A tiny shared projection helper in `cache-helpers.ts` is optional,
   and only if it stays a one-liner.
3. **Relocate the hazard documentation to the new single source of truth.** The
   substance of the denylist comment at `use-character-stats.ts:55-59` moves to
   the shared patch-schema definitions — it is the statement of *why* the
   patch/control split exists — rather than being deleted with the denylist.
4. **Pin the invariants with tests (TDD — write them first).** Beside each hook
   (`use-inventory.test.ts`, `use-character-stats.test.tsx`,
   `use-character-personality.test.ts` all exist), add regression tests
   asserting cached rows contain no `campaignId` / `expectedVersion` /
   `characterId` after an optimistic update — the inventory test should pin the
   concrete leak, i.e. that a scoped update leaves no `campaignId` on the
   cached `InventoryItem`. In shared, add a parity test in the repo's existing
   `.shape`/`toMatchObject` idiom (cf.
   `packages/shared/src/schemas/spell-action-inputs.test.ts:283-284`) asserting
   each recomposed input schema's shape equals its patch shape plus its
   declared control fields. Run with `bun run test -- <file>`.
5. **Update the module doc.** Refresh
   `packages/client/src/hooks/character-sheet/MODULE.md`'s optimistic-flow
   notes (Data Flow / Test Seams / Gotchas sections) to document the
   patch-schema projection as the convention for new optimistic hooks — the
   Gotchas entry pointing at `applyStatsPatch` field maintenance is affected
   directly.

The other optimistic writers in the module (spells, spell-slots, and
sorcery-points) already hand-build positive patch objects; the convention note
may name them as the pattern's neighbors, but refactoring them is not part of
this leaf. Rest and weapon masteries are settled-invalidation hooks, not
optimistic writers.

## Scope / caveats

- **Out of scope:** server routers/services; any change to wire validation
  behavior; `useCampaignScopedMutation` itself; the other optimistic writers
  listed above.
- **Wire-parity is the main risk.** Recomposing the shared inputs can silently
  change wire behavior — losing `.strict()` on the composed input, or (for
  `createInventoryItemInputSchema`-style neighbors, `inventory-inputs.ts:15-49`)
  disturbing `.default(...)`/`.superRefine` — so diff-test that each recomposed
  input schema accepts and rejects exactly what it did before, not just that
  the shapes tally.
- **The parse can throw where the spread could not.** `patchSchema.parse` in
  `onMutate` introduces a client-side runtime parse that throws on contract
  drift where the old spread passed data through silently. Variables are
  already schema-shaped so this is low-probability, but a throw in `onMutate`
  aborts the optimistic-update path — cover it with a test.
- **The inventory fix is a live behavior change.** `campaignId` (and any other
  stripped field) disappears from cached rows between the optimistic write and
  the `onSettled` refetch. No sheet component reads it today (see Evidence),
  but treat any regression around inventory rows as potentially this.
- **No projection via `Object.keys(schema.shape)`.** The repo forbids type
  assertions, and a keys-driven projection needs an `interop` cast; strip-mode
  parse gives the typed projection with zero assertions.
- **`expectedVersion` handling:** it is a *required* control field on
  `UpdateCharacterStatsInput` (CAS token per `docs/CONCURRENCY.md`; see
  `character-inputs.ts:157-163`), so it belongs in the `.extend` control layer
  — and `applyStatsPatch`'s version increment must be preserved unchanged.
- **`buildAdjustHpOptimisticPatch` is retype-only.** It is already a positive
  computed patch; change its `Record<string, unknown>` to the stats patch type
  (or a partial of it) and nothing else.
- **MODULE.md refresh is mandatory**, not optional — the nearest-MODULE rule in
  AGENTS.md applies to `packages/client/src/hooks/character-sheet/MODULE.md`,
  and two of its current entries (the `applyStatsPatch` gotcha, the
  cache-helpers test seam) describe surfaces this leaf changes.
- Coordinate with
  [033-attunement-game-rule-lives-request-schema.md](./033-attunement-game-rule-lives-request-schema.md):
  it relocates MAX_ATTUNED_ITEMS from inventory-inputs.ts while this leaf
  restructures schemas in that module; avoid concurrent edits, with no hard
  ordering.
- Land
  [041-character-hooks-expose-second-identity.md](./041-character-hooks-expose-second-identity.md)
  before this leaf: 041 injects character identity and preserves
  UPDATE_STATS_CONTROL_FIELDS, after which this leaf deletes that denylist and
  makes the positive patch schema responsible for stripping the injected
  identity.
- Coordinate with
  [050-optimistic-character-sheet-mutations-omit.md](./050-optimistic-character-sheet-mutations-omit.md):
  it adds rollback tests around use-inventory's onMutate behavior and edits the
  same inventory test suite; avoid concurrent edits, with no hard ordering.
- No prior-pack coverage of this finding.
