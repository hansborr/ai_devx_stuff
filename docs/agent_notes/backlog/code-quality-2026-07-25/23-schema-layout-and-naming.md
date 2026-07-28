# 23. The shared schemas directory has documented conventions that its own files break — a misplaced entity, undocumented inline inputs, and ten domain-less list/search output-schema exports

Status: **Done 2026-07-27** in
[SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md) slices **S1, S2 and S3**,
merge `75bad57dc`; see [Landed](./00-index.md#landed). The plan superseded,
shrunk (M→S) and re-framed this leaf; read its outcome rather than the
`## Proposed direction` below. The re-framing is the point: the naming was
already disciplined — 124 `*InputSchema` exports each paired with an inferred
`*Input` type — so this was not a naming problem. The real finding was that
`packages/shared/src/schemas/MODULE.md`, the only navigational aid a barrel-less
contract layer has, made false claims about its own files. **Dropped: step 4.**
**Resolved by documenting rather than extracting: steps 2 and 3** — `spell.ts`
and `auth.ts` remain intentional inputs-holding entity files the way `srd.ts`
already is; do not extract `spell-inputs.ts`, `auth-inputs.ts` or
`srd-inputs.ts`. S1 also absorbed leaf 22 step 2 and leaf 26 step 6.
Theme: Contract-layer navigability · Area: shared · Severity: low · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`packages/shared/src/schemas/MODULE.md` states the directory's rules plainly: file role
is signalled by suffix (`<name>-inputs.ts` for tRPC request payloads and their
request-side outputs, `<name>.ts` for entity schemas), there is deliberately no barrel
so consumers reach in by deep specifier, and enum validators are named
`<thing>NameSchema`. Because there is no barrel, *knowing which file holds a symbol is
the whole game* — the doc says so. A few files break those rules; the module doc is
actively wrong about two of them (`weapon-mastery-inputs.ts`, `invite.ts`) and silent
about two more (`spell.ts`, `auth.ts`), so the one navigational aid the layer has is
partly wrong. Note that `srd.ts`, which also holds router inputs, is *not* in that set —
the doc records that placement deliberately and repeatedly.

The concrete symptoms share one cause — conventions enforced by nothing but prose:

- An entity schema lives in an `-inputs` file. `characterWeaponMasterySchema` is
  defined in `weapon-mastery-inputs.ts` under a literal `// Entity schema` banner, and
  `character.ts` — an entity file — imports its entity *from* the inputs file. There is
  no `weapon-mastery.ts`.
- The mirror case: the doc's "entity-only files" list includes a file with no entity in
  it. `invite.ts` holds only `listOutputSchema` and `invitePreviewSchema` and imports
  `campaignInviteSchema` from `campaign.ts`, yet `MODULE.md:66-68` files it under
  "Entity-only files with no `-inputs.ts` partner".
- Router `.input(...)` schemas live in entity files *without the module doc saying so*.
  `spell.ts` and `auth.ts` declare ten `*InputSchema`s inline, while trivial partners
  like `health-inputs.ts` (five lines, one schema) exist for far less. `srd.ts` declares
  four more, but those are **not** a convention breach: `MODULE.md:86-89` assigns "the
  SRD router input/output schemas" to `srd.ts` explicitly, and the quick-map table at
  `:110` repeats it (`SRD | (inputs in srd.ts)`). Only `spell.ts` and `auth.ts` are
  undocumented exceptions.
- A codemod mints the same generic name in every domain. Ten schema modules export a
  bare `listOutputSchema`/`searchOutputSchema` (eight of the former, two of the latter)
  with no domain qualifier, so grep, `code:intel` and IDE symbol search return ten
  indistinguishable hits across the contract layer.
- Two unrelated symbols are both called "condition schema": an SRD reference *row* and
  a closed *name enum* — despite the sibling damage-type pair getting the naming right.
- `characterSummarySchema` hand-copies nine fields from `characterSchema` and has
  already drifted: the copies dropped the `MIN_LEVEL`/`MAX_LEVEL` bounds.

None of this breaks at runtime. The cost is entirely paid by the next maintainer
hunting a symbol, and by the drift that hand-copied shapes accumulate.

## Evidence

- `packages/shared/src/schemas/weapon-mastery-inputs.ts:7` — `// Entity schema` banner;
  `:10` `weaponMasteryPropertySchema`, `:12-18` `characterWeaponMasterySchema`, `:20`
  its inferred type. `packages/shared/src/schemas/character.ts:13` imports the entity
  from this `-inputs` file.
- `packages/shared/src/schemas/weapon-mastery-inputs.ts:26` —
  `const MAX_MASTERY_SLOTS = 3; // Fighter gets 3`, duplicating
  `packages/shared/src/rules/weapon-mastery.ts:94` (`"class-fighter": 3` inside the
  module-private `MASTERY_SLOTS` record at `:92-99`).
- `packages/shared/src/schemas/invite.ts` — 20 lines total: `listOutputSchema` at `:5`,
  `ListOutput` at `:7`, `invitePreviewSchema` at `:14-18`, `InvitePreview` at `:20`, and
  the only entity it names (`campaignInviteSchema`, `:3`) is imported from
  `campaign.ts`. `MODULE.md:66-68` nonetheless lists `invite.ts` among the entity-only
  files.
- `packages/shared/src/schemas/spell.ts:271-273` — a "Query input schemas" section
  header inside an entity file; `:275-326` define `listSpellsInputSchema`,
  `addCharacterSpellInputSchema`, `removeCharacterSpellInputSchema`,
  `toggleSpellPreparedInputSchema`, `listCharacterSpellsInputSchema`. There is no
  `spell-inputs.ts`.
- `packages/shared/src/schemas/auth.ts:8,:25,:82,:94,:106` — the other five undocumented
  inline inputs (`registerInputSchema`, `loginInputSchema`, `updateProfileInputSchema`,
  `changePasswordInputSchema`, `deleteAccountInputSchema`). Measured directory ratio: 20
  `*-inputs.ts` files to 21 non-input schema files, with exactly three non-input files
  declaring inputs inline — but one of those three (`srd.ts:324,:332,:342,:350`) is
  documented design, not drift.
- `packages/shared/src/schemas/MODULE.md:86-89` — "**`srd.ts`** — the larger composed
  SRD model … **plus the SRD router input/output schemas** (`srdGetByIdInputSchema`,
  `listConditionsOutputSchema`, …)"; `:95` "the composed entity model and the SRD-router
  contract live in `srd.ts`"; `:110` the quick-map row `SRD | (inputs in srd.ts)`. Three
  independent statements of the same deliberate placement. By contrast `:53-56` describes
  `spell.ts` only as the home of the spell *entity*, and `:66-68` lists `auth.ts` and
  `spell.ts` as "entity-only files" — neither mentions that they own router inputs.
- `packages/shared/src/schemas/health-inputs.ts` — five lines, one `echoInputSchema`,
  showing how low the bar for a separate inputs file already is.
- Eight identical `export const listOutputSchema` + `export type ListOutput` pairs:
  `campaign.ts:162`, `character.ts:337`, `encounter.ts:195`, `invite.ts:5`,
  `map.ts:142`, `npc.ts:35`, `spell.ts:330`, `weapon-mastery-inputs.ts:45`. Plus two
  `searchOutputSchema`/`SearchOutput` pairs: `magic-item.ts:93`, `monster.ts:249`. No
  file outside `schemas/` references the `ListOutput`/`SearchOutput` type aliases.
- `scripts/codemods/trpc-shared-output-candidates.ts:86,:91` — derives the name from
  `procedureNameForSchemaCall(outputCall)` and appends `OUTPUT_SCHEMA_SUFFIX`, which is
  why every `list` procedure minted the same identifier.
- Consuming routers, one import/use pair each: `packages/server/src/routers/`
  `campaign.ts:10/171`, `character.ts:7/67`, `character-spell.ts:12/243`,
  `encounter.ts:7/95`, `invite.ts:10/102`, `map.ts:2/67`, `npc.ts:3/129`,
  `weapon-mastery.ts:2/15`, plus `magic-item.ts:7/140` and `monster.ts:11/196` for the
  search pair — 20 router lines, plus the ten declarations and their type aliases in
  `shared`.
- `packages/shared/src/schemas/srd-reference.ts:7` — `conditionSchema` is an SRD row
  `{id, name, description}`, consumed only at `packages/shared/src/schemas/srd.ts:377`
  for `listConditionsOutputSchema`. `packages/shared/src/rules/conditions.ts:38` —
  `srdConditionSchema` is the closed name enum, and its own doc comment says it
  "Mirrors `damageTypeNameSchema` in `damage-types.ts`".
- `packages/shared/src/schemas/srd-reference.ts:19` `damageTypeSchema` (row) vs
  `packages/shared/src/rules/damage-types.ts:27` `damageTypeNameSchema` (enum) — the
  sibling pair that gets the convention right.
- `packages/shared/src/schemas/character.ts:317-333` — `characterSummarySchema`
  re-declares `id`, `name`, `level`, `speciesId`, `backgroundId`, `userId`,
  `visibility`, `createdAt`, `updatedAt` (all already at `:96-110`) and adds only
  `classes`. Drift: `characterSchema:98` bounds level with `.min(MIN_LEVEL).max(MAX_LEVEL)`;
  the summary at `:320` is a bare `z.number().int()`, and nested `classes[].level` at
  `:330` is likewise unbounded while `characterClassSchema:120` bounds it.
- `packages/shared/src/schemas/MODULE.md` — "File naming convention" and "Cross-named /
  unpaired files (the traps)"; the `weapon-mastery-inputs.ts` bullet claims the file
  merely "references the SRD weapon-mastery enums", never mentioning that it owns an
  entity.

## Proposed direction

Each numbered step is one commit. Do them in this order; step 4 gets cheaper once
step 2 has already touched `spell.ts`.

1. **Extract the weapon-mastery entity.** Create
   `packages/shared/src/schemas/weapon-mastery.ts` holding
   `weaponMasteryPropertySchema`, `characterWeaponMasterySchema` and
   `CharacterWeaponMastery`; re-point the seven files that use those symbols —
   `character.ts:13`, the colocated `weapon-mastery-inputs.test.ts`,
   `packages/server/src/services/weapon-mastery-service.ts`, and the client's
   `components/sheet/equipment-summary.tsx`, `components/sheet/weapon-mastery-dialog.tsx`
   (+ its test) and `test/fixtures-character.ts`. **Leave
   `listOutputSchema`/`setOutputSchema` (`weapon-mastery-inputs.ts:45-51`) where they
   are** — see caveats. In the same commit, correct both stale `schemas/MODULE.md`
   entries (`docs/guides/add-module-doc.md`): the `weapon-mastery-inputs.ts` bullet at
   `:63-64`, and the entity-only list at `:66-68`, which files `invite.ts` as an entity
   file although it holds only router outputs.
2. **Move `spell.ts`'s five inline inputs to a new `spell-inputs.ts`.** Import churn is
   small: `packages/server/src/routers/srd.ts:2`,
   `packages/server/src/routers/character-spell.ts:7-15`, the client
   `hooks/character-sheet/use-character-spells.ts`, plus tests. Follow
   `docs/guides/add-trpc-procedure.md` for where a router's `.input(...)` schema is
   expected to live. *Documenting `spell.ts` as an exception in `MODULE.md` — the way
   `srd.ts` already is — is an equally acceptable resolution and is much cheaper; pick
   one deliberately rather than leaving the file silently off-convention.*
3. **Resolve `auth.ts` the same way — and leave `srd.ts` alone.** For `auth.ts`, either
   extract `auth-inputs.ts` (note the `successResponseSchema` trap at `MODULE.md:70-73`:
   it is cross-domain and must not move with the inputs) or add a bullet to
   `schemas/MODULE.md` recording `auth.ts` as an intentional inputs-holding entity file.
   Do **not** extract `srd-inputs.ts`: `MODULE.md:86-89`, `:95` and `:110` already
   assign the SRD router contract to `srd.ts`, so moving it would break a documented
   design and invalidate three doc statements to fix nothing.
4. **Domain-qualify the ten generic output schemas (eight `listOutputSchema`, two
   `searchOutputSchema`), all at once.** Rename
   `listOutputSchema` → `list<Domain>OutputSchema` (matching existing well-named
   siblings such as `note.ts:40 listNotesResponseSchema` and
   `magic-item.ts:86`) across the eight modules and their eight routers, and
   `searchOutputSchema` → `search<Domain>OutputSchema` in `magic-item.ts` /
   `monster.ts`. Fix the name derivation at
   `scripts/codemods/trpc-shared-output-candidates.ts:86,:91` so the minted name is
   domain-qualified — the bare `list` comes from `procedureNameForSchemaCall`, not from
   the suffix, so leave `OUTPUT_SCHEMA_SUFFIX` at `:19` alone: `outputTypeNameForSchema`
   at `:131-134` keys on it to derive the type name. Update the hand-maintained golden
   fixtures under `scripts/codemods/fixtures/trpc-shared-output/` in the same commit (24
   case directories, 14 of which contain generated `*OutputSchema` names in their
   `after/` trees); `scripts/codemods/trpc-shared-schema-codemod.test.ts` compares them
   verbatim.
5. **Rename `srdConditionSchema` → `conditionNameSchema`** in
   `packages/shared/src/rules/conditions.ts:38` and its importers, restoring the
   `<thing>NameSchema` convention that `damageTypeNameSchema` already follows. Keep its
   doc comment (the lowercase-canonical / display-capitalization warning) verbatim.
   Leave `srd-reference.ts:7 conditionSchema` — the row — alone.
6. **Derive `characterSummarySchema` from `characterSchema`.** Replace
   `character.ts:317-333` with
   `characterSchema.pick({ id: true, name: true, level: true, speciesId: true, backgroundId: true, userId: true, visibility: true, createdAt: true, updatedAt: true }).extend({ classes: z.array(characterClassSchema.pick({ classId: true, level: true })) })`
   or equivalent. Write the test first: assert that a level-25 row now fails
   `listOutputSchema` — this is a live behaviour change, not a pure refactor.

## Scope / caveats

- **`srd.ts`'s four inline inputs (`:324`, `:332`, `:342`, `:350`) are out of scope and
  are not a convention breach.** `schemas/MODULE.md` documents the placement three times
  (`:86-89`, `:95`, `:110`); this finding is limited to `spell.ts` and `auth.ts`.
- **Do not move `listOutputSchema`/`setOutputSchema` out of
  `weapon-mastery-inputs.ts:45-51`.** `MODULE.md`'s naming convention explicitly assigns
  `-inputs.ts` both "tRPC procedure inputs (request payloads) **and** the matching
  request-side output/result schemas". Only the entity block at `:7-20` is misplaced.
- **Do not derive `MAX_MASTERY_SLOTS` from the rules table without thinking.**
  `weapon-mastery-inputs.ts:26` is a request-validation bound;
  `MASTERY_SLOTS` in `rules/weapon-mastery.ts:92-99` is module-private and would have to
  be exported. `Math.max(...Object.values(MASTERY_SLOTS))` couples input validation to
  the rules table, so a future class with more slots silently loosens the API bound. If
  you do it, read `docs/guides/change-rules-logic.md` first and add a test pinning the
  derived bound. Leaving the literal with a pointer comment is a defensible outcome.
- **Step 6 changes runtime behaviour on an output path.** `characterSummarySchema` feeds
  `listOutputSchema:337`, a tRPC *output* schema. Adopting `MIN_LEVEL`/`MAX_LEVEL` means
  a legacy row outside 1-20 starts failing serialization instead of passing through.
  That is arguably the point, but it must be a deliberate decision with a test, not a
  side effect of a tidy-up.
- **The rename in step 4 is readability, not defect prevention — rank it accordingly.**
  Every consuming router imports exactly one of these symbols by deep specifier, none
  aliases on import, and `MODULE.md` documents that there is no barrel, so the names can
  never collide at the export surface. The "a router needing two list outputs must
  alias" scenario is hypothetical; no such site exists today. The real payoff is that
  grep and `code:intel` (`docs/guides/code-intel.md`) stop returning ten identical hits.
- **Skip the `monsterSpeedSchema` alias.** `packages/shared/src/schemas/monster.ts:60`
  (`export const monsterSpeedSchema = speedSchema;`) looks like a redundant one-liner,
  but it carries a doc comment explaining itself and has four production consumers.
  Because shared has no barrel, deleting it forces monster-domain code to reach into
  `schemas/srd.js` for an unrelated-looking name. Net value is roughly zero.
- Steps 1-5 are mechanical renames and moves across package boundaries; step 6 is not —
  it tightens an output contract. Keep each step in its own conventional commit rather
  than batching, because the diffs are wide and shallow and the commit gate is the
  verification step (`AGENTS.md:48-49`); reach for `verify:changed` directly only when
  troubleshooting a gate failure.
- Sequencing: step 4 overlaps `spell.ts:330` and `weapon-mastery-inputs.ts:45`, so run it
  after steps 1-2 to avoid rewriting the same import lines twice. Leaf 22 step 2 moves
  the notification entity out of `campaign.ts` — the same class of layout fix; if that
  leaf is scheduled first, fold it in here instead of doing it twice.
