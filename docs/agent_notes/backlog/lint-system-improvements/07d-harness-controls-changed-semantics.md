# Harness Controls Changed Semantics

Status: Parked
Order: 7d

## Context

The hard part of making `harness.controls.json` executable is not simple
command strings; it is preserving staged content, changed-vs-base scans,
full-tree scans, logs, caches, watchdogs, and diagnostics when a wrapper
selects inputs dynamically.

Prerequisite: complete or consciously revalidate `07a`-`07c`.

## Scope

- Inventory changed/staged/full-tree semantics for verify, pre-commit, CI,
  lint, format, test, ratchet, and generated-doc gates.
- Add manifest fields only for semantics that can be validated with fixtures.
- Keep existing selectors authoritative until the manifest can represent their
  inputs and failure diagnostics without loss.
- Add or update focused tests for each selector family migrated to the
  manifest model.
- Split another follow-up if more than one selector family needs migration.

## Definition Of Done

The manifest can represent at least one dynamic input selector family without
changing selected files, command arguments, logs, or failure diagnostics.

## Verification

- Selector fixture proving old and manifest-mode inputs match for the migrated
  family
- `bash scripts/test-verify.sh` if verify selectors change
- `bash scripts/test-lint-changed.sh` if lint changed-file selectors change
- `bash scripts/test-format-changed.sh` if format changed-file selectors change
- `bash scripts/test-test-changed.sh` if test changed-file selectors change
- `bun run verify:changed`
