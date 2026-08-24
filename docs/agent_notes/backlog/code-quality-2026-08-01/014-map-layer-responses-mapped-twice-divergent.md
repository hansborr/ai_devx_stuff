# 14. Map-layer rows are mapped to the wire contract twice, and the two mappers disagree on malformed-JSON handling

Status: Not started
Theme: duplicated Prisma read mappers · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The same `MapLayer` database row is converted to its response shape by two
independent, hand-maintained mappers. The map-detail path
(`packages/server/src/utils/map-helpers.ts`) has a private `mapLayer`; the layer
CRUD router (`packages/server/src/routers/map-layer.ts`) declares its own
`mapLayer` that maps the same seven fields again. Any change to the layer
contract must be repeated in both places, and they have already drifted in the
way duplicated mappers do:

- **Malformed-JSON handling diverges behaviorally.** The CRUD mapper validates
  the `data` column with `fromJsonValidated(..., layerDataSchema, {})`, so a
  row whose JSON no longer matches the record shape degrades to `{}`. The
  detail mapper uses unchecked `fromJson`, violating the documented
  read-boundary convention in `prisma-json.ts` ("use `fromJsonValidated`
  whenever a Zod schema can describe the JSON shape"). The malformed value then
  flows into the router's `.output(mapDetailSchema)` parse, where it fails —
  one bad layer row turns the *entire* map-detail response into an
  `INTERNAL_SERVER_ERROR`, while the same row served through the CRUD path
  degrades gracefully.
- **Timestamp representation diverges in code.** The detail mapper returns raw
  `Date` objects through `MapLayerResult` (`z.input` of `mapLayerSchema`); the
  CRUD mapper hand-rolls `.toISOString()` on both timestamps. The wire format
  still agrees — every router runs an `.output()` schema whose shared
  `dateTimeField` transform normalizes `Date` to ISO — so this half is dual
  maintenance and a misleading signal about where normalization happens, not a
  wire bug.

A contributor changing the layer shape has to find both mappers, notice the
different JSON and date treatments, and decide which one is "right" — with
nothing marking either as canonical.

## Evidence

- `packages/server/src/utils/map-helpers.ts:106-116` — private
  `mapLayer(l: MapLayerRow): MapLayerResult`; `data:
  fromJson<Record<string, unknown>>(l.data, {})` at `:111` (unchecked cast),
  raw `createdAt`/`updatedAt` `Date`s at `:113-114`. Consumed only by
  `mapMapDetail` at `:132`.
- `packages/server/src/routers/map-layer.ts:20-32` — the duplicate:
  `layerDataSchema = z.record(z.string(), z.unknown())` at `:20`, a second
  `mapLayer(layer: PrismaMapLayer): MapLayer` with
  `fromJsonValidated(layer.data, layerDataSchema, {})` at `:27` and
  `.toISOString()` on both timestamps at `:29-30`. Used at `:53` (create) and
  `:80` (update).
- `packages/server/src/utils/prisma-json.ts:8-16` — the documented rule of
  thumb the detail path violates: use `fromJsonValidated` whenever a Zod
  schema can describe the shape, "even if that shape is just
  `z.record(z.string(), z.unknown())`"; `fromJson` is reserved for genuinely
  opaque columns. `:70-77` — with a fallback, `fromJsonValidated` returns the
  fallback on parse failure, which is what makes the CRUD path degrade instead
  of throw.
- `packages/shared/src/schemas/map.ts:101-114` — `mapLayerSchema`; its own
  `data: z.record(z.string(), z.unknown())` at `:110` is a third statement of
  the layer-data shape, which the router-local `layerDataSchema` re-declares.
- `packages/server/src/utils/map-types.ts:81` —
  `type MapLayerResult = z.input<typeof mapLayerSchema>`, so a mapper
  returning `Date`s is already exactly what `.output(mapLayerSchema)`
  resolvers accept.
- `packages/shared/src/constants.ts:104-111` — `dateTimeField` accepts
  `string | Date` and transforms to ISO string; its JSDoc names it as the
  single place that resolves the ambiguity. `mapLayerSchema` uses it at
  `map.ts:112-113`, so the CRUD path's hand-rolled `.toISOString()` is
  redundant with the schema transform.
- `packages/server/src/routers/map.ts:28,50,82` — the detail paths all run
  `.output(mapDetailSchema)`, which is where unvalidated malformed `data`
  from `map-helpers.ts:111` fails the whole response.
- `packages/server/src/utils/map-helpers.test.ts:187` — existing case
  "coerces null layer data to an empty object": the *null* half of the
  degradation contract is already pinned; the malformed-shape half is not.

## Proposed direction

Deduplicate by promoting the existing mapper, not by creating a new module.
One commit, size XS-S.

1. **Export the existing `mapLayer` in place** in the "Mapping helpers"
   section of `packages/server/src/utils/map-helpers.ts:106`, and switch its
   `data` field from unchecked `fromJson` to
   `fromJsonValidated(l.data, mapLayerSchema.shape.data, {})` — reusing the
   shared schema's own field (`packages/shared/src/schemas/map.ts:110`)
   instead of re-declaring `z.record(z.string(), z.unknown())` server-side, so
   a future per-layer-type tightening of the shared schema tightens the DB
   read boundary and the wire contract in one edit. This also fixes the real
   behavioral divergence: today one malformed layer row fails the whole
   map-detail response at the router's `.output()` boundary, whereas the CRUD
   path degrades that layer's `data` to `{}`.
2. **Delete the router-local duplicate.** In
   `packages/server/src/routers/map-layer.ts`, remove `layerDataSchema` and
   `mapLayer` (`:20-32`), import the shared `mapLayer`, and drop the
   now-unused imports (`z`, `fromJsonValidated`, `PrismaMapLayer`, the
   `MapLayer` type). No casts needed: the shared mapper returns
   `MapLayerResult` (`z.input` of `mapLayerSchema`), exactly what resolvers
   behind `.output(mapLayerSchema)` accept, and Prisma rows are already
   structurally assignable to `MapLayerRow`.
3. **Leave timestamps as `Date` in the mapper.** Dropping the CRUD path's
   hand-rolled `.toISOString()` calls falls out of the deletion — the shared
   `dateTimeField` transform (`packages/shared/src/constants.ts:109`) is the
   documented single Date→ISO normalization point at every `.output()`
   boundary, so the wire contract is unchanged.
4. **Extend the existing `packages/server/src/utils/map-helpers.test.ts`**
   (no new test file) with contract-named cases: one malformed layer among
   good ones degrades to `{}` in `mapMapDetail` instead of failing the whole
   response; the exported `mapLayer` degrades malformed `data` to `{}` and
   passes valid records through; and `mapLayerSchema.parse(mapLayer(row))`
   round-trips a `Date` row to ISO strings, pinning the mapper-emits-input /
   schema-emits-output seam. Run with
   `bun run test -- packages/server/src/utils/map-helpers.test.ts`.

The commit body must name the intended behavior change — detail path:
whole-map `INTERNAL_SERVER_ERROR` → per-layer `{}` degradation on malformed
JSON — rather than presenting the change as a pure refactor.

## Scope / caveats

- **Binding rulings** from panel review:
  - Do **not** create a new focused mapping module for the `MapLayer` mapper;
    export the existing one from `map-helpers.ts`'s "Mapping helpers" section
    and delete the router-local duplicate.
  - Do **not** normalize timestamps (`toISOString`) inside the mapper or
    anywhere before the router boundary; return `Date` and let the shared
    `dateTimeField` transform at `.output()` remain the single Date→ISO
    normalization point.
  - Do **not** re-declare the layer-data record schema on the server side;
    validate the JSON read boundary with the shared schema's own field,
    `fromJsonValidated(l.data, mapLayerSchema.shape.data, {})`.
  - Do **not** present the map-detail behavior change as a pure refactor;
    state it in the commit body and pin it with tests added to the existing
    `map-helpers.test.ts`.
- **The mapper's `Date` output is deliberate — do not "fix" it by re-adding
  `toISOString`.** `dateTimeField` accepts both `string` and `Date` at every
  validated boundary. The one latent hazard is a future caller that consumes
  the mapper's output *without* passing through a Zod boundary and could leak
  `Date` objects; today that is theoretical — the only broadcast on this path,
  `broadcastMapLayerUpdate` (`packages/server/src/socket/map-broadcast.ts:28-35`),
  carries only `{ mapId, campaignId }`.
- Out of scope: any change to the shared `mapLayerSchema` shape, Prisma
  schema/migrations, socket payloads, or per-layer-type tightening of the
  `data` record — this leaf only makes such a tightening single-edit later.
- The `null`→`{}` coercion pinned at `map-helpers.test.ts:187` must stay
  green: `fromJsonValidated` with a fallback returns the fallback for
  null/undefined (`prisma-json.ts:70-73`), so the swap preserves it.
- Prior pack: `docs/agent_notes/backlog/code-quality-2026-07-25/01-prisma-boundary-type-erosion.md`
  (landed 2026-07-26) introduced the `MapLayerResult` schema-input typing this
  leaf relies on but never unified the two mappers; the 2026-07-25 pack's
  leaves 22 and 60 cover socket schema shapes and the write-side JSON guard,
  not read-mapper consolidation. No conflict — this leaf completes what leaf
  01 left split.
- Adjacent leaf, no strict ordering:
  [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md)
  sweeps the handwritten Prisma row-type shadows in
  `packages/server/src/utils/map-types.ts:16-95` — the `MapLayerRow` /
  `MapLayerResult` types this mapper consumes. Neither leaf edits the other's
  mapper code, but avoid working the two concurrently in
  `packages/server/src/utils/`; either order lands cleanly.
