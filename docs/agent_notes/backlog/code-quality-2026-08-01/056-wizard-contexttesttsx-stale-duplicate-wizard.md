# 56. wizard-context.test.tsx never tests the context it is named for — it re-runs stale reducer cases that wizard-state.test.ts already owns

Status: Not started
Theme: stale duplicate test coverage · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The character-creation wizard has two suites describing the same behavior, and
the one named for the context boundary never touches it.
`wizard-context.test.tsx` imports only `wizardReducer`, `computeCanAdvance`,
`INITIAL_WIZARD_STATE`, and `TOTAL_STEPS` — all re-exports that
`wizard-context.tsx` passes through from `wizard-state.ts` and
`wizard-validation.ts` — and never renders `WizardProvider` or calls
`useWizard`. Meanwhile `wizard-state.test.ts` is the newer, larger authority on
exactly those functions: it covers the current nine-step, spell-aware wizard,
down to the same standard-array score vectors and background-boost allocations
the old suite repeats.

The old suite also carries stale step semantics: it labels Personality as step
6, but the Spells step now occupies index 6 and Personality is step 7. A
contributor who opens the context-named file to learn how the wizard gates
steps gets an outdated step map and a false impression that the provider facade
is tested; every reducer change must be reconciled against two overlapping
suites instead of one.

## Evidence

- `packages/client/src/components/character-create/wizard-context.test.tsx:3-9`
  — the suite's only import block: `computeCanAdvance`,
  `INITIAL_WIZARD_STATE`, `TOTAL_STEPS`, `wizardReducer`, `type WizardState`
  from `./wizard-context`. `WizardProvider` and `useWizard` appear nowhere in
  the file's 380 lines; nothing is rendered.
- `packages/client/src/components/character-create/wizard-context.tsx:19-28` —
  those names are pure re-exports from `./wizard-state.js` and
  `./wizard-validation.js`; the file's own substance is `WizardProvider`
  (`:46-72`, deriving `canAdvance` at `:52` and the `goNext`/`goPrev`/`goToStep`
  callbacks at `:54-64`) and `useWizard` with its outside-provider throw
  (`:74-80`). Neither has a dedicated test.
- Measured: `wizard-context.test.tsx` has 27 `it` cases;
  `wizard-state.test.ts` has 69 across 782 lines and imports straight from
  `./wizard-state.js` / `./wizard-validation.js` (`:1-12`).
- `packages/client/src/components/character-create/wizard-context.test.tsx:343`
  — `"step 6: requires non-empty trimmed name"`; but `WIZARD_STEPS`
  (`packages/client/src/components/character-create/wizard-state.ts:104-114`)
  puts Spells at index 6 and Personality at index 7, and the newer suite says so
  (`wizard-state.test.ts:702` "step 6 — spell", `:732` "step 7 — personality").
  The stale case (`:343-362`) also only asserts stored string trim lengths — it
  never calls `computeCanAdvance`, so the gating its name promises is untested
  there anyway.
- Duplication is near-verbatim: the old suite's `computeCanAdvance` cases
  (`wizard-context.test.tsx:265-326`) reuse the exact score vectors and boost
  allocations the authority already pins (`wizard-state.test.ts:559-632`).
- The provider is not entirely dark: step suites render it as scaffolding via
  `renderWizard` (`packages/client/src/test/wizard-test-utils.tsx:41-46`), and
  `wizard-navigation.test.tsx` (14 cases) drives `canAdvance`/`goNext`/`goPrev`
  through the navigation buttons — but no test targets the facade contract
  itself (memoized value, `goToStep` clamping through the provider, the
  `useWizard` outside-provider error).

## Proposed direction

Delete the duplicated reducer/validation cases in `wizard-context.test.tsx` and
either remove the file or replace it with a small render-based
`WizardProvider`/`useWizard` contract test, leaving `wizard-state.test.ts` as
the sole reducer authority.

Mechanics: every one of the 27 cases is reducer/validation behavior, so
"delete the duplicated cases" means the whole current file body. If replacing
rather than removing, the contract test should render `WizardProvider`
(reusing `renderWizard` from `packages/client/src/test/wizard-test-utils.tsx`)
and probe `useWizard` directly: the `canAdvance` derivation at
`wizard-context.tsx:52`, the `goNext`/`goPrev`/`goToStep` dispatch wiring at
`:54-64`, and the outside-provider throw at `:76-78` — the pieces no existing
suite targets. Verify with
`bun run test -- packages/client/src/components/character-create/wizard-state.test.ts`
(plus the replacement file, if written) that the authority suite still passes
untouched.

## Scope / caveats

- Production code is out of scope: do not change `wizard-context.tsx`
  (including its re-export block at `:19-28` — `wizard-stepper.tsx`,
  `wizard-navigation.tsx`, and the `steps/*` components import through it),
  `wizard-state.ts`, or `wizard-validation.ts`.
- `wizard-state.test.ts` stays untouched; no case from the old suite needs
  porting — its `computeCanAdvance` scenarios are already covered there with
  the same inputs, and its reducer cases are a subset of the authority's.
- If the file is deleted outright, the facade keeps its existing indirect
  coverage (step suites through `renderWizard`, `wizard-navigation.test.tsx`);
  the replacement contract test is the better end state but is small either
  way — do not grow it into a second behavior suite.
- Leaf 042 reshapes `WizardState`, migrates `wizard-state.test.ts`, and may
  touch `wizard-context.test.tsx`. Either order works, but do not implement the
  two leaves concurrently; if leaf 042 lands first, rebase this cleanup onto
  its new reducer and test shapes.
