# 24 - Basic scheduled slow-drift lane

Status: Parked
Track: Dg (diagnostics)
Size: medium
Depends on: 11, 23, 53
Blocks: 25

## Goal

Run `harness:audit` on a scheduled GitHub Actions lane and publish the result as
an artifact without gating normal PRs.

## Background

The review recommended moving slow or broad drift checks out of the edit loop.
The first scheduled lane should be intentionally quiet: weekly, report-only,
artifact-only, and easy to disable if it is noisy.

## Seams to touch

- `.github/workflows/`
- `package.json`, only if `harness:audit` needs a stable script alias
- `docs/ai-harness.md`
- Any CI helper docs that list scheduled jobs

## What to do

1. Add a scheduled workflow, or a clearly isolated scheduled job, that runs on a
   weekly cron plus `workflow_dispatch`.
2. Install dependencies the same way existing CI does.
3. Run `bun run harness:audit` and write text plus JSON artifacts if the command
   supports both.
4. Upload artifacts even when findings are present.
5. Set an explicit job timeout.
6. Keep the job report-only: findings must not fail PRs or pushes.
7. Document where the artifact lives and how to inspect it.

## Testing

- Run the workflow command locally.
- Validate workflow syntax with the repo's existing CI-check tool if one exists;
  otherwise use `bunx actionlint` only if already available in the environment.
- Confirm the command exits zero with representative findings.

## Out of scope

- PR comments.
- Failing on findings.
- Adding mutation testing or timing trend add-ons; see task 25.
