# Leaf 21 Pass 2b Fix B

Landed the spell-parser `FIELD_BOUNDARY_LOOKAHEAD` cluster rewrite for Sites
6-9, without enabling the deferred regexp rules.

## Scope

- `packages/server/src/seed/spell-parser/parse-spell-block.ts` now extracts
  Casting Time, Range, Component(s), and Duration with one shared global
  `**Title:**` marker scanner.
- The scanner enumerates generic marker spans on each physical line and slices
  a target value to the next marker start or the line end.
- `Component` and `Components` both remain accepted; plural is attempted first,
  then singular.

## Behavior

- Generic inline boundaries are preserved: any `**Title:**` marker ends the
  previous value, not just known spell fields.
- Same-line appended duration prose remains part of the parsed duration value,
  matching the current SRD corpus behavior for Fly-style lines.
- Forcecage inline fields and Counterspell's long reaction casting time are
  unchanged in generated seed output.

## Tests

- Added 3 parser characterization tests:
  - long field values with many near-markers and no valid inline boundary, one
    assertion each for Casting Time, Range, Components, and Duration;
  - singular and plural component markers sharing a line with an unknown inline
    marker and Duration;
  - same-line Fly-style duration prose preservation.

Red/green notes:

- The new characterization tests passed against the legacy regex parser before
  the implementation rewrite.
- Lint first failed on a numeric test template interpolation and
  `parseSpellBlock` complexity after the first implementation; explicit string
  conversion plus an `extractRawSpellFields` helper resolved both.

## Verification

- `bun run vitest run packages/server/src/seed/spell-parser/parse-spell-block.test.ts`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun packages/server/src/seed/generate-srd-spells.ts`

The generator found 339 spell blocks, wrote 339 spells, emitted no warnings,
and produced no diff in `5e-srd-spells-5.2.json`.

## Followup

Fix Pass C still needs to clean the remaining four deferred regexp sites
(Sites 2, 3, 4, and 11) before promoting
`regexp/no-super-linear-backtracking`,
`regexp/no-misleading-capturing-group`, and
`regexp/no-contradiction-with-assertion`.
