# 199. Magic-item seed validation should reuse the shared category and rarity schemas

Status: Not started
Theme: seed contract reuse · Area: cross-cutting · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The magic-item seed declares private category and rarity schemas that duplicate
the exported shared schemas exactly. There is no import or type relationship
between the copies, so changing a category or rarity requires synchronized
edits in two packages.

Drift would make checked-in seed data and API-facing validation disagree about
which values are legal. Enum changes are infrequent and the duplication is
local, but removing it is a small import-only cleanup with an established
neighboring precedent.

## Evidence

- `packages/shared/src/schemas/magic-item.ts:7-29` — shared exports the
  nine-value `magicItemCategorySchema` and seven-value
  `magicItemRaritySchema`.
- `packages/server/src/seed/seed-srd-magic-items.ts:12-32` — the seed module
  privately repeats the same nine category literals and seven rarity literals
  under the same schema names.
- `packages/server/src/seed/seed-srd-magic-items.ts:34-53` — those private
  validators are embedded in a seed-specific outer object schema.
- `packages/shared/src/schemas/magic-item.test.ts:21-68` — focused shared tests
  already pin every accepted category and rarity and representative rejected
  values.
- `packages/server/src/seed/seed-srd-spells.ts:4-5` — the neighboring spell seed
  already imports shared schema contracts through an
  `@musi/shared/schemas/*.js` subpath.

## Proposed direction

In `packages/server/src/seed/seed-srd-magic-items.ts`, delete the private
`magicItemCategorySchema` and `magicItemRaritySchema` copies and import the
shared schemas from
`@musi/shared/schemas/magic-item.js`, as `seed-srd-spells.ts` does for spells.
Keep the seed-specific outer object shape unchanged.

Retain the local `zod` import because the seed still owns
`magicItemJsonRecordSchema`, `magicItemSeedSchema`, the array wrapper, and the
inferred seed type. Reuse the imported schemas under their existing names so
the `category` and `rarity` fields need no other rewrite.

## Scope / caveats

- Do not replace `magicItemSeedSchema` with the full shared
  `magicItemSchema`. The seed deliberately has its own persistence-input shape,
  including loose JSON records for `charges` and `variants` and no generated
  entity timestamps.
- Do not copy the enum options into a new seed test. Their vocabulary is already
  pinned by `packages/shared/src/schemas/magic-item.test.ts`; the value import is
  the compiler-enforced connection this leaf is adding.
- No data migration, seed-data rewrite, Prisma change, or runtime behavior
  change is intended.
- No 2026-07-25 leaf covers these magic-item seed copies. The live prior-pack
  [CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md) still applies:
  before calling this single-sourcing cleanup complete, sweep the whole tree by
  identifier and literal/semantic role and record that no additional runtime
  schema copies remain.
