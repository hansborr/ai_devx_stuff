# 79. E2E specs assert wizard state through raw selectors and public page-object locator fields instead of one page-object contract

Status: Not started
Theme: page-object encapsulation · Area: e2e · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The e2e suite gives contributors two competing automation idioms. Page objects
are supposed to own selectors and interaction sequences (`e2e/MODULE.md:15-17`
says to prefer page-object methods when a stable flow exists), yet specs also
reach around them: 25 raw `getBy*` calls sit directly in six spec files, and
`wizard-validation.spec.ts` alone asserts Continue-button state and drives
boost selection through 18 direct accesses to public page-object locator
fields. The boost sequences even hand-reimplement a private helper the page
object already has — click a public boost combobox field, then raw
`page.getByRole("option", ...)` — duplicating `selectBoost` line for line.
When the wizard UI changes, a contributor must edit selector details scattered
across test narratives instead of one page-object contract, and each new spec
author has to guess which idiom is the sanctioned one.

## Evidence

- 25 raw `getBy*` calls across six specs (re-counted at the pin):
  `e2e/wizard-validation.spec.ts` 8, `e2e/encounter-combat.spec.ts` 6,
  `e2e/navigation-errors.spec.ts` 4, `e2e/a11y.spec.ts` 3,
  `e2e/character-create.spec.ts` 2, `e2e/character-data-integrity.spec.ts` 2.
- `e2e/wizard-validation.spec.ts` — 18 direct public locator-field accesses:
  11 `wizard.continueButton` disabled/enabled assertions (`:21`-`:157`) and 7
  boost-field accesses (`:77`, `:78`, `:83`, `:105`, `:108`, `:113`, `:118`).
- `e2e/wizard-validation.spec.ts:78-84` and `:105-119` — boost selection done
  by hand (public combobox field click + raw
  `page.getByRole("option", { name: "STR" }).click()`), duplicating the page
  object's private `selectBoost` at
  `e2e/page-objects/character-wizard.po.ts:95-98`.
- `e2e/page-objects/character-wizard.po.ts:46-56` — eleven public `readonly`
  locator fields; no method expresses "Continue is disabled/enabled", so specs
  assert through the raw field.
- `e2e/character-data-integrity.spec.ts:102,106` — the same
  `wizard.continueButton` idiom outside wizard-validation (the `:106` call
  passes a custom `{ timeout: 2_000 }`).
- `e2e/wizard-validation.spec.ts:22,36` — the identical raw
  `page.getByText("Complete this step to continue")` assertion repeated in two
  tests.

## Proposed direction

Agreed disposition, essentially verbatim: **add atomic page-object methods for
wizard boost selection and Continue-button state, migrate
`wizard-validation.spec.ts`'s raw `getBy*` and public-locator call sites to
them plus any other spec call site where an equivalent page-object method
already exists, and leave encounter-combat and its serial structure
untouched.**

Mechanics to make that executable, all in
`e2e/page-objects/character-wizard.po.ts` plus call sites:

1. Promote the private `selectBoost(locator, ability)` (`:95-98`) into named
   atomic methods (one per boost slot, plus a wrapper for the `boostModeTriple`
   mode switch), so the sequences at `wizard-validation.spec.ts:77-84` and
   `:105-119` become single calls per selection.
2. Add Continue-state assertion methods (e.g. `expectContinueDisabled()` /
   `expectContinueEnabled()`), accepting an optional timeout so
   `character-data-integrity.spec.ts:106` keeps its `2_000`.
3. Migrate `wizard-validation.spec.ts`'s 8 raw `getBy*` calls and 18 field
   accesses onto those methods, then sweep the other specs for call sites an
   *existing* method already covers (e.g. the two `continueButton` accesses in
   `character-data-integrity.spec.ts`). Do not invent new methods for
   one-off assertions outside the wizard.
4. Verify with `bun run e2e -- wizard-validation.spec.ts` (root `e2e` script,
   `package.json:109`).

## Scope / caveats

- `e2e/encounter-combat.spec.ts` and its serial structure are fully out of
  scope, including its 6 raw `getBy*` calls. The prior pack already declined
  splitting it before reusable API seeding exists
  (`docs/agent_notes/backlog/code-quality-2026-07-25/CONSTRAINTS.md:12`; its
  leaf 42 owns any future split and remains unpromoted) — this leaf does not
  reopen that.
- This is not a wholesale privatization of page-object locator fields; the aim
  is that *repeated* state assertions and interaction sequences get named
  methods. Occasional direct field use for a genuinely one-off check may stay.
- Preserve the parallel/serial describe split in `wizard-validation.spec.ts`
  (`:8-12` documents why the validation block is parallel and the feat-
  backgrounds block at `:161` stays serial).
- The report-only selector drift sensor counts only raw `.locator(` calls
  (`scripts/drift/locator-usage.ts:4`), so `getBy*` bypasses are invisible to
  it; extending the sensor is out of scope here.
- Related: [091-e2e-guide-permits-raw-locators-mandatory.md](./091-e2e-guide-permits-raw-locators-mandatory.md)
  handles the documentation side of the same idiom question in
  `docs/guides/add-e2e-test.md`. No ordering dependency, but the migrated
  call sites here should match the idiom that leaf lands on.
