# UX Audit 2026-06 P0 pack — closed (2026-06-21)

The three P0 "fix before any real multiplayer session" blockers from the
2026-06-06 live-play audit are all **shipped** (verified against `main`
2026-06-21):

- **01 — wizard spell-selection step** for caster classes: implemented.
- **02 — turn/round pointer live-sync** to all clients: implemented.
- **03 — attributed HP mutations** surface in the encounter combat log:
  implemented.

## Deferred (not a code task)

- **04 — dev-DB fixture cleanup**: a one-time manual local-DB reseed + live
  smoke check once the audit repro fixtures are no longer needed. No source
  edit / test / version-controlled artifact, so it is not autonomous-agent
  work — do it by hand when convenient (`bun run --filter @musi/server db:reset`
  then `db:seed`, then a quick browser smoke).

The pack folder (`docs/agent_notes/backlog/ux-audit-2026-06-p0/`) was removed;
leaf text and the full audit (`docs/agent_notes/ux-audit-2026-06-06.md`, retained)
remain the source of record. The wider P1/P2/P3 audit items stay in that audit
doc.
