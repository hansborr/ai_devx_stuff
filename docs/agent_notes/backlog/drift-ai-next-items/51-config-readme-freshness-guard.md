# 51 - config-example and README registry freshness guard

Status: Done
Track: G
Size: small
Depends on: none
Blocks: none

## Goal

Add a guard that keeps `drift-ai.config.example.json` and the
`scripts/drift-ai/README.md` check/subcommand lists and key backlog links in sync
with the live drift surface, so adding a check id cannot silently leave
operator-facing docs stale.

## Background

Several tasks (20, 22, 30, 31) add check ids and each edits the example config and
README by hand. Metadata-vs-runtime registry parity is already guarded
(`check-metadata.test.ts`), but the operator-facing example config and README
enumeration are not, so they drift the same way task 50 addresses for tests.

During the 2026-06-02 inventory review, the README still pointed at the empty
older `docs/agent_notes/backlog/drift-ai-tasks/` folder. The guard should catch
that class of stale internal link too.

## Seams to touch

- `scripts/drift-ai/check-metadata.ts` as the id/default-config source of truth
- `drift-ai.config.example.json`
- `scripts/drift-ai/README.md`
- a focused parity test beside the registry, or a tiny comparison script

## What to do

1. Treat the metadata registry id/default set as the source of truth for known
   check ids and default config shapes.
2. Add a parity test asserting that:
   - the example config carries no unknown check ids;
   - the example config's check-id set matches an explicit "starter example"
     allowlist (initially the intentionally documented starter knobs), so adding a
     new configurable check forces a conscious add-or-omit decision without turning
     the example into an exhaustive generated defaults dump;
   - the README check-id enumeration matches the registry id set;
   - the README subcommand enumeration matches the live subcommands, or an
     explicit omit list;
   - important internal backlog links in the README resolve to non-empty targets
     or are updated to the current queue.
3. Keep it test/report-only; do not auto-rewrite the docs or config.
4. Put the test in the existing drift-ai test family so it runs with the suite.

## Testing

- The parity test, plus deliberately stale fixtures proving it fails when an id,
  subcommand, or tracked README link is missing/stale.

## Out of scope

- Auto-generating the README or example config.
- Broadening to non-drift docs.
- Changing config schema or defaults.

## Done note (2026-06-04)

Implemented as `scripts/drift-ai/readme-config-parity.test.ts`, beside the registry
in the drift-ai test family. The guard asserts:

- the example config (`drift-ai.config.example.json`) carries no unknown check ids;
- the example config's `checks` key set matches an explicit starter-example
  allowlist, and every live check id is classified into exactly one of
  `STARTER_EXAMPLE_CHECK_IDS` / `OMITTED_FROM_EXAMPLE_CHECK_IDS` (a new registry id
  forces a conscious add-or-omit decision, never an exhaustive defaults dump);
- the README "Implemented checks" table id set equals the live `ALL_CHECKS`;
- the README "Subcommands" table set equals the live subcommands
  (`runner.ts` top-level + `PROTOTYPE_SUBCOMMAND_IDS`) minus an explicit (empty)
  omit list;
- every README backlog link resolves to a non-empty file.

Deliberately-stale fixtures prove each assertion fails on drift (unknown id, README
table missing a registry id, README listing an unknown subcommand, and a dead
backlog link).

Found and fixed two real stale links: the README pointed at the removed
`docs/agent_notes/backlog/drift-ai-tasks/` folder in two places (the `--repo`
deferral section and the maintainer-backlog pointer). Both now point at the live
`drift-ai-next-items/` queue. Exported `PROTOTYPE_SUBCOMMAND_IDS` from
`prototype-subcommands.ts` so the subcommand half derives from the real registry
instead of a hand-copied list.

The README check/subcommand *tables* were already current (matching the task-52
triage note); the guard's value is preventing future drift, plus catching the dead
backlog links. Task 52 still owns the broader `harness.controls.json` /
`docs/ai-harness.md` inventory parity.
