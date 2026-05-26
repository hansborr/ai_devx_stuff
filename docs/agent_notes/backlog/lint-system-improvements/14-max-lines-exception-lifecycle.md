# Max-Lines Exception Lifecycle

Status: Parked
Order: 14

## Context

The max-lines exception list is long. Some entries represent durable structural
choices; others are temporary debt better tracked by ratchets. The source
review recommends making that lifecycle visible.

Overlap: `docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md`
tracks shared ownership for max-lines policy and ratchet ignores. Coordinate
with that task before promoting this one. If that task has not landed, either
merge this lifecycle classification into it or make this leaf explicitly
depend on its shared policy data.

## Scope

- Re-audit max-lines overrides, ratchet max-lines ignores, and related policy
  docs.
- Mark each exception as `temporary`, `permanent`, or `candidate-for-split`.
- For temporary exceptions, name a backlog item or split milestone.
- For permanent exceptions, record a durable architectural reason.
- Add a report that sorts exceptions by cap, age, and whether they have shrunk.
- Prefer shared policy data if the older max-lines policy task has landed.

## Definition Of Done

Every max-lines exception has an explicit lifecycle, and stale temporary
exceptions are visible through a report or validation check.

## Verification

- Lifecycle report/check fixture covering `temporary`, `permanent`, and
  `candidate-for-split`
- Relevant policy/config tests
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0` if ESLint config changes
- `bun run verify:changed`
