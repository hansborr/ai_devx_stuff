# 53. The shared FilterSelect widens schema-derived option unions to bare string, so every consumer re-narrows through casts or hand-rolled guards

Status: Not started
Theme: shared control type fidelity · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`FilterSelect` is the client's one shared filter dropdown, and it types `value`,
`option.value`, and `onValueChange` as bare `string`. Consumers build their
option lists from shared Zod schema unions (`magicItemCategorySchema.options`,
`spellSchoolSchema.options`, `SPELL_CLASS_IDS`), so the component *receives*
precise literal unions and hands back plain `string` — and each consumer then
pays to recover the type it already had: two casts with
`type-assertion-boundary` markers in one file, six hand-written narrowing
helpers across the other three, including two near-duplicate
`toSpellSchoolFilter` copies. The "all selected" state is likewise smuggled
through `string` in two divergent conventions (the component's `allOption`
prop vs hand-prepended `"all"` rows). Every new call site of a common control
must either justify a cast against the repo's no-type-assertions standard or
write yet another guard — the shared abstraction taxes exactly the code path
it exists to cheapen.

The three rendered `SpellFilterBar` selects also lack caller-boundary
characterization. Their colocated suite stops at pure conversion helpers, while
the panel composition suite drives only text search. Regressions in Level,
School, or Status option population, selected-value projection, labels, or
filter-patch wiring can therefore make a control ineffective or update the
wrong field without failing the current tests. Those interactions need to be
the safety spine for migrating this caller onto the generic contract.

## Evidence

- `packages/client/src/components/common/filter-select.tsx:18-25` —
  `FilterSelectProps` types `value: string` (`:21`),
  `onValueChange: (value: string) => void` (`:22`), and
  `options: readonly FilterOption[]` (`:23`) with
  `FilterOption.value: string` (`:8-11`). The file has no type parameter;
  `wc -l packages/client/src/components/common/filter-select.tsx` returns 68.
- `packages/client/src/components/compendium/magic-item-list.tsx:23-31` — both
  option lists map schema unions, so the literal types survive to the component
  boundary; `:65-66` and `:76-77` are the two
  `type-assertion-boundary: interop` markers plus casts
  (`(v || "") as MagicItemCategory | ""`, same for rarity) that exist only to
  undo the widening.
- `packages/client/src/components/campaign/npcs/monster-tab.tsx:89-95`,
  `packages/client/src/components/sheet/spell-filter-bar.tsx:47-59`, and
  `packages/client/src/components/sheet/add-spell-dialog.tsx:61-68` — the
  other three consumers recover narrowed values through
  `toCreatureTypeFilter`, `toMonsterSizeFilter`, `toSpellSchoolFilter`,
  `toPreparedFilter`, another `toSpellSchoolFilter`, and
  `toSpellClassFilter`; the school copies use different all-sentinel results
  (`null` versus `"all"`).
- Measurement with
  `rg -n 'allOption=|type-assertion-boundary: interop|function (toCreatureTypeFilter|toMonsterSizeFilter|toSpellSchoolFilter|toPreparedFilter|toSpellClassFilter)' packages/client/src/components/{campaign/npcs/monster-tab.tsx,compendium/magic-item-list.tsx,sheet/add-spell-dialog.tsx,sheet/spell-filter-bar.tsx}`
  returns exactly the two marker lines, six helper definitions, and six
  `allOption` call sites described above and below.
- Measurement with
  `rg -n '<FilterSelect' packages/client/src/components/{campaign/npcs/monster-tab.tsx,compendium/magic-item-list.tsx,sheet/add-spell-dialog.tsx,sheet/spell-filter-bar.tsx}`
  returns 12 production call sites across four files:
  `monster-tab.tsx:110,120,130,140`, `magic-item-list.tsx:58,69`,
  `add-spell-dialog.tsx:191,198,207`, and
  `spell-filter-bar.tsx:85,94,103`.
- `packages/client/src/components/common/filter-select.tsx:6,27-33` — the
  component maps `""` to a private `"__all__"` for its six `allOption` call
  sites, while `packages/client/src/components/sheet/spell-filter-bar.tsx:10,26-28`
  and `packages/client/src/components/sheet/add-spell-dialog.tsx:22-24`
  prepend their own `"all"` rows.
- `packages/client/src/components/common/filter-select.test.tsx:7-18` — the
  focused suite pins the `""` ↔ internal-sentinel round trip, providing the TDD
  anchor for a signature change.
- `packages/client/src/components/sheet/spell-filter-bar.tsx:74-112` —
  `SpellFilterBar` renders Level, School, and Status selects with separate
  current-value conversions and complete-filter patch callbacks.
- `packages/client/src/components/sheet/spell-filter-bar.test.ts:1-45` — the
  colocated suite imports only `isPreparedFilter`, `toPreparedFilter`, and
  `toSpellSchoolFilter`; it never imports or renders `SpellFilterBar`.
- `packages/client/src/components/sheet/spells-panel.test.tsx:190-218` — the
  composition suite checks whether the filter bar is present and exercises
  text search, but does not interact with any of the three selects.

## Proposed direction

Make the three rendered `SpellFilterBar` interactions the pre-refactor
characterization spine. Before changing `FilterSelect`, extend the colocated
suite—renaming it to `spell-filter-bar.test.tsx` when JSX is introduced—to
render controlled filters and exercise Level, School, and Status individually.

For each control, assert its visible label and representative option labels,
select a non-default option, and assert the complete `onFilterChange` payload,
including every unchanged filter field. Cover the existing conversions
explicitly: a numeric level string becomes its numeric level and "All Levels"
becomes `null`; a representative school becomes its schema literal and "All
Schools" becomes `null`; Prepared/Unprepared map to their domain literals and
the all option remains `"all"`. Retain these rendered tests unchanged in intent
through the generic migration.

Then make `FilterSelect` generic over its option-value string-literal union —
`options`, `value`, and `onValueChange` all typed to the union, with the
all-selection sentinel modeled explicitly rather than smuggled through
`string` — and update the 12 call sites across the four consumer files to drop
their recovery casts and `type-assertion-boundary` markers.

Mechanically, parameterize `FilterSelectProps<V extends string>` with
`options: readonly { value: V; label: string }[]`, and let the `allOption`
branch surface as a typed member (for example, `value: V | ""` and
`onValueChange: (value: V | "") => void`) while the internal `"__all__"`
round trip (`filter-select.tsx:27-33`) stays an implementation detail that
`filter-select.test.tsx` continues to pin. With inference from the option
array, `magic-item-list.tsx` drops both casts and markers outright; the other
files' helpers disappear or shrink to genuine domain mapping (see caveats).
One production commit can carry the 68-line component and 12 call sites, but
the rendered characterization must exist before that refactor begins.

## Scope / caveats

- **Not the refused form sweep.** The prior pack's
  [code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md](../code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md)
  (CQ25-187, leaf 08 steps 6-7, dropped permanently in "Leaf disposition")
  ruled out the roughly 49-site `Label`/`Input` sweep. This leaf fixes one
  component's typed API and touches only its 12 call sites.
- The spell **level** filters store stringified numbers (`String(i)`, parsed
  back with `parseInt`); their union is the stringified levels. Do not push
  `number` typing into the select, and preserve both numeric conversion and
  the all-to-`null` mapping in the rendered characterization.
- Some guards do work a generic cannot replace:
  `spell-filter-bar.tsx` maps the sentinel to domain state
  (`school: null`, `prepared: "all"`), and
  `add-spell-dialog.tsx:132-135` derives a default class filter. Keep the
  domain mapping; delete only the string-to-union recovery.
- The added tests are caller-boundary characterization for
  `SpellFilterBar`, not an invitation to refactor unrelated sheet filtering or
  move all filter behavior into `spells-panel.test.tsx`.
- Migrating the hand-prepended `"all"` rows onto `allOption` is in scope only
  where the generic typing forces a decision; a broader sheet-filter refactor
  is not.
- Read `packages/client/src/components/sheet/MODULE.md` before editing the two
  sheet consumers, and `docs/guides/local-eslint-rules.md` when removing the
  two `interop` markers so none is left orphaned.
- A soft cross-leaf file overlap exists with
  [048-monsteradddata-erases-mutually-exclusive.md](./048-monsteradddata-erases-mutually-exclusive.md):
  it also edits `monster-tab.tsx`, although its source-carrier work and this
  leaf's filter-control work are disjoint. Coordinate the shared file; either
  leaf may otherwise land first. Within this leaf, the rendered Level, School,
  and Status characterization lands before the generic contract changes and
  remains afterward.
