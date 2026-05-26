# Ratchet Run Grouping

Status: Parked
Order: 31

## Context

Each ratchet is independently configured and auditable. With many ratchets,
runtime and output volume can grow, but grouping too early can obscure failure
ownership.

## Prerequisite

Complete zero-baseline cleanup and ratchet registry builders, then re-measure.

## Scope

- Measure whether ratchet count still hurts local and CI wall time.
- Group compatible ESLint runs only where rule source, parser profile, file
  scope, and metric handling stay clear.
- Keep per-ratchet diagnostics and baseline identity unchanged.

## Definition Of Done

Any grouping improves measured runtime without making a failure harder to map
back to a single ratchet id.

## Verification

- Before/after runtime measurement
- `bash scripts/test-lint-ratchet.sh`
- `bun run lint:ratchet`
- `bun run verify:changed`
