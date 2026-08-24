# Phase-1 hotspot addendum — lane 07 (docs-dx)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- Lane 00's engines produced **little direct signal for `docs/`** — the
  drift/clone/churn lenses barely touch prose. Your weighting therefore
  comes from the plan, not from metrics: most of `docs/` was **never read
  by the prior audit**, so empty-handedness there is suspect (see
  Calibration in the template).
- Use the hotspot map as a **drift target list**: the highest-churn areas
  (harness manifest + verify pipeline, server routers/utils, client sheet
  code, `scripts/tests/`) are where guides/MODULE.md files most likely
  drifted from code. Cross-check the guides covering those areas first.
- Coldspot lens flagged large stale-inside-active-neighborhood data files
  (3,636-line magic-item JSON, 932-line rules glossary) — relevant to you
  only where docs *reference* such assets; the assets themselves belong to
  lanes 03/04.
- Lane 00 found **zero stale TODO/FIXME markers** repo-wide — do not spend
  budget on marker archaeology.

Weighting: guide/MODULE.md accuracy against high-churn code first;
new-contributor entry path (`AGENTS.md`, READMEs, script surface as UX,
tsconfig/knip root configs) second; `.devcontainer/` + docker/SQL at
normal weight.
