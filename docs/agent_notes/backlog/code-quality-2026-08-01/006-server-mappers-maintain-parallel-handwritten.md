# 6. Server mappers hand-transcribe 14 Prisma payload shapes that the package's own `GetPayload` convention already derives for free

Status: Not started
Theme: Prisma payload derivation · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

Three server mapping modules — `utils/encounter-query.ts`,
`utils/homebrew-helpers.ts`, and `utils/map-types.ts` — maintain 14 handwritten
row/selection shapes that manually transcribe Prisma columns field by field,
while the file sitting next to them, `utils/character-mapping.ts`, demonstrates
the repo's lower-drift convention: declare the include/select as a named
`as const` constant and derive the exact row type with `Prisma.*GetPayload`.
That convention is not exotic here — it is already the dominant pattern in
`rest-character-mapping.ts`, `chat-helpers.ts`, and the `srd`, `campaign`,
`monster`, and `magic-item` routers. The three flagged files are the outliers.

The cost is twofold. First, every schema or query change requires synchronized
edits: the include/select constant and the structurally-independent row
interface must be updated in lockstep, and nothing checks that they agree.
Second, the handwritten copies silently lose information — `CollectionRow` and
`EntryRow` widen the `visibility` and `type` enum columns to plain `string`
even though Prisma generates real enum unions for them, so the compiler forgets
what the database guarantees. This is the same erosion mechanism a previous
cleanup already had to repair once in these very interfaces (enum columns
widened to `string`, bought back with marked casts at the use sites); the
handwritten shapes are the machinery that keeps regenerating that class of
drift. Because the shadows are permissive structural types, a query that omits
a relation or narrows a field still satisfies them, so relation-shape
differences surface at runtime (or never) instead of at typecheck.

## Evidence

- `packages/server/src/utils/encounter-query.ts:44-113` — four handwritten row
  interfaces: `EncounterRow` (:44-54), `CharacterStatsRow` (:56-64),
  `ParticipantRow` (:66-101, ~23 hand-listed scalar columns), `CombatLogRow`
  (:103-113).
- `packages/server/src/utils/encounter-query.ts:127-138` —
  `PARTICIPANT_INCLUDE` and `ENCOUNTER_DETAIL_INCLUDE` maintained separately
  from those interfaces; a relation change means editing constant and interface
  in sync with no compiler tie between them.
- `packages/server/src/utils/homebrew-helpers.ts:25-45` and `:87-94` — four
  handwritten shapes: `CollectionRow`, `EntryRow`, `OwnedCollectionRow`,
  `OwnedEntryRow`. `OwnedCollectionRow` mirrors the two-field `select` at
  `:103` by hand.
- `packages/server/src/utils/homebrew-helpers.ts:30,39` — `visibility: string`
  and `type: string`, though the columns are Prisma enums
  (`packages/server/prisma/schema.prisma:1437`, `:1452`; enum declarations at
  `:296`, `:304`) with generated unions at
  `packages/server/src/generated/prisma/enums.ts:322-343`. The handwritten
  shapes throw the generated narrowing away.
- `packages/server/src/utils/map-types.ts:16-74` and `:89-95` — six handwritten
  shapes: `MapTokenCharacterData`, `MapTokenRow`, `MapLayerRow`, `MapRow`,
  `MapSummaryRow`, `MapWithContext`. Total: 4 + 4 + 6 = 14 handwritten
  row/selection shapes across the three files.
- `packages/server/src/utils/map-types.ts:80-83` — the contrast inside the same
  file: `MapTokenResult` etc. are already *derived* (`z.input` of shared
  schemas), so the file's result half has no drift problem while its row half
  does.
- `packages/server/src/utils/character-mapping.ts:10-27` — the in-package
  counter-convention: `CHARACTER_INCLUDE` as a named `as const` constant and
  `CharacterWithRelations = Prisma.CharacterGetPayload<{ include: typeof CHARACTER_INCLUDE }>`.
- Convention breadth elsewhere in the package:
  `services/rest-character-mapping.ts:4`, `utils/chat-helpers.ts:9`,
  `routers/srd.ts:111,140,153,174,195,212,225`, `routers/campaign.ts:59,98`,
  `routers/monster.ts:38`, `routers/magic-item.ts:62` — all
  `Prisma.*GetPayload` over named select/include constants.
- The one deliberate multi-projection seam: `mapParticipant`
  (`encounter-query.ts:205`) consumes rows loaded under at least three distinct
  include shapes — `PARTICIPANT_INCLUDE` (:127-130), combat-actions
  `ATTACKER_INCLUDE`/`TARGET_INCLUDE`
  (`services/combat-actions/load-participants.ts:12,22`), and spell-casting
  `CASTER_INCLUDE`/`SPELL_TARGET_INCLUDE`
  (`services/spell-casting/load-participants.ts:10,22`). `ParticipantRow`'s
  optional `mapToken?`/`character?` (:99-100) exist for exactly this, and the
  comment at `:93-98` documents the fail-closed `null` projection for non-DM
  viewers.
- `packages/server/src/utils/map-helpers.ts:161,186` — the update-builder key
  lists are already `as const satisfies readonly (keyof Prisma.MapUpdateInput)[]`
  / `(keyof Prisma.MapTokenUpdateInput)[]`, showing the write-side shapes in
  `map-types.ts:101-128` are compiler-tied and not part of this problem.

## Proposed direction

Derive exact payloads with `Prisma.*GetPayload` over named,
`satisfies`-constrained include/select constants, keeping structural inputs
only where a mapper intentionally accepts multiple projections. This converges
the three outlier files on the pattern `character-mapping.ts` and the routers
already use, and serves the repo's one-derivation-pattern copyability goal.
`satisfies` on the constants (e.g.
`as const satisfies Prisma.EncounterParticipantInclude` — the generated
`*Include`/`*Select`/`*DefaultArgs` types exist for every model) is compatible
with the as-const/type-assertion policy in AGENTS.md. One commit per file:

1. **`homebrew-helpers.ts`** — replace `CollectionRow`, `EntryRow`,
   `OwnedCollectionRow`, `OwnedEntryRow` with `GetPayload` derivations over
   named constants matching the call sites' actual include/select (e.g. the
   `{ id: true, authorId: true }` select at `:103`). Note the enum effect:
   under `GetPayload`, `visibility`/`type` narrow from `string` to the
   generated Prisma enum unions — the values are identical to the shared zod
   vocabulary (`packages/shared/src/schemas/homebrew.ts:57,61` vs
   `schema.prisma:296-315`), so the `homebrewVisibilitySchema.parse` /
   `homebrewEntryTypeSchema.parse` calls at `:57`/`:68` keep compiling and stay
   in place as the boundary into the shared vocabulary. No semantic change.
2. **`map-types.ts`** — derive `MapTokenRow`, `MapLayerRow`, `MapRow`,
   `MapSummaryRow`, and `MapWithContext` from `GetPayload` over named
   include/select constants co-located with the types (mirroring
   `encounter-query.ts`'s constant-beside-mapper layout);
   `MapTokenCharacterData` becomes the derived relation shape rather than a
   separate handwritten interface. Leave the `z.input`-derived Result aliases
   at `:80-83` untouched — they are already derived.
3. **`encounter-query.ts`** — derive `EncounterRow`, `CombatLogRow`, and
   `CharacterStatsRow` from `GetPayload`/`DefaultArgs`. `ParticipantRow` is the
   deliberate exception: keep it a documented seam — a `GetPayload`-derived
   base scalar payload intersected with the *optional* `mapToken?`/`character?`
   relations — not a single strict `GetPayload` parameter, because
   `mapParticipant` genuinely accepts three different projections (evidence
   above). Keep the comment at `:93-98` verbatim.

Expected test friction, planned for rather than fought: the suites that
hand-construct these rows (`utils/encounter-query.test.ts` — 9 textual `ParticipantRow`
occurrences, `utils/homebrew-helpers.test.ts`, `utils/map-helpers.test.ts`,
`routers/seed-read-normalization.test.ts`, `services/character-delete.test.ts`)
will need full scalar field sets or small row-builder helpers once the types
are exact. Test files are exempt from cast markers. Run the focused suites per
commit, e.g. `bun run test -- packages/server/src/utils/encounter-query.test.ts`.

## Scope / caveats

- **Binding constraint carried from the landed prior pack:**
  `ParticipantRow.mapToken?`/`.character?` must stay optional. The 2026-07-25
  pack's leaf 01 (`../code-quality-2026-07-25/01-prisma-boundary-type-erosion.md`,
  Done 2026-07-26, merge `028a21d5`) ruled that a straight
  `Prisma.EncounterParticipantGetPayload` swap cannot express the
  summary-vs-detail dual projection with fail-closed `null` for non-DM viewers.
  Step 3's base-payload-plus-optional-relations shape is the compliant form; a
  wholesale strict swap of `ParticipantRow` is out of scope.
- **This is open work, not a relitigation.** Prior leaf 01 fixed the enum
  widening and the map-types Result duplication but kept the handwritten row
  interfaces as a matter of step scoping — its own step 1 offered
  `Prisma.EncounterGetPayload<…>["state"]` derivation as an acceptable
  mechanism, and the prior pack's CONSTRAINTS.md ledger records no ruling
  against `GetPayload`-derived row types. The homebrew row shapes were never
  ruled on by any prior leaf.
- **Do not touch `routers/srd.ts`.** The prior pack's leaf 46 (S19) carries a
  rename-only guard: do not restructure the `Prisma.*GetPayload` row types or
  the `narrow*EnumColumns` helpers there. Adjacent, not conflicting — srd.ts is
  already on the target convention.
- **Out of scope in `map-types.ts`:** `MapUpdateFields`, `TokenUpdateFields`,
  `TokenBoundsCheck` (:101-128). They are update-builder/validation shapes, not
  payload shadows, and their key lists are already
  `keyof Prisma.*UpdateInput`-constrained via `satisfies` in
  `map-helpers.ts:161,186`. The derivable set is the 14 read-side shapes only.
- **Mappers keep their runtime zod parses.** `conditions`/`data`/`rolls` JSON
  columns keep `fromJson`/`fromJsonValidated`, and the homebrew enum parses
  stay (step 1). This leaf changes compile-time derivation, not runtime
  validation or output shapes.
- **Sibling leaf, different mechanics:**
  [005-spell-participant-loading-discards-prisma.md](./005-spell-participant-loading-discards-prisma.md)
  covers the spell-casting-specific payload discard around
  `services/spell-casting/load-participants.ts`. No ordering dependency, but
  the two edit the same `mapParticipant` caller surface — do not work them
  concurrently, and whichever lands second re-checks the `ParticipantRow` seam
  still admits spell-casting's includes.
- `encounter-query.ts` also hosts race-adjacent read contracts
  (`PARTICIPANT_ORDER`'s tie-break invariant at `:115-125`); this leaf is
  type-only there, but keep that comment and ordering untouched.
