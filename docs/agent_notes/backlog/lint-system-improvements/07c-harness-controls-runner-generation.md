# Harness Controls Runner Generation

Status: Parked
Order: 7c

## Context

Once simple slots and tier metadata are validated, one wrapper can start using
manifest-derived wiring. This should remain a narrow behavior-preserving leaf,
not a rewrite of CI, Husky, and verify at the same time.

Prerequisite: complete or consciously revalidate `07a` and `07b`.

## Scope

- Pick one simple tier surface first, such as a generated verify helper or CI
  command list.
- Generate or adapt only the covered simple slot commands from
  `harness.controls.json`.
- Keep wrapper-specific output formatting, sticky comments, logs, caches,
  lock/watchdog behavior, and diagnostics consumers outside the manifest
  runner.
- Add fixture coverage showing the generated runner emits the same commands as
  the previous hand-written path.
- Do not migrate changed-file or staged-input selectors in this leaf.

## Definition Of Done

One simple execution surface consumes manifest-derived commands with an
equivalence test proving the command list and diagnostics contract did not
change.

## Verification

- `bun run harness:check`
- `bun run docs:harness-controls:check`
- Focused equivalence fixture for the generated runner path
- `bash scripts/test-verify.sh` if verify wiring changes
- Successful CI validate run if CI wiring changes
- `bun run verify:changed`
