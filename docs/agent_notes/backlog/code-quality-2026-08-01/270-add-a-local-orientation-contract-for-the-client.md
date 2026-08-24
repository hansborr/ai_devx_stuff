# 270. Add a local orientation contract for the client character-creation wizard

Status: Not started
Theme: Give the client character-creation wizard a local orientation contract · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The client character-creation wizard spans state, navigation, validation,
submission projection, nine step components, and their focused tests, but its
directory has no local orientation contract. A contributor entering the feature
must reconstruct ownership and flow by chasing imports across 21 production
files.

The missing map is especially costly because the wizard carries contracts that
are not apparent from filenames. The reducer owns conditional-step navigation
and cross-step resets; validation separately controls advancement; the page
projects completed state into the server mutation input. A change that treats
one step as isolated can therefore retain stale data, expose an invalid
navigation path, or make validation and submission disagree.

## Evidence

- `packages/client/src/components/character-create` — measurement: the exact
  command `find /workspace/packages/client/src/components/character-create -type f ! -name '*.test.ts' ! -name '*.test.tsx' | wc -l`
  returns `21`; the exact command
  `find /workspace/packages/client/src/components/character-create -maxdepth 1 -type f -name 'MODULE.md' -print`
  returns no output.
- `docs/module-docs.md:24-30` — the module-doc charter requires local
  orientation documents for large feature directories and surfaces with
  non-obvious data flow or cross-module contracts.
- `packages/client/src/components/character-create/wizard-context.tsx:46-79` —
  `WizardProvider` owns the reducer, computed advancement state, and navigation
  callbacks exposed through `useWizard`.
- `packages/client/src/components/character-create/wizard-state.ts:189-226` —
  navigation resolves arbitrary, next, and previous movement through the
  currently visible step indices rather than treating the nine steps as an
  unconditional sequence.
- `packages/client/src/components/character-create/wizard-state.ts:229-275` —
  class changes rewind progress and clear spell choices, while background
  changes clear equipment selections and starting gold.
- `packages/client/src/components/character-create/wizard-validation.ts:46-74`
  — advancement is a keyed validation graph, including exact
  class-dependent cantrip and level-1 spell counts.
- `packages/client/src/components/character-create/create-character-input.ts:58-91`
  — a separate projection converts finished wizard state into the shared
  mutation contract and intentionally leaves universal starting proficiencies
  to the server.
- `packages/client/src/pages/character-create-page.tsx:8-32` — the page imports
  and orders the nine step components plus the wizard state, navigation, and
  projection seams.
- `packages/client/src/pages/character-create-page.tsx:34-85` — the page selects
  the active step, projects state on submit, invokes the character mutation,
  handles mutation errors, and mounts the flow under `WizardProvider`.

## Proposed direction

Add
`packages/client/src/components/character-create/MODULE.md` as the local
orientation contract, following the standard sections in
`docs/module-docs.md`. Keep it concise and contract-oriented:

1. **Purpose and ownership:** identify `WizardProvider`/`wizardReducer` as the
   state owner, the page as the composition and mutation boundary, and the step
   components as editors of their respective state slices. State what remains
   owned by shared schemas and server-side character creation.
2. **Data flow and entry points:** map page composition through the ordered step
   registry, context dispatch, keyed validation, navigation, review, and
   `buildCreateInput` projection into the character-create mutation.
3. **Conditional navigation:** explain that visible-step calculation controls
   movement, including the caster-dependent spell step, so callers must use the
   shared navigation seams rather than incrementing indices independently.
4. **State invariants and validation:** record the class-change rewind and spell
   reset, the background-change equipment reset, and the rule that advancement
   validation and submission projection must remain aligned. Point to the code
   owners instead of restating detailed 5E rules.
5. **Test seams and gotchas:** name the focused reducer, context, navigation,
   stepper, validation/projection, and affected step-component tests, and call
   out the cross-step cases that must move with an ownership refactor.

Use a stable, human-readable heading and a short `Concepts:` breadcrumb if it
materially improves discovery. Run `bun run module:index` after adding the
document and include the regenerated `MODULE-INDEX.md`, as required by
`docs/guides/add-module-doc.md:41-45`.

## Scope / caveats

- Prefer landing this document after
  [042-flat-character-creation-contract-forces.md](./042-flat-character-creation-contract-forces.md)
  and
  [045-character-creation-ability-rules-have-four.md](./045-character-creation-ability-rules-have-four.md)
  if they are scheduled, so it describes their settled ownership accurately.
  If the document lands first, describe the audit pin and require those leaves
  to refresh it with their implementation changes.
- Do not mix in the server-side service reorganization from
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md).
  This leaf documents the client wizard and does not reorganize either client
  or server source.
- Do not duplicate detailed validation or 5E rule tables in prose. Name the
  responsible source modules, flow, and invariants so the document remains an
  orientation contract rather than a second implementation.
- Adding the module document and regenerating its index are the complete source
  scope. No wizard behavior, state shape, validation rule, mutation contract,
  or server projection changes belong here.
- No prior-pack record covers this missing client orientation contract.
