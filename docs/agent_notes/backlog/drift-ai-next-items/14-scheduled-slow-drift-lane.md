# 14 - Scheduled slow-drift lane

Status: Parked
Track: Dg
Size: small-medium
Depends on: 13
Blocks: none

## Goal

Run a weekly report-only slow-drift audit in GitHub Actions and upload artifacts
without gating PRs or pushes.

## Background

The lane should run `harness:audit` after tasks 10-13 so scheduled output uses
the same envelope/fusion path as manual review. A direct `drift:ai --scope
current` workflow is a separate shortcut decision and should be split before
implementation if the maintainer wants it.

## Seams to touch

- `.github/workflows/`
- `package.json`, only if a stable script alias is added
- `docs/ai-harness.md`
- any CI helper docs that list scheduled jobs.

## What to do

1. Run the producer commands needed for the first fused report, write their
   envelopes to artifact paths, then run `bun run harness:audit` over those files.
2. Trigger on a weekly cron plus `workflow_dispatch`.
3. Install dependencies the same way existing CI does.
4. Upload producer envelopes plus text and JSON fused artifacts even when
   findings are present.
5. Set an explicit job timeout.
6. Keep the job report-only; findings must not fail the workflow.
7. Document where artifacts live and how to inspect them.

## Testing

- Run the scheduled command locally.
- Validate workflow syntax with the repo's existing tooling or `actionlint` only
  if already available.
- Confirm representative findings still exit zero.

## Out of scope

- PR comments.
- A direct `drift:ai --scope current` shortcut lane before `harness:audit`; split
  that as its own task if chosen.
- Failing on findings.
- Mutation testing or timing trend add-ons.
