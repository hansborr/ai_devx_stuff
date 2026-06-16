# Reseed The Dev DB Once The Audit Fixtures Are No Longer Needed

Status: Parked
Order: 04
Source: audit residue note
(`docs/agent_notes/ux-audit-2026-06-06.md:275-278`). Terminal — requires
leaves 01-03 Done.

## Context

The live-play audit left its session fixtures in the dev DB: campaign
"The Sunken Crypt of Velgaroth", the encounter "The Flooded Entry Hall",
and both PCs ("Strider", "Mithrandir"). The audit kept them deliberately
as the repro environment for the P0/P1 findings, with the cleanup path
documented: reseed with `bun run --filter @musi/server db:seed`.

## Scope

- Confirm leaves 01-03 are Done and none of their Notes claim an open
  repro need; the P1 items still live in the audit doc, so check whether
  a P1 leaf has since been promoted in this pack and still needs the
  fixtures — if so, mark this leaf Blocked with that reason instead of
  proceeding.
- Reseed the local dev DB (`db:seed`; use `db:reset` only if seed alone
  does not restore a clean baseline — both are local-only utilities).
- Spot-check that the audit campaign is gone and the seeded baseline
  works (login, open a campaign, open a character).

## Definition Of Done

The dev DB contains only seeded baseline data, and this pack's earlier
leaves record any repro evidence they needed before the wipe.

## Verification

- App smoke check against the reseeded DB (`bash scripts/dev.sh` or the
  documented dev stack path).
- `bash scripts/db-status.sh` (or `bun scripts/db-status.ts`) reports the
  expected state.
