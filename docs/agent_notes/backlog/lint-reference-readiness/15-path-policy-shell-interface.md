# Path Policy Shell Interface

Status: Done
Order: 15

## Context

After the shared path-policy data model exists, shell callers need a stable way
to query it without each script reimplementing the same path lists. This task
adds that boundary without migrating production callers.

## Prerequisite

Complete `14-path-policy-data-model.md`.

## Scope

- Expose shared path-policy data through a stable, NUL-safe interface for shell
  callers.
- Cover output contracts for lintable files, format-check files, config/shell
  surfaces, source-relevance paths, script-smoke subjects, and full-scan
  triggers.
- Add fixture coverage for unsupported paths, JSON/JSONC handling, deletion-like
  inputs, untracked agent-file names, and full-scan trigger queries where the
  interface owns classification.
- Keep staged/base/untracked/deletion semantics with the future callers; this
  task should only prove the interface can carry the data safely.

## Definition Of Done

Shell scripts have one tested interface for querying shared path-policy data,
and no production caller has been migrated yet.

## Verification

- Interface-specific shell/unit tests
- `shellcheck` for changed shell scripts
- `bun run test:scripts:changed`
- `bun run verify:changed`
