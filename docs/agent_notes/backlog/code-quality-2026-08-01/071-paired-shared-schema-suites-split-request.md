# 71. Character and encounter request-schema tests hide inside entity-named suites instead of their dedicated `*-inputs.test.ts` files

Status: Not started
Theme: request-contract test ownership · Area: tests · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The shared Zod schemas are the repo's declared contract surface, and the schemas
directory documents a strict file split: `<name>-inputs.ts` owns request
payloads, `<name>.ts` owns persisted entity shapes, and — since there is no
barrel — "knowing which file holds a symbol is the whole game"
(`packages/shared/src/schemas/MODULE.md:31-33`). The test layout for the two
highest-traffic pairs breaks that map. Character and encounter request
validation each has two authorities: a dedicated `*-inputs.test.ts` suite, plus
379 lines of request-schema describes filed inside the entity-named suites
(238 lines in `character.test.ts`, 141 in `encounter.test.ts`) — 9 describes,
47 `it` declarations, 49 runtime cases. The split follows historical field
addition, not any visible concern boundary: `updateCharacterStatsInputSchema`
is literally tested in both files, different facets in each. A contributor who
follows the documented convention to the inputs suite sees only half the
request coverage, and new request tests keep landing in whichever half the
author found first.

## Evidence

- `packages/shared/src/schemas/character.test.ts:33-38` — the entity-named
  suite imports `createCharacterInputSchema`,
  `updateCharacterPersonalityInputSchema`, `updateCharacterStatsInputSchema`,
  and `useCharacterFeatureInputSchema` from `./character-inputs.js`; their four
  describes sit at `:41`, `:150`, `:195`, `:240`, spanning `:41-278` (238
  lines) *before* the entity coverage (`characterSchema` at `:456` onward).
- `packages/shared/src/schemas/encounter.test.ts:19-25` — same shape: five
  schemas imported from `./encounter-inputs.js`, tested under a banner comment
  "Input schemas — combat-map integration" (`:453-455`) in five describes at
  `:457`, `:503`, `:536`, `:555`, `:576`, spanning `:457-597` (141 lines) after
  the entity assertions.
- Both schemas are tested in two files at once:
  `encounter-inputs.test.ts:28`/`:76` hold `createEncounterInputSchema` /
  `updateEncounterInputSchema` describes while `encounter.test.ts:555`/`:576`
  hold the same schemas' `(mapId)` describes; `character-inputs.test.ts:222`
  and `:263` cover `updateCharacterStatsInputSchema` facets while
  `character.test.ts:150` covers others; `character-inputs.test.ts:484` covers
  `createCharacterInputSchema` spells while `character.test.ts:41` covers its
  core cases.
- `packages/shared/src/schemas/MODULE.md:40-49` — the convention the layout
  violates: `<name>-inputs.ts` is "tRPC procedure **inputs** (request
  payloads)", `<name>.ts` is "the **entity** schemas", with
  `character-inputs.ts` itself as the worked example.
- Measured totals across the two misplaced blocks: 379 lines, 9 describes, 47
  syntactic `it` declarations, 49 runtime cases (the `for` loop at
  `character.test.ts:220-237` expands one `it` over `ideals`/`bonds`/`flaws`).

## Proposed direction

Move the four character-inputs describes out of `character.test.ts` into
`character-inputs.test.ts` and the five encounter input-schema describes
(`encounter.test.ts:457-597`, plus the `:453-455` banner) into
`encounter-inputs.test.ts` as verbatim content-only relocations — no payload
builders or other rewrites (CQ25-158 remains closed). Entity suites keep only
persisted/output-schema coverage. Mechanics:

- `character.test.ts`: delete the `./character-inputs.js` import block
  (`:33-38`) with the move; every `../constants.js` import stays (the entity
  describes still use `MAX_TEXT_LENGTH`, `MAX_LEVEL`, etc. at `:480-500` and
  beyond). The moved describes leave the `describe("character schemas", …)`
  wrapper, so unindent one level — that is layout, not content.
- `character-inputs.test.ts`: add `updateCharacterPersonalityInputSchema` and
  `useCharacterFeatureInputSchema` to the existing `./character-inputs.js`
  import and `MAX_TEXT_LENGTH` to the `../constants.js` import; the other two
  schemas and both parse helpers are already imported (`:13-24`).
- `encounter.test.ts`: the whole `./encounter-inputs.js` import (`:19-25`)
  goes — all five schemas are used only in the moved block.
- `encounter-inputs.test.ts`: add `linkParticipantToTokenInputSchema`,
  `unlinkParticipantFromTokenInputSchema`, `autoLinkTokensInputSchema` to its
  single `./encounter-inputs.js` import (`:5-22`); place the moved describes
  near the existing same-schema ones (describe names are distinct — the moved
  create/update blocks carry `(mapId)` suffixes — so nothing collides).
- One commit across the four files. Verify with
  `bun run test -- packages/shared/src/schemas/character.test.ts packages/shared/src/schemas/character-inputs.test.ts packages/shared/src/schemas/encounter.test.ts packages/shared/src/schemas/encounter-inputs.test.ts`
  — same total case count before and after.

## Scope / caveats

- **Binding prior-pack ruling (CQ25-158):** the 2026-07-25 pack declined
  payload-factory rewrites of `encounter-inputs.test.ts` — its 4-6 line literal
  payloads are the point
  (`docs/agent_notes/backlog/code-quality-2026-07-25/40-test-payload-factories.md:308-313`).
  This leaf is a relocation only; introducing builders or "deduplicating"
  fixtures while moving would reopen that closed decision.
- Do not merge or rename describes — the two-files-per-schema overlap (e.g.
  `updateCharacterStatsInputSchema` facets) becomes visible adjacency after the
  move; consolidating the blocks themselves is a separate, optional follow-up.
- Other pairs and the three entity files that deliberately hold inputs inline
  (`srd.ts`, `spell.ts`, `auth.ts` — `MODULE.md:104-119`) are out of scope; no
  `MODULE.md` edit is needed, since the move brings the layout *into*
  compliance with it.
- [024-encounter-inputs-monolith-spanning-three.md](./024-encounter-inputs-monolith-spanning-three.md)
  restructures the production `encounter-inputs.ts` module this leaf's target
  suite covers. No hard ordering edge, but do not work the two concurrently; if
  024 lands first and splits the module, relocate each describe beside whichever
  suite covers its schema's new home.
