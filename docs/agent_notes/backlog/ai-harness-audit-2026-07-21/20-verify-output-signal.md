# Verify Progress-Output Decision

Status: Rejected after adversarial review — narrow cleanup only
Date: 2026-07-21

## Finding

Manual changed/parallel verification emits a burst of per-slot launch lines.
Serial verification prints the current slot before work that may run for a long
time. Existing tests pin the meaningful stage-work and full-verify actions for
the no-op path, though not the literal `nothing to verify` phrase.

## Rejected design

Do not remove all transitions and replace them with configurable heartbeat
timers, current-slot state, and signal cleanup. That adds state to the critical
gate path while discarding useful serial localization. Do not pin incidental
literal prose when the actionable behavior is already tested.

## Proportionate alternative

- Keep serial current-slot progress.
- Optionally suppress only the rapid parallel launch burst by passing an empty
  step label, after confirming no consumer depends on it.
- Correct stale documentation about the existing no-op coverage.
- Retain memory-deferral warnings, final aggregates, failure excerpts, log
  paths, and the tail-proof footer.

Reopen heartbeat work only after a measured hang demonstrates that existing
serial progress and log metadata cannot identify the active slot.
