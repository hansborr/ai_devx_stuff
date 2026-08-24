# 256. Constrain class caster metadata with database enums

Status: Not started
Theme: Class caster metadata bypasses existing database enum boundaries · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Class and subclass caster metadata has a closed rules vocabulary, but all four
database columns remain unconstrained strings. An invalid write can therefore
persist a caster type or spellcasting ability that no shared contract accepts.
Rules-facing reads then either parse the row and fail at runtime or rely on
marked assertions whose safety depends on the seed rather than the database.

The schema already has a database enum for ability abbreviations, so the same
values are maintained through two boundary strategies: enum-constrained
columns elsewhere and comment-constrained text for class casting metadata.
That duplication weakens generated Prisma types and makes malformed rows a
delayed read-path failure instead of a rejected write.

## Evidence

- `packages/server/prisma/schema.prisma:468-499` — `Class` and `Subclass` each
  store `casterType` as `String` and `spellcastingAbility` as `String?`; comments
  list the intended values but the database columns do not enforce them.
- `packages/server/prisma/schema.prisma:244-253` — the existing
  `AbilityAbbreviation` enum defines `STR`, `DEX`, `CON`, `INT`, `WIS`, and
  `CHA`, the vocabulary required by both spellcasting-ability columns.
- `packages/shared/src/schemas/srd.ts:126-165` — shared schemas close
  `casterType` to `full`, `half`, `third`, or `none` and use
  `abilityAbbreviationSchema` for both class and subclass spellcasting ability.
- `packages/server/src/utils/caster-resolver.ts:5-20` — rules-facing reads model
  both Prisma fields as wide strings and parse them at runtime before passing
  them into shared spellcasting rules.
- `packages/server/src/utils/srd-narrowing.ts:28-58` — the SRD mapping boundary
  instead narrows the same class and subclass columns through marked Prisma
  assertions justified by seed guarantees.

## Proposed direction

Add a Prisma `CasterType` enum containing `full`, `half`, `third`, and `none`.
Change both `Class.casterType` and `Subclass.casterType` to that enum with the
existing `none` default, and change both `spellcastingAbility` columns to the
existing nullable `AbilityAbbreviation` enum.

Land the schema edit through the repository's Prisma migration guide. Before
altering any column type, make the migration validate the distinct persisted
values in `classes` and `subclasses` against the two target vocabularies and
fail clearly if an out-of-domain value exists. Then convert the four columns
with explicit casts that are valid for every accepted value, inspect the
generated SQL, regenerate the Prisma client, and run the migration-safety
check. Preserve the existing column names and null/default semantics.

Use the regenerated enum types at trusted Prisma read and write boundaries.
Remove runtime parsing or marked assertions only where the input is now
compiler-tied to one of the migrated columns and cannot originate from a
wider structural, JSON, or transport shape. In particular, audit the
`caster-resolver.ts` callers before removing `parseCasterRow`; if any caller
continues to accept wide structural input, retain validation at that seam.
Update focused caster-resolution, prepared-spell, seed, and database coverage
so valid class/subclass overrides behave unchanged and invalid enum writes are
rejected by the persistence boundary.

## Scope / caveats

- Follow `docs/guides/add-prisma-migration.md`; this is committed schema work,
  not a `db:push` shortcut. Validate existing persisted values before any type
  conversion rather than assuming the current seeds describe every database.
- Honor
  [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md):
  do not restructure `routers/srd.ts` row types or its
  `narrowClassEnumColumns`/`narrowSubclassEnumColumns` helper boundary in this
  leaf. Generated enum types may remove genuinely redundant operations, but
  they do not reopen that mapper design ruling.
- Keep runtime Zod parsing at untrusted JSON and transport boundaries. Database
  enums constrain these four columns; they do not make unrelated external
  input trusted.
- Do not change caster resolution, subclass override precedence, prepared-spell
  calculations, seed values, or the shared SRD vocabularies.
- No prior-pack record covers this database-constraint residual.
