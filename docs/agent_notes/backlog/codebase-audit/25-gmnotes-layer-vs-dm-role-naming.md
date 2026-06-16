# 25. Map 'gmNotes' layer type uses GM terminology while the rest of the app models the role as dm/isDm/DM

Status: Done — implemented 2026-06-14 (batch 5a). Clarifying comment added at `map-helpers.ts`; the `gmNotes`→`dmNotes` rename remains deferred to the next map-layer schema migration per the locked Decision.
Theme: naming consistency · Area: shared · Severity: low · Size: S

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: naming-consistency); evidence independently re-verified. · Confidence: high

## Decision (locked 2026-06-13)
**Do NOT spend a standalone Prisma enum migration on this. Add the clarifying comment now; defer the `gmNotes`→`dmNotes` rename until it can be batched into a real map-layer migration.** For a low-severity cosmetic item, a dedicated migration (a history entry forever, client regen, test churn across `map.test.ts`/`map-helpers.test.ts`/`map-inputs.test.ts`) is not justified in isolation. Land the one-line comment at `map-helpers.ts:147` now ("gmNotes = DM-only layer; GM and DM are the same role here"); carry the rename as a rider on the next map-layer schema change. (Dissent noted: "batch later" can become "never," and this sits in authz/visibility code — but the cost economics win for a low-sev item.)

## Problem
The game-runner role is modeled consistently as `dm` almost everywhere: the role enum is `z.enum(["dm", "player"])`, server auth/visibility code threads an `isDm` boolean, and the UI surfaces "DM only" / "DM Only" / `value="dmOnly"`. The lone exception is the map layer-type literal `gmNotes` (GM = Game Master), which is baked into the shared schema, the Prisma enum, the baseline migration SQL, and the DM-visibility filter. The most jarring artifact for a newcomer is `row.layers.filter((l) => isDm || l.type !== "gmNotes")` — `isDm` and `gmNotes` name the same role on a single line, forcing the reader to discover that "GM" and "DM" are the same concept here and to wonder whether `gmNotes` implies a third, separate role. That mismatch costs time-to-understanding and invites a wrong mental model precisely where authorization/visibility logic lives.

## Evidence
- `packages/shared/src/schemas/map.ts:43` — `export const MAP_LAYER_TYPES = ["fog", "drawing", "gmNotes"] as const;` — `gmNotes` is the lone "GM" token among the layer literals.
- `packages/shared/src/schemas/campaign.ts:9` — `export const campaignMemberRoleSchema = z.enum(["dm", "player"]);` — the canonical role vocabulary is `dm`, not `gm`.
- `packages/server/src/utils/map-helpers.ts:147` — `layers: row.layers.filter((l) => isDm || l.type !== "gmNotes").map(mapLayer)` — both spellings of the same role appear on one line (`isDm` and `gmNotes`).
- `packages/server/prisma/schema.prisma:186-189` — `enum MapLayerType { fog drawing gmNotes ... @@map("map_layer_type") }`; the enum value persists `gmNotes` in the DB, so any rename is a schema change.
- `packages/server/prisma/migrations/0001_baseline/migration.sql:62` — `CREATE TYPE "map_layer_type" AS ENUM ('fog', 'drawing', 'gmNotes');` — the value is in baseline SQL; renaming requires a new migration + data backfill, which bounds this at size S.
- Test/fixture fan-out confirming the rename surface: `packages/server/src/routers/map.test.ts:176,181,192`; `packages/server/src/utils/map-helpers.test.ts:104,123`; `packages/shared/src/schemas/map-inputs.test.ts:639` — each hardcodes the `"gmNotes"` string.
- Contrast (consistent `dm`/`DM` usage elsewhere): `packages/client/src/components/vtt/in-vtt-drawer.tsx:57` ("DM only"), `packages/client/src/components/campaign/notes/notes-panel.tsx:101` and `note-editor.tsx:93` (`<SelectItem value="dmOnly">DM Only</SelectItem>`), plus pervasive `isDm` parameters across `packages/server/src/services/**` (e.g. `spell-casting/types.ts:21,68`).

## Proposed direction
Rename the layer literal to align with the `dm` vocabulary (e.g. `dmNotes`) so the contract reads `["fog", "drawing", "dmNotes"]` and the filter becomes `isDm || l.type !== "dmNotes"`. Follow the package-flow order shared -> server -> client, and treat the Prisma enum as the gating step:

1. Shared first: change `MAP_LAYER_TYPES` in `packages/shared/src/schemas/map.ts:43`; `mapLayerTypeSchema`/`MapLayerType` derive automatically. Update the literal in `packages/shared/src/schemas/map-inputs.test.ts:639`.
2. Schema/migration: rename the value in `packages/server/prisma/schema.prisma:186-189` and author a migration following `docs/guides/add-prisma-migration.md` — this is a Postgres enum-value rename (`ALTER TYPE "map_layer_type" RENAME VALUE 'gmNotes' TO 'dmNotes'`) plus regenerated client; existing rows are migrated in place by the rename, so no row-by-row backfill is needed, but the migration must be explicit and committed (never `db:push`).
3. Server: update `packages/server/src/utils/map-helpers.ts:147` and the test literals in `map.test.ts` / `map-helpers.test.ts`. Re-read `packages/server/src/utils/` and any nearby `*-MODULE.md` for the maps/VTT area before editing the visibility helper.
4. TDD: the existing "filters gmNotes layers for players" tests (`map.test.ts:176`, `map-helpers.test.ts:119`) are the regression guard — rename them to `dmNotes` and confirm they still assert the player gets the layer filtered out; run via `bun run test -- packages/server/src/utils/map-helpers.test.ts`.
5. Client: no `gmNotes` literal exists in client `src` today (the layer type flows through shared schemas), so client changes should be limited to anything that surfaces the label to users — verify with `bun run code:intel -- refs` against `MapLayerType` before assuming none.

If the migration cost is judged not worth it, the cheaper alternative is a one-line code comment at `map-helpers.ts:147` noting "gmNotes = DM-only layer; GM and DM are the same role here" — but the rename is the durable fix.

## Scope / caveats
This is a naming-consistency finding, explicitly NOT a duplication or dead-code finding — `gmNotes` is live, referenced by the visibility filter and persisted by Prisma — so it does not overlap drift-ai-findings (which owns near-duplicate and dead/unused code). It is distinct from the lint-debt drains, dep bumps, UX/infra audits, and the useEffect/Storybook programs in the out-of-scope list. Do not touch the `dm`/`player` role enum itself or the `dmOnly` notes-visibility value (those are already correct); the only target is the single divergent layer literal and its persisted enum. Sequencing risk is concentrated in the Prisma enum rename: ship shared + schema/migration + server as one unit so the generated client and DB enum stay in lockstep, and ensure no in-flight serialized layer payloads carry the old string before deploying.
