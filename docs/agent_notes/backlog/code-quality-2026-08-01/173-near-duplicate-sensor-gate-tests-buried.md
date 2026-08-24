# 173. The near-duplicate sensor gate contract is buried inside the detector suite

Status: Not started
Theme: Sensor test ownership · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The main near-duplicate sensor's CLI and baseline-gate contract is implemented
as the final block of the drift-ai detector suite. A contributor looking beside
the sensor entrypoint finds parser and merge-command tests but no main sensor
suite, making existing coverage look absent. Conversely, a focused detector run
also executes temporary-Git-repository scenarios concerned with baseline
admission, update refusal, and post-merge restoration.

Coverage exists, so this is a discoverability and ownership defect rather than a
behavior gap. It is cheapest to correct during the already-planned move of the
sensor family into its owner directory.

## Evidence

- `scripts/drift-ai/near-duplicates.test.ts:7-30` imports the top-level sensor
  CLI and baseline reader alongside the drift-ai detector, check, runner, scope,
  and finding modules, exposing the two subjects combined by the suite.
- `scripts/drift-ai/near-duplicates.test.ts:698-932` is a 235-line
  `describe("runNearDuplicatesCli")` block containing seven tests. Its helpers
  create and commit temporary repositories at `:699-730`; its cases cover
  baseline admission and regression rejection (`:733-764`), configuration
  (`:766-804`), reviewed admission (`:806-848`), bypass prevention
  (`:862-879`), update refusal (`:881-890`), and merge-truth restoration
  (`:892-931`).
- The complete file measures 932 lines and 35 tests, so the seven sensor-gate
  cases are a minority block at the end of a primarily detector-oriented suite.
- `scripts/drift-ai/fixtures/near-duplicate-gate/existing-basket.ts:1-15`,
  `existing-order.ts:1-15`, and `new-clone.ts:1-15` are three dedicated gate
  fixtures loaded only by the embedded block at
  `scripts/drift-ai/near-duplicates.test.ts:699-725`.
- `scripts/sensor-near-duplicates-merge-cli.test.ts:27-127` already gives the
  merge command a subject-matched suite. The measured nine-file top-level
  `sensor-near-duplicates*` family has tests for CLI options and merge behavior,
  but no `sensor-near-duplicates.test.ts` for the main gate.

## Proposed direction

When executing the CQ25-42 sensor owner-directory move, also extract
`scripts/drift-ai/near-duplicates.test.ts:698-932` and its
`near-duplicate-gate` fixtures into a subject-named sensor gate suite. Leave the
detector, runner, comparison, and drift-check contracts in
`near-duplicates.test.ts`.

Place the new suite under the planned `scripts/sensor-near-duplicates/` owner
directory. Move its `fixture`, `commitAll`, and `committedDebtRepo` helpers with
the seven tests, give the new suite its own temporary-repository cleanup
registration, and relocate the three dedicated fixtures beside that suite.
Remove imports from the detector suite only after their remaining uses have
been checked.

## Scope / caveats

- This work is an addendum to
  [the July layout plan](../code-quality-2026-07-25/28-PLAN.md), whose slice
  28.9 already owns moving the `sensor-near-duplicates` family. Fold it into
  that slice rather than creating a competing file-move lane.
- The July plan's ruling remains binding: retain the sensor and merge-CLI
  top-level facades and preserve pre-push-visible paths.
- Do not change gate semantics, baseline identities, admission policy, fixture
  contents, or production sensor code. Preserve the seven test cases while
  changing only their ownership and location.
- Keep detector extraction, comparison, runner, and drift-check coverage in
  `scripts/drift-ai/near-duplicates.test.ts`; splitting those subjects further
  is outside this leaf.
