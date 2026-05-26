# CI Parallelization

Status: Parked (superseded by lint-system-improvements/12-ci-validate-fanout.md)
Order: 32

## Context

CI runs validate steps mostly sequentially. Typecheck currently precedes lint
because type-aware ESLint depends on built referenced-project output.

## Scope

- Document the build artifacts ESLint needs after typecheck.
- Consider splitting jobs so independent work runs in parallel without
  duplicating expensive setup.
- Keep the ratchet diagnostics artifact and sticky comment behavior intact.

## Definition Of Done

CI wall time improves in measurement, and failures remain as easy to diagnose
as the current single validate job.

## Verification

- Before/after CI timing
- Successful CI validate run
- Ratchet diagnostics artifact and sticky comment smoke
