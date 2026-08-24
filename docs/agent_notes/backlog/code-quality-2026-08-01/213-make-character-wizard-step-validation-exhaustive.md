# 213. Make character-wizard step validation exhaustive over its closed registry

Status: Not started
Theme: Keep character-wizard step keys closed through validation · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The character wizard defines every step in one closed const registry, but its
applicability and validation boundaries immediately widen those keys back to
`string`. The validator table therefore does not have to remain exhaustive when
a step is added.

An omitted validator compiles, is discovered only when navigation reaches the
new step, and makes `computeCanAdvance` return false indefinitely. The same
widening also forces an empty-string sentinel into applicability code even
though the registry entry has already established a valid step key.

## Evidence

- `packages/client/src/components/character-create/wizard-state.ts:104-114` —
  `WIZARD_STEPS` is a closed `as const` tuple containing all nine labelled step
  keys, so its key union is available directly to the type system. Reproduce
  the count with
  `git show ebf096580b31f604861fadb3d4cbd4079da4f017:packages/client/src/components/character-create/wizard-state.ts | sed -n '104,114p' | rg -c '^  \{ label:'`,
  which prints `9`.
- `packages/client/src/components/character-create/wizard-state.ts:129-140` —
  `isStepApplicable` accepts any string, and `visibleStepIndices` substitutes
  `""` when indexing the closed tuple.
- `packages/client/src/components/character-create/wizard-validation.ts:54-68`
  — `STEP_VALIDATORS` is declared as
  `Record<string, (state: WizardState) => boolean>`, so the compiler does not
  require one entry per wizard key.
- `packages/client/src/components/character-create/wizard-validation.ts:70-74`
  — a missing table entry reaches the optional-validator fallback and returns
  false, blocking advancement at runtime.

## Proposed direction

Derive and export
`WizardStepKey = (typeof WIZARD_STEPS)[number]["key"]` immediately beside the
registry. Use that type for `isStepApplicable` and every other boundary that
accepts a registry key.

Give the validation callback a named type and declare `STEP_VALIDATORS` with
`Record<WizardStepKey, StepValidator>` or an equivalent exhaustive `satisfies`
constraint. Once the current step has been bounds-checked, index the table
directly and invoke the validator; retain the existing false result for an
out-of-range `currentStep`, but remove the fallback for a missing registered
validator.

Rewrite `visibleStepIndices` to iterate each concrete step together with its
index and pass `step.key` directly to `isStepApplicable`, eliminating the
empty-string sentinel. Preserve the current order and the conditional spell
step.

Extend the focused wizard-state coverage with a table over `WIZARD_STEPS` so
every registered key exercises applicability and validation. The exhaustive
record remains the compile-time regression guard: adding a registry member
without a validator must fail typechecking rather than create a runtime
navigation block.

## Scope / caveats

- Coordinate with
  [042-flat-character-creation-contract-forces.md](./042-flat-character-creation-contract-forces.md),
  which restructures `wizard-state.ts` and `wizard-validation.ts`. Apply this
  closed-key contract after that state shape is settled, or carry it through
  the restructure without weakening the exhaustive record.
- Do not fold this production contract into
  [056-wizard-contexttesttsx-stale-duplicate-wizard.md](./056-wizard-contexttesttsx-stale-duplicate-wizard.md).
  That leaf removes or replaces a stale test-only suite and explicitly leaves
  production wizard state and validation out of scope.
- Preserve the nine current step keys, their order, applicability behavior,
  validator logic, and out-of-range navigation guard. This leaf closes the
  type boundary; it does not redesign validation or wizard navigation.
