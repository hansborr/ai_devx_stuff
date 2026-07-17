# 03 — The core verify timeout can hang instead of completing with 124

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Amended — 2026-07-13 adversarial triage.** The claimed exit-143 mechanism was refuted: `verify.sh` runs with `set -u`, the trap completes, and a normal terminated child produces exit 124. Only the hang half stands: a TERM-ignoring child can block the unbounded wait and retain the verify flock.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/verify.sh:31` — the wrapper enables `set -u`, not `set -e`; expected nonzero waits do not abort the timeout trap.
- `scripts/process-tree.sh:46-55` — process-tree cleanup sends one requested signal with no TERM-to-KILL escalation.
- `scripts/verify/verify-engine.sh:35-54` — the watchdog fires only once.
- `scripts/verify.sh:191-204` — cleanup waits without a bound, while the run retains the FD-9 verification lock.

Failure: A child that ignores TERM prevents timeout completion, withholds the promised exit 124 and metadata, and can queue later verify runs behind the retained flock indefinitely.

## Do

Give TERM a bounded grace period, then KILL the surviving process tree and reap it. Preserve timeout metadata and exit 124 even when cleanup encounters errors.

## Verify

Extend `scripts/tests/test-verify.sh` with a TERM-ignoring child fixture that
proves bounded TERM-to-KILL escalation, exit 124, timeout metadata, and verify
flock release; then:

```
bash scripts/tests/test-verify.sh
```

## Acceptance

- A TERM-ignoring fixture is forcibly reaped within a bounded interval.
- The timed-out run records its outcome, releases the flock, and exits 124.
