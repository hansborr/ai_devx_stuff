# 237. Associate homebrew validation errors with their controls

Status: Not started
Theme: Associate homebrew validation errors with their controls · Area: client · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Many homebrew forms render validation messages as visually adjacent
destructive text without marking the corresponding control invalid or
associating it with that message. An assistive-technology user may hear
neither the new error nor its relationship to the field, and returning to the
control provides no durable indication of which message describes it.

The client already has a complete contract for standard text inputs and
textareas. The gap is the bounded set of error-bearing homebrew controls that
bypass those primitives or use control shapes—selects, checkbox groups, and
list rows—that need equivalent shape-specific semantics.

## Evidence

- `packages/client/src/components/homebrew/shared/homebrew-textarea-field.tsx:28-47`
  — the established textarea primitive gives the error a stable ID, marks the
  control invalid, points `aria-describedby` to the message, and renders that
  message through the alert-bearing `FormFieldError`.
- `packages/client/src/components/homebrew/species/species-form-fields.tsx:58-68`
  — the species name input renders `fieldErrors.name` in a visually adjacent
  paragraph without `role="alert"`, `aria-invalid`, an error ID, or
  `aria-describedby`.
- Measurement from the repository root:
  `rg -l 'fieldErrors' packages/client/src/components/homebrew --glob '*.tsx' | xargs rg -l '<p[^>]*className="text-sm text-destructive"' | wc -l`
  returns 11 error-bearing homebrew field components, showing that this bypass
  is distributed rather than confined to the species form.

## Proposed direction

Audit only the rendered validation errors in those eleven measured components.
For each standard labeled text input that fits the existing contract, replace
the local label/input/error triple with `FormField`; for a fitting textarea,
reuse `HomebrewTextareaField`.

Where the control is a select, checkbox group, or repeated list-row field,
retain its current component and interaction model. Give the rendered error a
stable ID and alert role, then apply `aria-invalid` and
`aria-describedby` to the interactive control or semantic group that the
message actually describes. Repeated rows need IDs scoped to their row/error
key so multiple visible errors cannot collide.

Add focused component coverage for the affected shapes. With an error present,
assert that the message is an alert with an ID and that its control is invalid
and references that ID; without an error, assert that the control does not
retain a stale description. Include representative input, select, group, and
list-row cases rather than treating the input primitive as proof for every
shape.

## Scope / caveats

- Change only controls that currently render validation errors. Do not turn
  this into normalization of every homebrew label, input, or field layout.
- Do not hoist `FormFieldError`, make `FormField` polymorphic, or introduce a
  general homebrew control framework. Preserve the dependency and primitive
  boundaries already established in `homebrew/shared/`.
- Preserve select, checkbox-group, and list-row keyboard and interaction
  semantics. Accessibility association must adapt to each shape rather than
  forcing each shape through an `Input` abstraction.
- Coordinate overlapping form edits with
  [195-validate-concrete-homebrew-entry-data-before.md](./195-validate-concrete-homebrew-entry-data-before.md).
  That proposal owns producing pre-submit `fieldErrors`; this one owns how
  already-rendered errors are associated with their controls.
- The prior-pack residual is `CQ25-187` in
  [code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md](../code-quality-2026-07-25/CLIENT-CLUSTER-PLAN.md):
  line 234 permanently dropped the broad roughly 49-site form sweep, and lines
  263-264 and 489-497 preserved the primitive boundary while landing its
  initial accessibility work. This leaf reopens only the eleven measured
  error-bearing components, not that refused sweep.
