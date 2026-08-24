# 262. Single-source the class and subclass feature codec

Status: Not started
Theme: Single-source the class-feature persistence codec · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Class and subclass authoring share one feature form type and feature-list
editor, but independently translate that form to and from persisted feature
records. Both copies currently agree on the three fields and numeric coercion;
a later field, fallback, or coercion change can nevertheless land for one
entity type and silently drift for the other.

The whole-class and whole-subclass form-data boundaries remain distinct. The
duplication is limited to the nested feature codec inside them, so maintaining
two copies adds no entity-specific policy.

## Evidence

- `packages/client/src/components/homebrew/class/class-form-data.ts:85-94` —
  class parsing filters object records and maps `name`, `description`, and
  `level` into `ClassFeatureFormData`.
- `packages/client/src/components/homebrew/class/class-form-data.ts:126-138` —
  class serialization writes those same three fields, parses submitted levels
  with `parseInt`, and falls back to level one when the parsed value is
  non-finite or below one.
- `packages/client/src/components/homebrew/subclass/subclass-form-data.ts:33-42`
  — subclass parsing duplicates the class feature parser field for field.
- `packages/client/src/components/homebrew/subclass/subclass-form-data.ts:60-71`
  — subclass repeats both the positive-integer coercion and the feature
  serializer.
- `packages/client/src/components/homebrew/subclass/MODULE.md:10-14` — the
  subclass module already identifies the class-owned feature form type and
  editor as shared dependencies.

## Proposed direction

Export focused feature parse and build helpers from the class-owned
`class-form-data.ts` boundary. Keep array validation and record filtering in
the parser, and keep the positive-integer level conversion with fallback one
in the builder.

Have `getDefaultClassData` and `buildClassData` use those helpers locally.
Import the same helpers into `subclass-form-data.ts`, remove its duplicate
parser, integer coercion, and builder, and use the shared codec from
`getDefaultSubclassData` and `buildSubclassData`. Keep the outer class and
subclass builders, defaults, and entity-specific fields separate.

Update the class and subclass module documentation to identify the class-owned
codec as a shared dependency. Consolidate detailed codec cases in
`class-form-data.test.ts`, covering non-array input, invalid records, string
and numeric levels, all three fields, and invalid, zero, or negative level
fallback. Retain subclass integration coverage proving its whole-entity build,
parse, schema validation, and round trip use the shared behavior.

## Scope / caveats

- Preserve the exact persisted `name`, `description`, and `level` fields,
  number-or-string parsing behavior, and positive-level fallback of one.
- Do not move whole-class or whole-subclass form-data ownership, defaults,
  caster fields, class identity, or entity schema validation.
- Keep this work separate from
  [238-share-class-and-subclass-caster-selection-fields.md](./238-share-class-and-subclass-caster-selection-fields.md).
  That proposal shares caster selector presentation and normalization while
  explicitly retaining entity form-data ownership; do not broaden it into the
  feature codec or broaden this codec into its presentation component.
- Do not generalize the extraction into a repository-wide nested-form codec or
  move the class-owned feature list/editor.
