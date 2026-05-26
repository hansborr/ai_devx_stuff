# ESLint Max-Lines Policy

Status: Parked
Order: 24

## Context

Per-file `local/max-lines` caps in ESLint need to stay in sync with matching
ratchet ignores. Dual maintenance is a reference-readiness liability.

## Scope

- Move large-file exceptions to one data structure containing path, cap,
  reason, owner or exit path, and whether the file is excluded from the default
  max-lines ratchet.
- Generate or import that same data for ESLint overrides and ratchet ignores.
- Add checks that catch missing reasons, stale paths, and drift between ESLint
  caps and ratchet ignore policy.

## Definition Of Done

Max-lines exceptions no longer require remembered edits in both ESLint config
and the ratchet registry.

## Verification

- Relevant config/policy tests
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
