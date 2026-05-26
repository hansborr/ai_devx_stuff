# Ratchet Registry Safe Default

Status: Done
Order: 12

## Context

CI runs `bun run lint:ratchet:check-registry`, but local `verify:changed` and
pre-commit run `lint:ratchet` without the registry preflight's empty-glob and
absolute-path checks.

## Scope

- Prefer folding `empty-glob`, `absolute-path`, orphan-baseline, and shape
  validation into `bun run lint:ratchet` startup.
- If startup cost or output shape argues against that, add
  `lint:ratchet:check-registry` as a separate pre-commit and `verify:changed`
  slot.
- Keep failure messages actionable for local users.

## Definition Of Done

A local source-relevant commit cannot pass with an empty ratchet glob or an
absolute path in the ratchet registry.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-registry`
- `bun run verify:changed`
- A targeted fixture or smoke proving empty globs fail locally
