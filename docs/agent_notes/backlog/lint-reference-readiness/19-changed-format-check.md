# Changed Format Check

Status: Done
Order: 19

## Context

`format:check` is a CI gate. `format:changed` exists, but it writes with
Prettier instead of checking, and it is not part of pre-commit or
`verify:changed`. The post-edit tidy hook reduces misses but is best-effort
agent feedback, not a contributor gate.

## Prerequisite

Complete enough path-policy work that changed-format selection can consume the
shared file-surface data, especially `17-path-policy-format-callers.md`.

## Scope

- First confirm the practical gap with a targeted staged-file smoke or recent
  CI evidence. If local gates already reject unformatted staged files
  reliably, demote this to documentation.
- Add `format:changed:check` or a `format:changed --check` mode.
- Use the same staged/base content contract as changed lint where the caller
  verifies staged content.
- Wire the check into pre-commit and `verify:changed`.

## Definition Of Done

An unformatted staged file fails before commit; formatting-only changes are
allowed when the changed files are already formatted.

## Verification

- New staged-file smoke
- `bun run format:changed:check` or equivalent
- `bun run verify:changed`
- Relevant harness manifest checks if slots change
