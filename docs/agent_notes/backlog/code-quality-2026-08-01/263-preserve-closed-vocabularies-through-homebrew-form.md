# 263. Preserve closed vocabularies through homebrew form state

Status: Not started
Theme: Preserve shared literal vocabularies in homebrew select form state · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The magic-item and spell editors render several selects from closed shared
schemas, but widen their selected values to `string` in form state. That severs
the compiler-visible connection between schema options, persisted-value
parsing, Radix callbacks, defaults, and the payload builders.

Unknown persisted strings can consequently enter form state and pass unchanged
into a builder. A future vocabulary change can also update the shared schema
without producing type errors at a stale parser, callback, or default. The
forms recover validity only when a later runtime boundary rejects the completed
payload.

## Evidence

- `packages/client/src/components/homebrew/magic-item/magic-item-form-data.ts:1-28`
  — category and rarity options derive from the shared schemas, while
  `MagicItemFormData` types category, top-level rarity, and variant rarity as
  unrestricted strings.
- `packages/client/src/components/homebrew/magic-item/magic-item-form-data.ts:71-90`
  — persisted category, rarity, and variant-rarity values pass through the
  generic `str` helper; only missing values receive closed-vocabulary
  defaults.
- `packages/client/src/components/homebrew/magic-item/magic-item-form-data.ts:113-131`
  — the builder returns the widened category, rarity, and variant values
  unchanged.
- `packages/shared/src/schemas/magic-item.ts:7-31` — shared already exports the
  closed `MagicItemCategory` and `MagicItemRarity` schemas and inferred types.
- `packages/client/src/components/homebrew/magic-item/magic-item-form-fields.tsx:83-119`
  and `:200-237` — three direct Radix callbacks write their string parameter
  into variant rarity, category, or rarity state even though every displayed
  option comes from a schema-derived list.
- `packages/client/src/components/homebrew/spell/spell-form-data.ts:11-45` —
  spell school, attack type, and saving throw are all declared as `string`;
  the school inventory is additionally maintained as a private literal list.
- `packages/client/src/components/homebrew/spell/spell-form-data.ts:116-140`
  and `:149-173` — persisted attack and saving-throw strings enter form state
  without parsing and are later emitted as-is or converted only to `null`.
- `packages/shared/src/schemas/spell.ts:22-37` and `:208-213` — shared defines
  closed spell-school and attack-type unions and applies those contracts,
  together with the shared ability abbreviation schema, to stored spell
  fields.
- `packages/shared/src/schemas/srd.ts:26-28` — the saving-throw vocabulary has
  an existing six-value schema and inferred `AbilityAbbreviation` type.
- `packages/client/src/components/homebrew/spell/spell-combat-fields.tsx:28-65`
  — Radix string values flow directly into attack-type and saving-throw state,
  with `"_none"` translated only to the empty-string sentinel.

## Proposed direction

After the spell-school consolidation in
[189-downstream-packages-keep-semantic-copies.md](./189-downstream-packages-keep-semantic-copies.md)
lands, carry its schema-derived school type through `SpellFormData`. Type attack
type as `SpellAttackType | ""` and saving throw as
`AbilityAbbreviation | ""`, preserving the existing empty sentinel and payload
`null` mapping.

Import `MagicItemCategory` and `MagicItemRarity` into the magic-item form model.
Use them for category, top-level rarity, and each variant's rarity. Parse
persisted values with their shared schemas at `getDefaultMagicItemData` and
`getDefaultSpellData`: preserve valid literals, use the existing defaults for
invalid required values, and map invalid optional combat values to `""`.
Builders should then consume the narrowed form fields without recreating a
string-to-union cast.

Keep Radix's string boundary local to each direct select callback. Parse the
callback value with the relevant shared schema before updating form state,
handling `"_none"` explicitly for optional spell combat fields. Do not widen
the form model merely to match Radix's callback signature.

Extend the existing magic-item and spell form-data tests to cover every valid
schema option, invalid persisted values, variant rarity, the empty combat
sentinel, and valid build/parse round trips. Add rendered select coverage
for representative category, rarity, attack-type, and saving-throw changes so
the checked callback boundary remains exercised.

## Scope / caveats

- Exclude open text such as damage type, stringified numeric fields such as
  spell level and charge counts, and every field without a closed shared
  vocabulary. This is not generic form infrastructure.
- Land or account for
  [189-downstream-packages-keep-semantic-copies.md](./189-downstream-packages-keep-semantic-copies.md)
  first. Extend its schema-derived spell-school parser and label authority;
  do not recreate `VALID_SCHOOLS` or another private school inventory.
- [053-filterselect-erases-schema-derived-option.md](./053-filterselect-erases-schema-derived-option.md)
  owns the generic `FilterSelect` contract. This leaf covers direct Radix
  forms and must not broaden into that component's caller sweep.
- Keep the runtime submission validation proposed by
  [195-validate-concrete-homebrew-entry-data-before.md](./195-validate-concrete-homebrew-entry-data-before.md)
  as defense in depth. Narrow form state does not replace parsing at a trust
  boundary.
- Preserve the current shared vocabularies, defaults, display labels, sentinel
  behavior, and wire payload shapes. No server, database, or generic homebrew
  registry change is required.
- No 2026-07-25 record covers this form-state typing gap.
