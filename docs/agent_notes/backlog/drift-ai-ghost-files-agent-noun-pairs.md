# drift:ai ghost-files noun/agent role pairs

Status: Parked
Source: `docs/agent_notes/finished_work/drift-ai-field-run-calibration.md`

## Trigger

The 2026-06-05 focused Musi current-scope calibration run found one reviewed
`ghost-files` false positive:

- `scripts/drift-ai/env-define-evaluation.ts` <->
  `scripts/drift-ai/env-define-evaluator.ts`

The split is intentional. `env-define-evaluation.ts` owns deterministic expression
evaluation, while `env-define-evaluator.ts` is the public inventory helper.
Existing current-scope role-family tuning suppresses configured role markers such
as `type`, `schema`, and `model`, but this `evaluation`/`evaluator` noun/agent
pair still reports as `near-edit-distance`.

## What to do

1. Reproduce with:
   `bun run drift:ai --scope current --root scripts/drift-ai --check ghost-files --format text`.
2. Gather at least one more field example before adding a generic rule. If this
   remains the only example, prefer an exact `currentAllowedPairs` entry instead
   of broadening the detector.
3. If a generic rule is justified, keep it current-scope-only and preserve
   changed-scope sensitivity for freshly added suspicious siblings.
4. Update the calibration record with the decision and before/after counts.

## Out of scope

- Rewriting `ghost-files` as an import-graph analyzer.
- Suppressing arbitrary edit-distance pairs with no role evidence.
- Changing default report exit semantics.
