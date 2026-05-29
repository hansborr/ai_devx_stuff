# CI Validate Fanout

Status: Parked
Order: 12

## Context

Typecheck-before-lint is real because type-aware ESLint depends on referenced
project output. After typecheck, many checks can fan out: lint, ratchet,
zero-baseline, coverage-map, generated docs and harness checks, module index,
script smoke tests, and unit tests if resource contention is controlled.

Overlap: the earlier CI parallelization task was superseded by this task.

## Scope

- Measure current validate wall time and set a target budget based on real CI
  runs.
- Start with a small fanout that preserves current diagnostics.
- Keep ratchet plus its report/comment steps in one job unless artifact
  upload/download and `needs:` plumbing are added for the diagnostics JSON.
- Preserve sticky PR comment behavior.
- Avoid duplicating expensive setup or changing gate semantics while moving
  steps.

## Definition Of Done

CI validate wall time improves in measurement, and failures remain as easy to
diagnose as the current workflow.

## Verification

- Before/after CI timing
- `bun run lint:config-sensors`
- `bun run verify:changed`
- Successful CI validate run
- Ratchet diagnostics artifact and sticky comment smoke
