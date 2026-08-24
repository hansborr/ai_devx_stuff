# Phase-1 hotspot addendum — lane 04 (shared)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- `packages/shared/src/rules/` — 55 pinned-range file touches.
  `spellcasting.ts` is 380 lines **with a surfaced 22-line same-file
  clone**; `srd-weapons.ts` 327; `character-rules.ts` 260. Seventy
  repeated-literal groups touch the directory. This ranking comes from
  size, rule criticality, churn, and focused drift rows — not clone
  volume — so read the rule modules closely rather than diffing pairs.
- `packages/shared/src/schemas/` — 57 pinned-range touches, 65 triage-queue
  location appearances, 133 literal groups. Longest files: `srd.ts` 411,
  `homebrew.ts` 363, `spell.ts` 347, `encounter-inputs.ts` 329.
- All 80 endpoints in the shared-root Dolos top 40 are schema files, but
  much of that is **expected Zod shape boilerplate**. Use clone evidence
  only to separate unexplained behavioral helpers from declarative schema
  repetition; the actionable signal in `schemas/` is size and change
  density (organization, naming, file-splitting), not raw duplication.
- Schema test sizes (pointer material for lane 06): `homebrew.test.ts`
  1,228 lines, `encounter-inputs.test.ts` 1,030.

Weighting: rules first, schemas second, the rest of the package at normal
weight.
