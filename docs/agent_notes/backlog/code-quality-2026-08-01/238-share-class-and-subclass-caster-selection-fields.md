# 238. Share class and subclass caster-selection fields

Status: Not started
Theme: Share class and subclass caster-selection fields · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Class and subclass authoring independently render the same caster-type and
spellcasting-ability controls. Each copy owns the labels, option iteration,
ID convention, and conversion between an empty stored ability and the
`"_none"` UI sentinel.

The underlying option and parsing helpers are already shared, so the remaining
duplication is presentation and change normalization. Any adjustment to the
selector contract must currently be made twice, and the two forms can drift
while still consuming the same data helpers.

## Evidence

- `packages/client/src/components/homebrew/class/class-form-fields.tsx:24-29,121-172`
  — the class form defines caster labels locally and renders both selectors,
  including `parseCasterType` and the `"_none"`-to-empty-string conversion.
- `packages/client/src/components/homebrew/subclass/subclass-form-fields.tsx:26-85`
  — the subclass form repeats the same label map, selector markup, option
  iteration, parsing, and sentinel conversion under different control IDs.
- `packages/client/src/components/homebrew/shared/caster-form-utils.ts:4-17`
  — caster options, spellcasting-ability options, and both normalization
  helpers already live in the shared homebrew module.
- `packages/client/src/components/homebrew/shared/MODULE.md:25-28` — the shared
  module admits presentation primitives used by two or more entity form
  bodies, which is exactly the class/subclass consumer boundary.

## Proposed direction

Add a focused caster-selection presentation component under
`components/homebrew/shared/`. Give it explicit `casterType` and
`spellcastingAbility` values, explicit change callbacks for those two values,
and a required ID prefix so each form retains unique label/control
associations.

Move the shared caster labels, the two select bodies, option iteration, and
normalization into that component. Preserve the existing behavior exactly:
caster values continue through `parseCasterType`, an empty spellcasting
ability displays as `"_none"`, and selecting `"_none"` reports an empty string
to the parent. Class and subclass retain their local `update` functions and
adapt the two callbacks into their own form patches.

Replace both local `CasterFields` implementations with the shared component.
Keep Ritual Adept immediately in the class form rather than adding a
class-only switch to the shared component, and document the new presentation
primitive in `homebrew/shared/MODULE.md`.

Add focused shared-component tests for both selectors, ID-prefix isolation,
saved values, and both directions of the none-sentinel conversion. Retain
parent-form assertions that class and subclass receive the expected patches,
plus the class-only Ritual Adept coverage.

## Scope / caveats

- Keep class and subclass form-data, mutation, and whole-form update ownership
  in their existing entity modules. This extraction owns only the duplicated
  selector presentation and normalization.
- Do not generalize the component into a homebrew select framework or add
  options for unrelated entity fields.
- Preserve `"_none"` as the UI sentinel and `""` as the stored no-ability
  value. This leaf is not an opportunity to change either form-data contract.
- Keep Ritual Adept and any future class-only caster behavior outside the
  shared component.
- [025-spellcastingts-contains-five-independently.md](./025-spellcastingts-contains-five-independently.md)
  reorganizes shared rules modules and does not own these client form fields.
  No ordering is required, but the two scopes should remain separate.
