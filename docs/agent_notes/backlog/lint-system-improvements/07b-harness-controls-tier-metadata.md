# Harness Controls Tier Metadata

Status: Parked
Order: 7b

## Context

After simple command slots are validated, the manifest can start recording
which execution tiers own each slot. This is separate from runner generation:
metadata should be checked and documented before any wrapper depends on it.

Prerequisite: complete or consciously revalidate
`07a-harness-controls-simple-slot-validation.md`.

## Scope

- Add tier metadata only where it can be validated reliably:
  `post-edit`, `precommit`, `verify:changed`, `verify`, and `ci`.
- Keep metadata scoped to slots whose tier ownership can be proven from
  package scripts, Husky, verify wrappers, CI, and generated docs.
- Extend `harness:check` to reject unknown tiers, missing required tier fields,
  and stale tier documentation for the covered slot class.
- Preserve tier-specific semantics: staged content, changed-vs-base scans,
  full-tree scans, watchdogs, logs, caches, and diagnostics consumers.
- Do not generate runner commands in this leaf.

## Definition Of Done

Validated manifest entries say which tiers execute the covered simple slots,
and generated docs/checks fail when that tier metadata drifts.

## Verification

- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bash scripts/test-generate-harness-controls.sh`
- `bun run verify:changed`
