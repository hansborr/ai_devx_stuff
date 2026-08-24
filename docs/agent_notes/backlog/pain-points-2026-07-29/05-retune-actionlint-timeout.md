# Retune the Actionlint Timeout

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `gate-timeouts-and-load.md` — “Actionlint: hard 10-second per-workflow
budget”

## Problem

`scripts/lint-config-sensors.sh:268-284` gives each bounded actionlint
invocation a ten-second default. The diagnostic and environment override are
sound, but the default repeatedly expired under parallel lint, test, and
typecheck load while the same workflow passed standalone. The persisted
successful workaround was `MUSI_ACTIONLINT_TIMEOUT=60s`.

The archive records four consecutive failures at ten seconds followed by a
successful 60-second override, plus a separate successful 90-second workaround
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:344-353`
and
`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:412-423`).
Fresh measurements on this 16-core host found the three workflows at
0.604-0.626 seconds while idle and sixteen concurrent checks of
`slow-drift.yml` at 1.480-2.620 seconds. No evidence shows 60 seconds failing,
so 90 seconds would add hang latency without closing a demonstrated gap.

This is a load-induced lint verdict flake. It does not share or corrupt another
worktree's logs, and it is independent of the registration timeout in leaf 04.

## Scope

- In `scripts/lint-config-sensors.sh:268-284`, change only the fallback for
  `MUSI_ACTIONLINT_TIMEOUT` from `10s` to `60s`. Retain the environment value
  verbatim when it is set.
- Keep one bounded `timeout` invocation per workflow. Preserve the exact
  exit-124 diagnostic, including configured limit and workflow path, and
  preserve ordinary actionlint failures without relabeling them as timeouts.
  Do not retry, serialize the sensor set, or add host-load heuristics.
- In `scripts/tests/test-lint-config-sensors.sh`, add fixture-local actionlint
  and `timeout` stubs that record argv and select exit status without sleeping.
  Separate these contract cases from the existing helper at lines 217-226,
  which intentionally forces `20s` for the integration fixtures.
- Pin a no-override invocation using `60s`, an explicit `17s` override used
  verbatim, exactly one invocation returning 124 with the file-specific
  diagnostic, and exactly one invocation returning ordinary status 73 without
  retry or a timeout diagnostic.
- Annotate entry #5 in the hand-maintained
  `docs/generated/observed_flaky_tests.md`: mark only its actionlint subcase
  resolved by the new 60-second default and remove the obsolete advice to raise
  that timeout above 10 seconds. Preserve the entry's unrelated server and
  max-lines timeout evidence/guidance.

## Acceptance

- With `MUSI_ACTIONLINT_TIMEOUT` unset, the recorded command is exactly
  `timeout 60s <actionlint> <workflow>`.
- With `MUSI_ACTIONLINT_TIMEOUT=17s`, the recorded command uses `17s`
  unchanged.
- Exit 124 produces one invocation and a diagnostic naming both `60s` and the
  workflow path. An actionlint exit 73 produces one invocation, makes the
  aggregate sensor command fail normally, and is not labeled as a timeout.
- Existing clean and invalid-workflow integration fixtures retain their
  behavior, and `bash scripts/tests/test-lint-config-sensors.sh` passes.
- Flaky entry #5 no longer recommends an actionlint increase that this leaf
  implements, while its unrelated open timeout cases remain intact.

## Resolved decisions

- Set the default to 60 seconds, not 90. Sixty is the smallest archived
  override proven to make the contended gate pass, and no recorded or live
  measurement requires 90.
- Use one bounded invocation with no retry. A retry repeats CPU-heavy work
  during the contention that caused the timeout and can double the sensor's
  cost; the larger single budget preserves a clear status and diagnostic.

## Open questions

None.
