# ESLint Shared Policy

Status: Done
Order: 23

## Context

The root ESLint config is large and combines plugin setup, package scopes,
restrictions, test relaxations, custom-rule wiring, max-lines exceptions, and
file-specific overrides. The first split should extract shared policy data, not
shuffle config modules for its own sake.

## Scope

- Extract `eslint-config/shared-policy.js` or equivalent for shared
  restriction patterns, script file lists, override scaffolding data, and other
  policy data with multiple consumers.
- Deduplicate repeated restricted-import entries through that shared policy.
- Keep the root ESLint config behavior unchanged.

## Definition Of Done

Shared restriction and surface data have one owner, and the root ESLint config
still resolves to the same intended rule behavior.

## Verification

- ESLint config tests or targeted resolved-config checks
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
