# Zero Baseline: Lifecycle Check

Status: Done
Order: 11

## Context

`bun run lint:ratchet:zero-baseline` is currently report-first. After the
current zero-baseline rows are triaged, local and CI verification should fail
when new undocumented zero-baseline ratchets appear.

## Prerequisite

Complete tasks `02` through `10`, or re-split any remaining zero-baseline rows
into explicit task files.

## Scope

- Add a checked mode or command that fails when a zero-baseline ratchet lacks a
  normal-lint promotion path or `zeroBaselineDisposition`.
- Wire the check into the appropriate local and CI verification slots.
- Document the lifecycle policy in `docs/guides/lint-ratchet.md` if the
  command shape changes.

## Definition Of Done

Undocumented zero-baseline ratchets fail local verification and CI.

## Verification

- `bun run lint:ratchet:zero-baseline`
- New checked lifecycle command
- `bun run verify:changed`
- Relevant CI/harness manifest checks if slots change
