# 52 - drift surface harness inventory parity

Status: Parked
Track: G
Size: small-medium
Depends on: none
Blocks: none

## Goal

Keep `harness.controls.json`, `docs/generated/harness-controls.md`, and
`docs/ai-harness.md` aligned with the live `drift:ai` check and subcommand
surface.

## Background

As of 2026-06-02, the live drift registry includes `unused-exports` and the
`duplicate-*` checks, and the live subcommands include `coldspots`. The generated
harness controls still list only a subset of drift checks/subcommands, and
`docs/ai-harness.md` describes the opt-in drift checks in older terms. Task 51
covers README/example-config parity; this task covers the broader harness
inventory.

## Seams to touch

- `harness.controls.json`
- `docs/generated/harness-controls.md`, through the normal generator
- `docs/ai-harness.md`
- `scripts/generate-harness-controls.ts` or a focused test/script, only if adding
  a parity guard
- `scripts/drift-ai/check-metadata.ts` as the live check-id source.

## What to do

1. Inventory live `CHECK_METADATA` ids and live drift subcommands.
2. Add missing manifest controls for current live drift checks and subcommands,
   or document an explicit omit list for surfaces that intentionally stay grouped.
3. Refresh `docs/generated/harness-controls.md` via the generator.
4. Refresh the `docs/ai-harness.md` drift rows so they name the current opt-in
   surface, including `unused-exports`, duplicate-shape checks, and `coldspots`.
5. Add a narrow parity guard so a new drift check id or subcommand forces a
   conscious manifest add-or-omit decision.

## Testing

- `bun run docs:harness-controls:check`
- The new parity test/script if one is added.
- `bun run drift:ai --scope current --check all --format text --root scripts/drift-ai`
  only if the docs change relies on a smoke of current check names; avoid using
  slow whole-repo knip as the only proof.

## Out of scope

- Adding new drift checks.
- Diagnostics-envelope projection; use tasks 10-13.
- Auto-generating `docs/ai-harness.md` from the registry.
