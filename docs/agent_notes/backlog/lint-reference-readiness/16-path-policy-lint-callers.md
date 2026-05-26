# Path Policy: Lint Callers

Status: Done
Order: 16

## Context

Once shared path-policy data and the shell interface exist, lint-related callers
should consume them instead of keeping parallel file-surface lists. Format
scripts are intentionally left for the next task.

## Prerequisite

Complete `14-path-policy-data-model.md` and
`15-path-policy-shell-interface.md`.

## Scope

- Migrate changed lint, config sensors, shell lint, and metadata verification
  where they duplicate shared path data.
- Preserve each caller's staged/base/untracked/deletion semantics.
- Add regression fixtures for JSON/JSONC, deleted files, unsupported files, and
  full-scan trigger behavior covered by these lint callers.

## Definition Of Done

Lint path-surface changes no longer require parallel edits across these scripts,
and format callers remain unchanged for `17-path-policy-format-callers.md`.

## Verification

- Relevant shell/unit tests for migrated callers
- `shellcheck` for changed shell scripts
- `bun run test:scripts:changed`
- `bun run verify:changed`
