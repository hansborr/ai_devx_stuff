# Fix Harness Controls Drift

Status: Done
Order: 1
Landed: commit 17c41412, 2026-05-25

## Context

`harness.controls.json` understates the actual `verify:changed` and pre-commit
gates. In particular, it omits coverage-map in verify and omits ratchet plus
coverage-map in pre-commit.

## Scope

- Update the manifest entries and regenerated docs.
- Add or tighten a harness check that compares known wrapper slots against the
  manifest so future gate additions cannot drift silently.

## Definition Of Done

`bun run docs:harness-controls:check` and `bun run harness:check` fail when a
wrapper gate changes without a matching manifest change.

## Verification

- `bun run docs:harness-controls:check`
- `bun run harness:check`
- `bun run verify:changed`
