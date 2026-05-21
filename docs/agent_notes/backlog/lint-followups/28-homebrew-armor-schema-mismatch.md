# Leaf 28: Homebrew Armor vs ItemProperties Schema Mismatch

Status: Implemented and merged into `feature/lint-hardening-review-followup`
(option 3, commits `2a56f0bc` and `565f9080`)
Discovered: 2026-05-19 during Leaf 07 drain (feature/lint-hardening-review-followup)
Sources:

- `packages/client/src/components/sheet/homebrew-item-tab.tsx` `buildArmorProperties`
- `packages/shared/src/schemas/homebrew.ts` `homebrewArmorDisplaySchema`
- `packages/shared/src/schemas/inventory.ts` `armorPropertiesSchema`

## Problem

`buildArmorProperties` converts a `HomebrewArmorDisplay` into an
`ItemProperties` union member (typically `ArmorProperties`). The shapes
have a required-field mismatch:

- `homebrewArmorDisplaySchema.base` is `z.number().int().positive().optional()`.
- `armorPropertiesSchema.base` is `z.number().int()` (required).

The current code only sets `result.base` when `a.base !== undefined`
and then casts the partially populated `Record<string, unknown>` to
`ItemProperties`:

```ts
const result: Record<string, unknown> = {};
if (a.base !== undefined) result.base = a.base;
// ... other optional fields
return result as ItemProperties;
```

When a homebrew author omits `base`, the returned object isn't a valid
`ArmorProperties` (missing required `base`). It also isn't the empty
member of `ItemProperties` (which is `Record<string, never>`), because
other optional armor fields may be present. The cast hides this, and
downstream code that reads `properties.base` on an armor item will get
`undefined` instead of the integer it's typed for.

## Considered fixes

1. **Tighten the homebrew schema**: make
   `homebrewArmorDisplaySchema.base` required. Forces homebrew authors
   to provide a base AC, which matches the inventory shape.
   Likely best, but it's a breaking change for any homebrew payloads
   already in the wild — needs a migration plan.

2. **Default base in the builder**: pick a fallback (e.g. `10`,
   `a.base ?? 10`) when constructing. Removes the cast, but silently
   invents AC for the author. Probably wrong product behavior.

3. **Refuse to build**: change the signature to
   `(a: HomebrewArmorDisplay): ItemProperties | null` and return
   `null` when `base` is missing. Caller already handles `null` from
   `parseItemData`; threading another null is cheap.

4. **Status quo + boundary label**: keep the cast and label it
   `interop`. This is what this drain landed; the bug is unchanged but
   at least the cast is justified and discoverable.

## Prior decision

Landed option 4 (label only) during the Leaf 07 drain because the
batch's theme was boundary annotation, not schema repair. The latent
bug is preserved with a `type-assertion-boundary: interop` comment
that points back at this note.

## Resolution

Implemented option 3 in
`2a56f0bc38846d5ca486f7cd31ff1709d774c46b`: `buildArmorProperties`
returns `null` when `base` is missing, and `homebrewItemToInventoryInput`
threads that rejection through. Armor rows that fail to build are now
filtered out of the homebrew picker instead of rendering malformed inventory
properties.

## Remaining follow-up

When inventory/homebrew author UX work happens next, consider option 1:

- Option 1: tighten `homebrewArmorDisplaySchema.base` and add a guard
  in the homebrew editor that surfaces the missing-base error to the
  author.

The builder-side boundary cast is gone; a schema tightening still needs a
migration/authoring UX plan.
