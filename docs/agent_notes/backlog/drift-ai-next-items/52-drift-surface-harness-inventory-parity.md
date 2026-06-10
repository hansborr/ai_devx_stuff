# 52 - drift surface harness inventory parity

Status: Done
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

## Triage note (2026-06-04, from task 53 implementer)

This task has grown well past its original "small-medium" sizing and now hides a
design fork. Confirmed against live `main`:

- `harness.controls.json` lists only **3 of 16** live drift checks as individual
  `check/` controls (`import-cycles`, `near-duplicates`, `orphan-files`). Missing:
  `knip-duplicates`, `layer-direction`, `module-doc-paths`, `commented-out-code`,
  `duplicate-types`, `duplicate-schemas`, `duplicate-literals`,
  `duplicate-constants`, `unused-exports` (the default checks `duplicates`,
  `ghost-files`, `comments`, `suppressions` are grouped under
  `drift-scope/{changed,current}`).
- `drift-scope/` entries are missing `coldspots` and the **9 prototype-lane
  subcommands** (`env-branches`, `coverage-evidence`, `coverage-unused-exports`,
  `clone-candidates`, `dolos-candidates`, `ownership`, `test-orphaning`,
  `birth-size-delta`, `class-construction`).
- `scripts/drift-ai/README.md` tables, by contrast, are already current — so the
  README half of task 51 is largely a no-op; the staleness is concentrated here in
  the manifest and (per the task) `docs/ai-harness.md`.

**Design fork to resolve before implementing:** do experimental, brand-firewalled
prototype-lane advisories belong in the *authoritative* harness inventory at all,
or do they go on a documented omit list until promoted? The promoted advisories
(`hotspots` already in; add `coldspots`) clearly belong. Recommend splitting this
task: (a) refresh manifest + generated controls + `docs/ai-harness.md` for the
stable check/subcommand surface, deciding the prototype omit-list policy; (b) add
the narrow parity guard. Keeping both in one commit produces a large,
judgment-laden manifest diff that the index's own "split before implementation"
guidance warns against.

## Done note (2026-06-05)

Resolved the design fork by keeping the authoritative harness inventory to the
stable drift surface:

- default drift checks stay grouped under `drift-scope/changed` and
  `drift-scope/current`;
- every opt-in drift check now has a dedicated `check/drift-ai-*` control;
- `coldspots` now has a promoted advisory `drift-scope/coldspots` control;
- prototype-lane advisory subcommands stay intentionally omitted until promoted.

Refreshed `docs/generated/harness-controls.md` with `bun run docs:harness-controls`
and updated `docs/ai-harness.md` so the opt-in checks name
`unused-exports`, duplicate-shape checks, `commented-out-code`,
`module-doc-paths`, and `coldspots`.

Added `scripts/drift-ai/harness-controls-parity.test.ts` as the narrow guard.
It fails when a live opt-in check lacks a dedicated manifest control, when the
default grouped-check set changes without a policy update, when `coldspots` or
another top-level drift subcommand listed there lacks a control, or when the
explicit prototype omit list drifts from the live prototype registry.

Focused verification:

- `bun run test scripts/drift-ai/harness-controls-parity.test.ts`
- `bun run docs:harness-controls:check`
