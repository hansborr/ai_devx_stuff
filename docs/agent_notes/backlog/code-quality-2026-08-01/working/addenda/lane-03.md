# Phase-1 hotspot addendum — lane 03 (server)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- `packages/server/src/{routers,services,utils,socket}` are the busiest
  application directories in the pinned range (`883d48bf..ebf0965`):
  routers 136 file touches, utils 109, services 66, socket 33. Weight them
  first.
- The triage reducer's three review-first **layer-direction rows all
  involve a utility test importing service-layer files** — the test itself
  is lane 06's, but check whether the production `utils/` ↔ `services/`
  boundary invites it.
- Clone evidence lands in `map-layer.ts`, `npc.ts`, spell-casting, the
  campaign-room handler, and character/participant/spell-slot mutation
  helpers.
- Longest hand-authored server files: `routers/srd.ts` 561 lines,
  `rest-service.ts` 458, `routers/homebrew.ts` 410,
  `participant-action.ts` 346, `broadcast-registry.ts` 341.
- History flags `utils/prisma-types.ts` and `routers/character-spell.ts`
  for fix/revert activity. Suppression-marker density is localized
  (intentional type tests, `trpc.ts`, SRD narrowing helpers) — not a broad
  smell.
- `packages/server/src/seed/` (esp. `class-features`, parsers,
  `seed/data`): Dolos-dominated (68 of 80 server-root endpoints; 38 of 40
  pairs ≥ 20-line fragments) but mostly structured feature-data repetition,
  cold and moderately churned. Lane 00 ranks it a **consistency sweep, not
  a refactoring priority** — sample it, judge pair *density* and
  representation choices, and do not burn depth on individual pairs.

Weighting: routers/services/utils/socket boundaries first, seed second,
everything else at normal weight.
