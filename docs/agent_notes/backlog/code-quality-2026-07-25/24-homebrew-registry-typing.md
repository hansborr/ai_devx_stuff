# 24. `HOMEBREW_DATA_SCHEMAS`'s explicit `Record<..., z.ZodType>` annotation erases nine schema types and forces a cast

Status: Done — landed 2026-07-26 (`c36c9a17`); see [`00-index.md`](./00-index.md#landed)
Theme: Type-level hygiene · Area: shared · Severity: low · Size: XS

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The homebrew entry-type registry is declared with an explicit type annotation rather
than an assignability check:

```ts
export const HOMEBREW_DATA_SCHEMAS: Record<HomebrewEntryType, z.ZodType> = { ... }
```

The annotation widens each of the nine values to bare `z.ZodType`, whose default output
type is `unknown`. Nothing is gained — the object literal already has exactly the right
keys — and one thing is lost: `safeParse` now returns `unknown`, so
`validateHomebrewData` cannot satisfy its own documented `Record<string, unknown>`
return contract without a type assertion. The assertion's marker comment says so in as
many words, naming the annotation as the cause. This is a self-inflicted cast: swapping
the annotation for `satisfies` very likely retires it.

The marker documents a constraint the file imposes on itself rather than a genuine
framework limitation, which is the only reason it is worth retiring.

## Evidence

- `packages/shared/src/schemas/homebrew.ts:224-235` — doc comment "Maps entry type to
  its data validation schema." followed by
  `export const HOMEBREW_DATA_SCHEMAS: Record<HomebrewEntryType, z.ZodType> = {` and
  nine members (`species`, `class`, `subclass`, `background`, `feat`, `spell`, `item`,
  `monster`, `magicItem`). Eight are `ZodObject`s; `class` maps to `classDataSchema`
  (`homebrew.ts:115-123`), which is a `z.preprocess(normalizeLegacyClassData, ...)`
  pipe wrapping a `ZodObject`.
- `packages/shared/src/schemas/homebrew.ts:254-255` — the marker and the cast it
  justifies: `// type-assertion-boundary: framework - HOMEBREW_DATA_SCHEMAS is typed
  Record<HomebrewEntryType, z.ZodType>, whose default output is unknown; ...` then
  `return { success: true, data: result.data as Record<string, unknown> };`.
- `packages/shared/src/schemas/homebrew.ts:241-246` — the `validateHomebrewData` doc
  block, including the security note that callers must persist `result.data` rather
  than the raw input.
- `packages/shared/src/schemas/homebrew.ts:78` — a section header comment that
  contradicts that note: "Zod strips unknown keys by default; the original (unstripped)
  input is stored." No production path stores the unstripped input; every write persists
  the parsed value.
- `packages/shared/src/schemas/homebrew-inputs.ts:69-74` — documents the opaque wire
  payload as deliberate: "Kept opaque on the wire because a discriminated union here
  would have to mirror every entry-type schema."
- `packages/shared/src/schemas/homebrew.ts:291-296` — the same decision restated on the
  entity schema: "the wire shape stays opaque so a stub or partial entry doesn't reject
  the whole row."
- `packages/server/src/routers/homebrew.ts:102`, `:232` (result funnelled into
  `toJson(validation.data)` at `:245`), and `:316` (funnelled into a
  `Record<string, unknown> | undefined` local at `:323`) — all three production callers
  pass a runtime-variable `type` and immediately push the result into a Prisma JSON
  column.
- Three client tests index the registry by literal key and feed the result into
  `expectParseResultSuccess<T>` (`packages/shared/src/test/parse-helpers.ts:12`):
  `packages/client/src/components/homebrew/subclass/subclass-form-data.test.ts:8`,
  `packages/client/src/components/homebrew/monster/monster-form-data.test.ts:332`,
  `packages/client/src/components/homebrew/magic-item/magic-item-form-data.test.ts:11`.
  Under `satisfies` their `T` goes from `unknown` to the concrete member output type,
  so this is where a new type error would surface if one appears.

## Proposed direction

One commit.

1. Change `packages/shared/src/schemas/homebrew.ts:225` from
   `: Record<HomebrewEntryType, z.ZodType> =` to a bare `=`, and close the literal at
   `:235` with `} satisfies Record<HomebrewEntryType, z.ZodType>;`. This keeps the
   exhaustiveness check over `HomebrewEntryType` while preserving each member's
   concrete inferred type.
2. Delete the cast and its marker at `homebrew.ts:254-255`, returning
   `{ success: true, data: result.data }`. If typecheck still complains, the members are
   not uniformly assignable to `z.ZodType<Record<string, unknown>>` — see caveats — and
   the correct response is to tighten the `satisfies` constraint, not to reinstate the
   cast.
3. Correct the stale half of the section header at `homebrew.ts:78`. "the original
   (unstripped) input is stored" describes the opposite of what the code does; the
   validated-and-stripped value is what gets persisted, per `homebrew.ts:243-245` and
   `routers/homebrew.ts:245`/`:328`.
4. Verify: `bun run test -- packages/shared/src/schemas/homebrew.test.ts`, the server
   router coverage `bun run test -- packages/server/src/routers/homebrew-entry.test.ts
   packages/server/src/routers/homebrew-import.test.ts`, and the root `bun run typecheck`
   (`scripts/typecheck.sh`, which covers shared, server, and client — the client
   form-data tests above pick up the newly concrete member types). No ratchet or
   suppression-ledger bookkeeping is involved: `type-assertion-boundary` is not one of
   the tracked suppression kinds (`scripts/suppression-ledger-identity.ts:28-34` lists
   `eslint-disable`, `ts-expect-error`, `ts-ignore`, `ts-nocheck`, `stryker-disable`),
   and `ratchet/local-type-assertion-boundary` carries no baselined items
   (`lint-ratchet.baseline.json:413-437`, `"items": {}`) because a validly marked cast
   emits no lint message — deleting it leaves the count at zero.

## Scope / caveats

- **Scope the work to the `satisfies` change only.** Do not also try to expose typed
  `{type, data}` variants for homebrew entries: the opaque wire payload is a deliberate
  decision recorded twice (`homebrew-inputs.ts:69-74`, `homebrew.ts:291-296`), and all
  three production callers (`packages/server/src/routers/homebrew.ts:102`, `:232`,
  `:316`) pass a runtime-variable `type` and immediately funnel the result into a Prisma
  JSON column or a `Record<string, unknown>` local. Typed variants buy nothing
  downstream and fight the stated reason the shape is opaque — that a stub or partial
  entry must not reject the whole row.
- **Do not touch the doc block at `homebrew.ts:241-246`.** It is a load-bearing security
  note ("callers should persist `result.data` rather than the raw input so hostile extra
  fields can't ride along into storage"), not an artifact of the widened registry type.
  It stays verbatim regardless of what happens to the annotation.
- **Verify assignability, do not assume it.** Each of the nine members must actually
  satisfy `z.ZodType<Record<string, unknown>>` for step 2 to work. `classDataSchema` is
  the member to check first: it is the one non-`ZodObject` entry, and members wrapped in
  `.default()` or `.optional()` are worth confirming by typecheck rather than on faith.
- **Leave the client form-data tests on `expectParseResultSuccess`.**
  `packages/shared/src/schemas/MODULE.md:121-124` assigns that helper to
  `unknown`-taking wrappers and `expectSchemaParseSuccess` to direct schema access. The
  wrapper's public contract (`HomebrewDataValidation`) does not change here, so the
  guidance stands as written; migrating those three tests to the direct-schema helper is
  separate churn and is not part of this leaf.
- No sequencing dependency on other leaves in this pack; this one can land standalone at
  any point.
