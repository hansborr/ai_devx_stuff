# 250. Correct two shared assertion-boundary categories

Status: Not started
Theme: Correct two shared type-assertion boundary categories · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two shared rules modules label local runtime invariants as `framework`
type-assertion boundaries. Neither assertion crosses a library seam:
one recovers known object keys after `Object.entries`, and the other narrows a
number after explicit integer and range checks.

The machine-parseable categories feed assertion inventories and reviews, so the
wrong labels give maintainers the wrong remediation signal. They also leave
production examples contradicting the repository guide contributors use to
classify new assertions.

## Evidence

- `packages/shared/src/rules/multiclass-rules.ts:51-53` —
  `abilityRequirementEntries` asserts the widened `Object.entries` result back
  to tuples keyed by `AbilityAbbreviation`, but its marker says `framework`.
- `packages/shared/src/rules/spellcasting.ts:80-84` —
  `clampSpellSlotTableLevel` verifies that the clamped number is an integer
  within the table's literal-key range, then marks the resulting narrowing
  assertion as `framework`.
- `docs/guides/local-eslint-rules.md:359-375` — the authoritative taxonomy
  reserves `framework` for framework or library seams and assigns
  `Object.entries`/`Object.keys` widening and runtime-predicate narrowing to
  `interop`.

## Proposed direction

Change exactly the category token on the two existing markers from
`framework` to `interop`. Retain each marker's concrete reason and leave both
assertions and all runtime code unchanged:

1. Reclassify the `Object.entries` key-tuple assertion in
   `multiclass-rules.ts`.
2. Reclassify the checked spell-slot table-level narrowing wherever that code
   lives after the spellcasting module split.

Treat the diff shape as the acceptance check: apart from any path movement
owned by the related leaves, it should contain two `framework` → `interop`
marker edits and no type, table, predicate, or runtime-behavior changes. Run
the repository's assertion-boundary lint over the changed shared files and
retain their existing focused rules coverage.

## Scope / caveats

- Land this before or atomically with
  [025-spellcastingts-contains-five-independently.md](./025-spellcastingts-contains-five-independently.md)
  so the corrected spell-slot marker travels into the new module rather than
  being lost or copied with its old category.
- Coordinate the multiclass edit with
  [222-make-multiclass-prerequisite-table-states-exclusive.md](./222-make-multiclass-prerequisite-table-states-exclusive.md).
  That leaf changes the prerequisite table's state model; this leaf must not
  absorb any part of that refactor.
- [038-dice-grammar-semantics-depend-positional.md](./038-dice-grammar-semantics-depend-positional.md)
  corrects the same marker-category defect in the dice parser, but its
  parser-only scope does not cover either rules file here.
- Do not broaden this localized correction into another assertion-marker
  census, remove the assertions, or rewrite their reasons.
- There is no prior-pack residual for these two classifications.
