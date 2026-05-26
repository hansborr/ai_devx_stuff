# ESLint Config Composition

Status: Parked
Order: 25

## Context

After shared policy and max-lines data are extracted, the remaining ESLint
config can be split only where the dependency graph and review burden justify
it.

## Prerequisite

Complete `23-eslint-shared-policy.md` and `24-eslint-max-lines-policy.md`.

## Scope

- Split the remaining config into focused modules only where doing so reduces
  review burden or separates real ownership boundaries.
- Keep plugin setup, package scopes, test relaxations, custom-rule wiring, and
  file-specific overrides easy to trace.
- Avoid moving code solely to reduce line count.

## Definition Of Done

The main ESLint config is a short composition entry point without making rule
ownership harder to understand.

## Verification

- ESLint config tests or targeted resolved-config checks
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
