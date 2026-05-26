# Ratchet Registry Builders

Status: Parked
Order: 26

## Context

Many ratchet entries share rule id, source, options, metric, mode, target, and
repair kind, differing only by scope. Builders can reduce duplication, but only
after zero-baseline cleanup makes the registry smaller and clearer.

## Prerequisite

Complete the zero-baseline lifecycle tasks or re-check that the remaining
zero-baseline rows are intentional.

## Scope

- Add small family builders for repeated rule families such as complexity and
  max-lines.
- Keep generated entries type-checked as `LintRatchetConfig`.
- Keep file globs and lifecycle dispositions obvious in reviewed data.

## Definition Of Done

Adding a new scope for an existing ratchet family is a short data edit, and
sibling scopes cannot accidentally drift in rule options.

## Verification

- Ratchet registry tests
- `bun run lint:ratchet:check-registry`
- `bun run lint:ratchet`
- `bun run verify:changed`
