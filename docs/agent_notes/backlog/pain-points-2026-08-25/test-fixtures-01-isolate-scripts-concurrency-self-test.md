# Isolate `test-test-scripts.sh` from Ambient `MUSI_SCRIPTS_CONCURRENCY`

Status: Implemented
Date: 2026-08-25
Priority: P2
Size: S
Source: `test-fixtures-races-and-environment.md` — "Readiness is often
represented by sleep" (the `MUSI_SCRIPTS_CONCURRENCY=1` debugging-mode
paragraph)

## Problem

`MUSI_SCRIPTS_CONCURRENCY` is a documented debugging override
(`scripts/test-scripts.sh:33`, `resolve_scripts_concurrency` at
`scripts/test-scripts.sh:254-266`) that an agent exports for the whole
session to force sequential scripts-lane output while troubleshooting. The
self-test suite for that same runner,
`scripts/tests/test-test-scripts.sh`, is not isolated from that ambient
variable, and both directions of the leak are live-reproducible on HEAD.

**Direction 1 — ambient `MUSI_SCRIPTS_CONCURRENCY=1` breaks the
default-parallel assertion.** The "default concurrency uses parallel mode
when nproc reports headroom" case
(`scripts/tests/test-test-scripts.sh:199-219`) invokes
`bash "$RUNNER_SH" --changed` directly (lines 202-207) without setting or
unsetting `MUSI_SCRIPTS_CONCURRENCY`, so it inherits whatever the calling
shell already exports. Reproduced:

```
MUSI_SCRIPTS_CONCURRENCY=1 bash scripts/tests/test-test-scripts.sh
...
FAIL: default concurrency did not use parallel finish lines for test-verify: ...
```

**Direction 2 — ambient `MUSI_SCRIPTS_CONCURRENCY=2` (or any value) breaks
every exact-order assertion routed through the file's `run_runner` helper.**
`run_runner()` (`scripts/tests/test-test-scripts.sh:105-109`) sets
`MUSI_SCRIPTS_CONCURRENCY="${MUSI_SCRIPTS_CONCURRENCY:-1}"` — a *default*,
not a *forced* value, so when the ambient variable is already set the
helper passes that value straight through instead of the sequential `1`
every one of its ~100 exact-order stub-log assertions assumes. The default
exists for a reason: four callers deliberately pass an explicit value
through `run_runner` (`=1` at line 186; `=2` at 259 and 1149; `=3` at 1121)
to exercise parallel-mode behavior, so the helper must keep honoring a
per-call override. What nothing in the suite needs is for the *ambient*
shell value to reach the helper — every remaining override bypasses it and
calls `bash "$RUNNER_SH"` directly (lines 230, 299, 332, 799, 1179).
Reproduced:

```
MUSI_SCRIPTS_CONCURRENCY=2 bash scripts/tests/test-test-scripts.sh
...
FAIL: verify.sh change should select verify smokes: runner ran test-verify-async
runner ran test-verify
```

(smokes completed out of the order the `run_runner`-based assertion
hard-codes). This matches the note's account of "one four-smoke case
completed in a different valid order" once a bounded parallel value was
used to route around direction 1.

Both directions are test-only self-inflicted flake, not production
behavior: `scripts/test-scripts.sh`'s own concurrency resolution is
unaffected. But an agent who follows the documented debugging convenience
(export `MUSI_SCRIPTS_CONCURRENCY=1` or `=2` for a `verify:changed` session)
and then has `test-test-scripts.sh` selected by `--changed` gets a false
gate failure unrelated to their change.

## Scope

- In `scripts/tests/test-test-scripts.sh`, add
  `unset MUSI_SCRIPTS_CONCURRENCY` once near the top of the suite (after any
  argument handling, before the first case), so the ambient debugging value
  never reaches `run_runner`'s `${MUSI_SCRIPTS_CONCURRENCY:-1}` default. Keep
  `run_runner()` (lines 105-109) as a *default*, not a forced `=1`: the
  callers at lines 186, 259, 1121, and 1149 pass explicit `=1`/`=2`/`=3`
  values through the helper to test parallel-mode behavior, and forcing `1`
  there would break those currently-passing cases.
- In the same file, isolate the "default concurrency uses parallel mode"
  case (lines 199-219) from ambient `MUSI_SCRIPTS_CONCURRENCY` by adding
  `env -u MUSI_SCRIPTS_CONCURRENCY` to its `bash "$RUNNER_SH" --changed`
  invocation (lines 202-207), the same pattern the very next case already
  uses for `MUSI_SCRIPTS_LOG_DIR` (`env -u MUSI_SCRIPTS_LOG_DIR` at line
  ~226). This case wants a genuinely unset variable so `test-scripts.sh`'s
  own nproc-based default applies, not whatever an ambient debugging
  session happens to export.
- No production change: `scripts/test-scripts.sh`'s
  `resolve_scripts_concurrency` and the documented `MUSI_SCRIPTS_CONCURRENCY`
  debugging override are untouched.
- Out of scope: widening this fix to other self-test suites that read
  `MUSI_SCRIPTS_*` overrides — no other suite in this note's evidence showed
  the same leak, and a speculative sweep is not bounded by a reproduction.

## Verification

- `bash scripts/tests/test-test-scripts.sh` passes standalone (regression
  baseline; confirmed green on HEAD before this change).
- `MUSI_SCRIPTS_CONCURRENCY=1 bash scripts/tests/test-test-scripts.sh` passes
  after the fix (currently fails at "default concurrency uses parallel mode
  when nproc reports headroom").
- `MUSI_SCRIPTS_CONCURRENCY=2 bash scripts/tests/test-test-scripts.sh` passes
  after the fix (currently fails at "verify.sh change should select verify
  smokes" with an out-of-order stub log).
