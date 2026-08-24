# 229. Standardize dateTimeField-backed mapper result boundaries

Status: Not started
Theme: dateTimeField-backed mapper boundaries duplicate Date-to-ISO normalization · Area: cross-cutting · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

`dateTimeField` already defines the shared boundary between Prisma `Date`
values and wire-format strings: its input accepts either representation and
its output normalizes a `Date` with `toISOString()`. Server mapper families do
not use that boundary consistently. Some declare schema-input result types and
return Prisma dates unchanged, while others declare the schema's inferred
output type and repeat ISO conversion field by field.

The two live MapLayer paths demonstrate both conventions against the same
schema. Their wire output agrees only because output parsing ultimately applies
the shared transform. Across other domains, the output-typed convention spreads
serialization policy through mapper implementations, makes every timestamp
addition a coordinated schema-and-mapper edit, and obscures whether a mapper is
producing schema input or already-normalized wire output.

This cannot be fixed as a blind deletion of `toISOString()` calls. The same
search also finds pagination cursors, structured logging, exports, protocol
timestamps, and deliberately string-only schemas. Mapper consumers must also
be traced: some results reach tRPC output parsing, while chat and notification
results additionally pass through schema-validating socket boundaries.

## Evidence

- `packages/shared/src/constants.ts:104-111` — `dateTimeField` accepts
  `string | Date`, documents Prisma dates as an intended input, and performs
  the canonical `Date`-to-ISO transformation.
- `packages/shared/src/schemas/map.ts:101-116` — `mapLayerSchema` applies
  `dateTimeField` to both timestamps and exports its normalized output type as
  `MapLayer`.
- `packages/server/src/utils/map-types.ts:76-83` and
  `packages/server/src/utils/map-helpers.ts:106-115` — the map-detail path
  derives `MapLayerResult` with `z.input<typeof mapLayerSchema>` and returns
  raw `createdAt` and `updatedAt` dates.
- `packages/server/src/routers/map-layer.ts:20-32` — the duplicate CRUD mapper
  targets the schema output type and manually calls `toISOString()` for those
  same two fields.
- `packages/server/src/utils/character-mapping.ts:62-78,101-117,126-143` —
  `mapCharacterDetail` and `mapCharacterSummary` target inferred output types
  and repeat conversion for character timestamps and the nested level-choice
  `appliedAt`; the backing schemas use `dateTimeField` at
  `packages/shared/src/schemas/character.ts:67-82,238-244,261-300`.
- `packages/server/src/utils/encounter-query.ts:226-237,265-301` — the combat
  log, encounter-detail, and encounter-summary mappers likewise normalize
  their timestamps themselves; the corresponding schema fields use
  `dateTimeField` at
  `packages/shared/src/schemas/encounter.ts:76-85,132-147,187-195`.
- `packages/server/src/routers/campaign.ts:63-115` and
  `packages/server/src/routers/invite.ts:41-58` — campaign member, detail,
  summary, and invite mappers contain the same conversion policy even though
  their contracts use `dateTimeField` at
  `packages/shared/src/schemas/campaign.ts:16-53,80-103`.
- `packages/server/src/utils/chat-helpers.ts:9-24`,
  `packages/server/src/utils/notification-helpers.ts:29-39`, and
  `packages/server/src/socket/broadcast-registry.ts:129-153,234-267,296-337` — chat and
  notification mappers return output-typed values, while their socket registry
  entries already parse payloads through the shared schemas before emitting.
  Those schemas use `dateTimeField` at
  `packages/shared/src/schemas/chat-inputs.ts:52-67` and
  `packages/shared/src/schemas/notification.ts:59-70`.
- `packages/server/src/routers/monster.ts:38-102`,
  `packages/server/src/routers/npc.ts:30-56`,
  `packages/server/src/routers/note.ts:47-72`, and
  `packages/server/src/services/inventory-service.ts:65-106` — the remaining
  dateTimeField-backed mapper families manually normalize entity timestamps;
  their schema fields are at
  `packages/shared/src/schemas/monster.ts:135-218`,
  `packages/shared/src/schemas/npc.ts:9-26`,
  `packages/shared/src/schemas/note.ts:16-31`, and
  `packages/shared/src/schemas/inventory.ts:81-96`.
- `packages/shared/src/schemas/MODULE.md:204-215` — the homebrew collection,
  homebrew entry, and magic-item timestamps are deliberately bare strings, and
  the module documentation explicitly says their mapper conversions remain.
- `packages/server/src` — measured with
  `rg -n 'toISOString\(\)' packages/server/src --glob '!*.test.ts' --glob '!*.test.tsx' | wc -l`,
  which returned 45 matches; the corresponding file measurement
  `rg -l 'toISOString\(\)' packages/server/src --glob '!*.test.ts' --glob '!*.test.tsx' | wc -l`
  returned 18 files. This is an inventory bound, not a removal target.

## Proposed direction

Land the work as domain-bounded slices after first recording a complete mapper
census. The census must name the mapper, its concrete shared output schema,
every tRPC/service/socket consumer, whether that consumer parses the schema,
and the focused test that pins the boundary. At the audited pin it has three
buckets:

1. **Already on the intended convention:** `mapToken`, the map-detail
   `mapLayer`, `mapMapDetail`, and `mapMapSummary` in `utils/map-helpers.ts`,
   whose result aliases are the schema-input types in `utils/map-types.ts`.
   Use the consolidated MapLayer implementation from
   [014-map-layer-responses-mapped-twice-divergent.md](./014-map-layer-responses-mapped-twice-divergent.md)
   as the precedent; do not create another mapper abstraction here.
2. **Convert after tracing consumers:** `mapNotification`;
   `mapCharacterDetail` and `mapCharacterSummary`; `mapCombatLog`,
   `mapEncounterDetail`, and `mapEncounterSummary`; `mapChatMessage`;
   `mapInvite`; `mapMemberDetail`, `mapCampaignDetail`, and
   `mapCampaignSummary`; `mapMonster`; `mapNpc`; `mapNote`; and `mapItem`.
   Replace their output-typed result contracts with
   `z.input<typeof concreteSchema>` aliases, return Prisma `Date` values
   unchanged for dateTimeField-backed properties, and retain all unrelated
   enum, JSON, visibility, and nested-object normalization.
3. **Keep excluded:** chat, notification, and combat-log pagination cursors;
   script-log date normalization and log timestamps; the health protocol
   timestamp; the homebrew export timestamp; and the homebrew collection,
   homebrew entry, and magic-item mappers backed by deliberately bare-string
   schemas.

For each conversion slice, change the result type and date assignments
together, then follow every consumer to a real schema parse. tRPC procedures
should continue relying on their declared `.output(...)` schemas. For chat and
notification socket delivery, widen the internal pre-parse payload contract to
the schema input type while preserving the registry's existing
`schema.parse(payload)` boundary; emitted payloads remain schema outputs.
Do not permit a raw mapper result to bypass parsing merely to make its new type
compile.

Split implementation by cohesive domains rather than one repository-wide
commit: MapLayer precedent first; then campaign/invite, character,
encounter, inventory, and the smaller monster/NPC/note families; then
chat/notification with their socket-boundary type changes. Coordinate any
Prisma mapper-input edits with
[006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md)
so a domain does not churn row types and result types concurrently.

Add focused mapper contract cases in the existing domain suites. Each should
construct a row with fixed `Date` values, assert that the mapper result retains
those dates before parsing, and assert that the concrete shared schema parses
them to the expected ISO strings. Keep router/service tests for nested arrays
and nullable timestamps, and extend socket-registry coverage for the
chat/notification slices to prove emitted payloads remain normalized. Run only
the affected files with the existing `bun run test -- <file>` command as each
domain slice lands.

## Scope / caveats

- This is normalization-boundary work, not a demand to remove all 45 measured
  calls. Strict pagination cursors, logs, exports, health/protocol timestamps,
  and other timestamps created specifically for external protocols remain
  explicit strings.
- Do not change `dateTimeField`, loosen cursor validators, alter wire schemas,
  or change the serialized timestamp format. Mapper inputs may contain
  `Date`; every public output remains the existing ISO string.
- Do not touch `mapCollection`, `mapEntry`, or `mapMagicItem`, or change their
  deliberately bare-string homebrew/magic-item schemas. The homebrew export's
  `exportedAt` conversion is excluded independently.
- Sequence this work after
  [014-map-layer-responses-mapped-twice-divergent.md](./014-map-layer-responses-mapped-twice-divergent.md),
  which owns deletion of the duplicate MapLayer mapper and establishes the
  `z.input`/raw-`Date` convention. Coordinate overlapping mapper type edits
  with
  [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md).
- [code-quality-2026-07-25/26-shared-dead-and-vestigial.md](../code-quality-2026-07-25/26-shared-dead-and-vestigial.md)
  (CQ25-181) deliberately kept the three bare-string schemas and their mapper
  conversions, while leaving uniform normalization across existing
  dateTimeField-backed mapper boundaries unresolved. This leaf covers only
  that residual.
- Preserve non-date mapper behavior and existing parse locations. In
  particular, JSON fallback policy, enum normalization, player/DM filtering,
  and socket routing are not refactor targets.
- The census and consumer tracing are required before edits because a
  schema-input result is safe only when every public path reaches a schema
  parse. A mapper with an unparsed external-protocol consumer stays excluded
  until that boundary is made explicit within the same domain slice.
