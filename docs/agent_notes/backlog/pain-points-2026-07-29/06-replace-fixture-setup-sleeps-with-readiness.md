# Replace Fixture Setup Sleeps with Readiness Signals

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `test-fixtures-races-and-environment.md` — “Readiness is often
represented by sleep”

## Problem

Several AI-hook lock fixtures launch a background holder and wait a fixed
`sleep 0.2` before exercising the contender
(`scripts/ai-hooks/test.sh:2068-2104,2106-2183,2393-2422`). The same suite
already demonstrates a deterministic alternative with ready/release markers at
`scripts/ai-hooks/test.sh:2425-2493,2496-2534`.

The agent-wrapper fixture has a similar ordering gap:
`scripts/tests/test-skill-dispatch-wrappers.sh:4728-4748` waits for the
wrapper's `backend-pid` log line before sending `TERM`, but the fake Codex
backend opens `.git/index.lock` only after it starts
(`scripts/tests/test-skill-dispatch-wrappers.sh:112-134`). The persisted
failure observed exactly that ordering: the backend had not opened the lock
when `TERM` landed. The helper `await_ready` at
`scripts/tests/test-skill-dispatch-wrappers.sh:328-341` can wait for the
resource-specific marker instead.

Under parallel-lane CPU load, process creation can exceed 200 milliseconds, so
the contender can run before the fixture owns the resource it is meant to
contend on. That creates a false test result; it is not production shared-state
corruption and does not belong to C8 or the verification-log identity work.

## Scope

- In `scripts/ai-hooks/test.sh`, add one bounded holder-readiness helper and
  convert the five lock-contention fixtures at lines 2068-2183 and 2393-2422.
  Each holder must publish a path under that run's `TMP_ROOT` only after
  `flock` succeeds; the contender must wait for that marker and holder
  liveness. Use an explicit release marker when it shortens or makes teardown
  deterministic.
- In `scripts/tests/test-skill-dispatch-wrappers.sh`, extend the fake Codex
  backend at lines 112-134 with a test-only marker published by the stubborn
  child only after it has inherited the open `.git/index.lock` descriptor and
  installed its `TERM`-ignore trap. Make the stubborn-child fixture at lines
  4728-4748 wait with `await_ready` before sending `TERM`; a parent-side marker
  immediately after `child &` is not sufficient proof that the child has run.
- Replace setup-order sleeps only. Retain sleeps whose duration is itself the
  behavior under test, including the lock-hold intervals used to exercise
  wait-budget and timeout-clamp behavior.
- Ensure every holder is reaped and every marker/lock is removed on success,
  assertion failure, and interruption.
- Verify with `bash scripts/ai-hooks/test.sh` and
  `bash scripts/tests/test-skill-dispatch-wrappers.sh`; the latter is a shell
  smoke suite, not a Vitest file.

## Acceptance

- A contender never starts until the fixture proves the holder owns the
  intended lock.
- The tests fail with a bounded, resource-specific readiness diagnostic when a
  holder never becomes ready or exits before becoming ready.
- Repeated focused runs with parallel suite load do not rely on increasing
  fixed sleeps.
- No new repository-root marker or cross-suite shared fixture path is
  introduced.

## Resolved decisions

- Use ready markers under each suite's private `TMP_ROOT`, not a longer setup
  sleep or repository-root marker. The AI-hooks suite already uses bounded
  ready/release handshakes for the same lock shape
  (`scripts/ai-hooks/test.sh:2425-2493,2496-2534`), and the wrapper suite
  already centralizes its bounded, liveness-aware poll in `await_ready`
  (`scripts/tests/test-skill-dispatch-wrappers.sh:328-341`).
- Replace only the five `sleep 0.2` startup graces and the wrapper's earlier
  lifecycle wait. Holder-duration sleeps remain where elapsed lock occupancy
  is part of the timeout assertion.
- No entry in the hand-maintained
  `docs/generated/observed_flaky_tests.md` records these lock-holder readiness
  races; entry #2 concerns a different verify-log marker-age incident, so no
  registry edit is required.

## Open questions

None.
