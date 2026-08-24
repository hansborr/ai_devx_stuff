# 180. Derive homebrew entry selectors and labels from one exhaustive client metadata registry

Status: Not started
Theme: exhaustive homebrew metadata · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The nine homebrew entry types are repeated across shared validation, client
editor typing, labels, creation options, and collection filters. Several of
those repetitions are already compiler-exhaustive, so a new type cannot omit
its schema, form binding, editor, or card label silently.

The remaining gap is narrower but user-visible: the create-selector and
collection-filter arrays are ordinary typed arrays, not exhaustive records. A
contributor can fully implement a new entry type and still omit it from one or
both arrays. The code compiles, but users cannot create that type or select it
as a collection filter. Display order and pluralization also have no clear
client-side owner.

## Evidence

- `packages/shared/src/schemas/homebrew.ts:61-73` defines the nine-value
  `HomebrewEntryType` runtime enum and type.
- `packages/shared/src/schemas/homebrew.ts:223-234` maps all nine types to
  validation schemas with
  `satisfies Record<HomebrewEntryType, ...>`, so shared validation is already
  exhaustive.
- `packages/client/src/components/homebrew/entries/entry-editor-registry.ts:65-85`
  maps entry types to concrete form data, while `:162-217` uses a mapped type
  over `HomebrewEntryType` for the editor registry. These editor bindings are
  already compiler-enforced and serve a different purpose from presentation
  metadata.
- `packages/client/src/components/homebrew/entries/entry-card.tsx:9-19` has a
  separate exhaustive `Record<HomebrewEntryType, string>` for singular card
  labels.
- `packages/client/src/components/homebrew/entries/entry-dialog.tsx:31-41`
  hand-lists the create options in feat-first display order. The array element
  type constrains listed values but does not require every enum value.
- `packages/client/src/pages/collection-detail-page.tsx:23-36` independently
  hand-lists plural filter labels in the same display order, again without an
  exhaustiveness check.
- The filter narrowing comment at
  `packages/client/src/pages/collection-detail-page.tsx:137-145` relies on
  `TYPE_FILTER_OPTIONS` matching the shared enum, but the compiler does not
  currently establish that premise.
- `packages/client/src/components/homebrew/entries/MODULE.md:11-17` says
  `entry-editor-registry.ts` is the only place that knows every entity type and
  that nothing else changes after adding its entries. The two option arrays
  make that contributor instruction false.

## Proposed direction

Create
`packages/client/src/components/homebrew/entries/entry-type-metadata.ts`; that
module does not exist yet. It should own a compiler-exhaustive record such as:

```ts
Record<
  HomebrewEntryType,
  { label: string; pluralLabel: string; order: number }
>
```

Check the literal with `satisfies`, following the shared
`HOMEBREW_DATA_SCHEMAS` idiom. Keep `pluralLabel` explicit because mechanical
pluralization fails for “Species.”

Use `homebrewEntryTypeSchema.options` as the runtime key source, map each value
through the metadata record, and sort by the explicit `order`. Preserve the
current feat-first order exactly:

`feat`, `spell`, `item`, `species`, `class`, `subclass`, `background`,
`magicItem`, `monster`.

Derive the three presentation surfaces from that module:

- replace `ENTRY_TYPE_OPTIONS` with ordered singular metadata;
- replace `ENTRY_TYPE_LABELS` with direct metadata lookup;
- replace the entry-type portion of `TYPE_FILTER_OPTIONS` with ordered plural
  metadata, while keeping the `"all"` sentinel local to
  `collection-detail-page.tsx`.

Update the type-assertion-boundary comment at
`collection-detail-page.tsx:143` so it names the exhaustive derived option
source rather than the deleted hand-written array. Extend
`entry-dialog.test.tsx` using TDD and add a small metadata test that pins
exhaustiveness-derived order, singular labels, and plural labels.

Refresh `entries/MODULE.md` under
`docs/guides/add-module-doc.md`. Its “adding a new entity type” checklist should
name the metadata record as the one presentation step and explain that selector,
card, and filter options then flow automatically.

## Scope / caveats

- Do not change `packages/shared`. Validation schemas remain shared; labels,
  plurals, and display order are client presentation concerns.
- Do not restructure `EntryFormByType` or `EDITOR_REGISTRY`. They are already
  exhaustive and preserve per-entry generic form typing that the metadata
  registry should not absorb.
- Preserve current display order explicitly. Iterating the shared enum without
  sorting would silently change the UI to species-first order.
- Keep the `"all"` filter sentinel outside `HomebrewEntryType` and outside the
  exhaustive metadata record.
- **Sequencing:** No hard ordering dependency with
  [095-homebrew-module-index-sends-contributors.md](./095-homebrew-module-index-sends-contributors.md),
  but coordinate the final contributor recipe: if leaf 095 lands first, re-check
  its parent-module pointer against the resulting split between
  `entry-editor-registry.ts` and the new presentation metadata record; if this
  leaf lands first, leaf 095 must describe that surviving split rather than
  restoring a one-registry recipe. No other sequencing dependency is recorded.
