# Verify Gate Follow-up Backlog — 2026-07-30

Status: Parked task index
Date: 2026-07-30

This fresh pack records two owner-approved follow-ups to the verification gate.
Both leaves landed 2026-07-30. The
[`pain-points-2026-07-29`](../pain-points-2026-07-29/00-index.md) pack remains
closed; its leaves and disposition ledger are cited only as prior decisions.

## Disposition

| # | Item | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 01 | [Widen the pre-commit registration hang guard to 45 seconds](01-widen-registration-hang-guard.md) | P1 | S | Done — `fc24199cd` |
| 02 | [Attach starting host load only to failed gate output](02-failed-gate-starting-load.md) | P1 | S | Done — `e21f1b1ab` |

## Owner decisions

- The registration guard's approved default is 45 seconds. The extra 30
  seconds applies only when registration is genuinely stuck; a passing command
  returns normally.
- Load and core count are captured at gate start and emitted only for a failed
  run. They are diagnostic evidence, never verdict input, and do not belong in
  `doctor`.

## Known follow-up

- Runtime activation still follows verification-lock and commit-queue
  acquisition, as the owner-approved definition of “starting” requires.
  Verification-lock timeout, an exhausted budget after that wait, and a busy
  commit queue therefore have no starting-load sample even though host overload
  can cause them. Deciding whether those pre-runtime failures need separate
  lock-stage evidence is future scope; moving this sample earlier would change
  both its meaning and the gate's elapsed-time boundary.

Promotion follows the normal backlog process in the parent
[`README.md`](../README.md).
