# 13 — Async verification reports “started” without usable state

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

> **Amended — 2026-07-13 adversarial triage.** The mechanics stand, but stderr already exposes directory or temporary-file errors and no success marker is minted. This is a misleading fail-closed start result, not a silent verification bypass.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/verify-async.sh:8` — the wrapper enables only `set -u`.
- `scripts/verify-async.sh:274` and `scripts/verify-async.sh:286-287` — state-directory creation and initial state persistence are not guarded.
- `scripts/verify-async.sh:297-298` — post-spawn PID state and latest-pointer updates can fail.
- `scripts/verify-async.sh:301-304` — the script still prints a successful start result.

Failure: On an unwritable or full state root, callers can receive a PID and log path even though status cannot discover a usable run.

## Do

Require directory creation and initial state persistence before spawning. If the PID update fails, terminate the spawned child; update `latest` atomically only after all required state exists.

## Verify

```
bash scripts/tests/test-verify-async.sh
```

## Acceptance

- No success line is printed unless durable state and the latest pointer exist.
- A post-spawn persistence failure reaps the child and returns nonzero.
