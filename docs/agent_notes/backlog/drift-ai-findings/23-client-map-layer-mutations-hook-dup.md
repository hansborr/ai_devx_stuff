# 23. useFogMutations and useDrawingMutations are the same map-layer mutation hook (differ only in toast strings)

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-med · Size: S
Source: drift:ai near-duplicates + clone-candidates (drift-baseline, same pair — merged) · Confidence: med

## Problem
`useFogMutations` and `useDrawingMutations` are the same map-layer mutation hook copied across two files. Both:
- call `useTRPC()` + `useQueryInvalidation()`, then memoize `invalidate = useCallback(() => invalidateMapDetail(mapId), [invalidateMapDetail, mapId])`;
- wire `trpc.mapLayer.create.mutationOptions({ onSuccess: invalidate, onError: toast.error(...) })` and `trpc.mapLayer.update.mutationOptions({ onSuccess: invalidate, onError: toast.error(...) })`;
- return `{ createLayer, updateLayer }`.

They diverge ONLY in four toast strings: `"Failed to create fog layer"` / `"Failed to update fog"` vs `"Failed to create drawing layer"` / `"Failed to update drawing"`. This is shared behavioral logic — the mutation contract and cache-invalidation wiring — not just presentation, so a divergence bug (e.g. someone fixes invalidation in one copy only) is a live risk.

The adjacent `getFogLayer` / `getDrawingLayer` helpers are also near-identical: both `map.layers.find((l) => l.type === <literal>)`, `<schema>.safeParse(layer.data)`, return `{ id, data } | null`. They differ only in the type literal (`"fog"` / `"drawing"`) and the schema (`fogLayerDataSchema` / `drawingLayerDataSchema`).

All four symbols (`useFogMutations`, `useDrawingMutations`, `getFogLayer`, `getDrawingLayer`) are file-private — only `useFogActions` / `useDrawingActions` are exported and consumed (in `map-detail-content.tsx`, `combat-map-content.tsx`), so extraction is internal and touches no call sites. The surrounding reveal/hide (fog) vs shape/erase (drawing) action logic legitimately differs and should stay separate.

## Evidence
- `packages/client/src/components/campaign/maps/map-fog-actions.ts:20-48` — `useFogMutations` (create/update wiring + memoized invalidate).
- `packages/client/src/components/campaign/maps/map-fog-actions.ts:50-56` — `getFogLayer` (find `"fog"` layer, `fogLayerDataSchema.safeParse`).
- `packages/client/src/hooks/use-drawing-actions.ts:21-52` — `useDrawingMutations`, identical wiring, only toast strings differ.
- `packages/client/src/hooks/use-drawing-actions.ts:58-64` — `getDrawingLayer`, mirrors `getFogLayer` (`"drawing"` + `drawingLayerDataSchema`).
- `packages/shared/src/schemas/map.ts:100` — `mapLayer.data` is `z.record(z.string(), z.unknown())`, so a generic `safeParse(layer.data)` over any `z.ZodType` is well-typed.
- `packages/shared/src/schemas/map.ts:45,94,114` — `mapLayerTypeSchema = z.enum(MAP_LAYER_TYPES)` includes both `"fog"` and `"drawing"`; `layers: z.array(mapLayerSchema)`.
- Consumers (unchanged by this refactor): `map-detail-content.tsx`, `combat-map-content.tsx` import only `useFogActions` / `useDrawingActions`.
- No existing unit tests for either hook (no `*drawing*.test.*` in `hooks/`, no test references `useFogActions`/`useDrawingActions`).

## Proposed fix
1. Add a shared module, e.g. `packages/client/src/hooks/use-map-layer-mutations.ts` (or under `components/campaign/maps/`), exporting:
   - `useMapLayerMutations(mapId: string, labels: { createError: string; updateError: string })` returning `{ createLayer, updateLayer }` — the exact current wiring with toast strings parameterized.
   - `getLayerOfType<T>(map: MapDetail, type: MapLayerType, schema: z.ZodType<T>): { id: string; data: T } | null` — generic version of the two helpers.
2. Replace `useFogMutations` in `map-fog-actions.ts` with `useMapLayerMutations(mapId, { createError: "Failed to create fog layer", updateError: "Failed to update fog" })`, and `getFogLayer` with `getLayerOfType(map, "fog", fogLayerDataSchema)`.
3. Replace `useDrawingMutations` in `use-drawing-actions.ts` with `useMapLayerMutations(mapId, { createError: "Failed to create drawing layer", updateError: "Failed to update drawing" })`, and `getDrawingLayer` with `getLayerOfType(map, "drawing", drawingLayerDataSchema)`.
4. Per the repo TDD norm, add a focused unit test for the new module: assert `getLayerOfType` returns parsed `{ id, data }` for a matching layer, `null` when the layer is absent, and `null` when `safeParse` fails on malformed `data`. Optionally a hook test asserting the parameterized toast string fires on `onError`. Keep the existing fog/drawing action hook behavior unchanged (no consumer edits).

## Verification / caveats
- False-positive risk: low. The two hooks are confirmed byte-identical modulo toast strings; the helpers differ only in the discriminating literal/schema.
- Scope boundary: do NOT merge `useFogActions` / `useDrawingActions` themselves — their action handlers (reveal/hide region math vs add/erase shape) genuinely differ. Only the mutations hook and the layer-lookup helper are duplicated.
- Confirm the new `getLayerOfType` generic preserves the current narrowing: `data: z.record(z.string(), z.unknown())` means `safeParse` input is `unknown`-ish, so type the param as `z.ZodType<T>` (not `z.ZodSchema` with a default) to keep `parsed.data` strongly typed.
- Decide module placement: `map-fog-actions.ts` lives under `components/campaign/maps/` while `use-drawing-actions.ts` lives under `hooks/`. A shared hook belongs in `hooks/` (check for a `hooks/MODULE.md` and add the new export there). This is a pure internal dedup — `verify:changed` (lint/typecheck/test) should fully cover it.
