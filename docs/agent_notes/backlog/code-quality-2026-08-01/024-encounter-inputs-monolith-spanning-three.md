# 24. The encounter input contract is one 329-line, 20-schema module whose three router consumers each use a disjoint slice

Status: Not started
Theme: Contract layout mirrors router boundaries · Area: shared · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/shared/src/schemas/encounter-inputs.ts` is a single contract module
that mixes six concerns — encounter CRUD, state transitions, participant
management, turn management, combat logs, and combat-map integration — behind
one broad name. The server side is not shaped like that: three separate routers
(`encounter`, `encounter-combat`, `encounter-map`) and their service layers
already partition this surface cleanly, and each consumes a **disjoint** slice
of the file. A contributor wiring a map-token link or a combat-log page has to
navigate a module dominated by unrelated participant and lifecycle schemas, and
every one of those independent workstreams edits the same 329-line file. The
repo already solved this for the other combat procedures — `attack-roll-inputs.ts`
and `spell-action-inputs.ts` are dedicated `<concern>-inputs.ts` modules feeding
the same `encounter-combat` router — so the monolith is the odd one out, not the
convention.

## Evidence

All at the audit pin (working tree identical for source).

- `packages/shared/src/schemas/encounter-inputs.ts` — measured 329 lines, 20
  exported `*InputSchema` declarations plus the `autoLinkTokensResultSchema`
  output schema. Section banners mark the six concerns: CRUD `:23-25`, state
  transitions `:72-74`, participant management `:85-87`, turn management
  `:234-236`, combat log `:254-256`, combat-map integration `:294-296`.
- 10 production importers, measured by grep (18 files match `encounter-inputs`;
  the other 8 are six tests plus references in `schemas/encounter.ts:18` and
  `schemas/MODULE.md`):
  3 routers (`packages/server/src/routers/encounter.ts`,
  `encounter-combat.ts`, `encounter-map.ts`), 4 encounter-combat services
  (`services/encounter-combat/{participant-action,combat-log,turn-action,initiative-action}.ts`),
  `services/map-tokens/participant-links.ts`, and 2 utils
  (`utils/encounter-helpers.ts`, `utils/encounter-participant-helpers.ts`).
  Zero client files import the module.
- The three routers consume disjoint slices:
  `routers/encounter.ts:8-19` imports the 10 CRUD/transition/participant
  schemas and none of the turn/log/map ones; `routers/encounter-combat.ts:11-16`
  imports exactly the 4 turn/log schemas (`addCombatLogInputSchema`,
  `advanceTurnInputSchema`, `listCombatLogsInputSchema`,
  `rollAllInitiativeInputSchema`); `routers/encounter-map.ts:2-7` imports
  exactly the 3 token-link inputs plus `autoLinkTokensResultSchema`.
- The service/util importers follow the same partition:
  `participant-action.ts:4-8`, `encounter-helpers.ts:1`, and
  `encounter-participant-helpers.ts:1` take only participant types;
  `combat-log.ts:1-4`, `turn-action.ts:2`, `initiative-action.ts:2` take only
  log/turn types; `participant-links.ts:2-7` takes only the map-link types.
- The module-private declarations are sectional too: `MIN_INITIATIVE`,
  `MAX_INITIATIVE`, `MAX_SORT_ORDER` (`encounter-inputs.ts:19-21`) are used only
  in the participant section (`:94`, `:198`, `:217-218`);
  `COMBAT_LOG_DEFAULT_PAGE_SIZE`/`COMBAT_LOG_MAX_PAGE_SIZE` (`:275-276`) only in
  `listCombatLogsInputSchema` (`:287-288`). Nothing module-local crosses a
  section boundary; the genuinely shared values are already imported from
  upstream (`../constants.js`, `../rules/xp.js`, `./encounter.js` at `:3-18`).
- Convention precedent: `packages/shared/src/schemas/MODULE.md:161` lists
  `attack-roll-inputs.ts`, `spell-action-inputs.ts`, `spell-casting-inputs.ts`
  as the combat inputs files, and `routers/encounter-combat.ts:1,17` already
  imports from the first two alongside the monolith.
- The colocated `encounter-inputs.test.ts` is 1030 lines covering all six
  sections of the one module.
- Repoint mechanics are already settled by module policy:
  `schemas/MODULE.md:30-34` (no barrel, deep specifiers only) and `:196-199`
  (no compatibility re-exports between schema files, per ADR-0005 an import
  names the defining file); the wildcard `"./schemas/*.js"` export map at
  `packages/shared/package.json:9-12` covers new schema files with no
  `package.json` change.

## Proposed direction

Partition `packages/shared/src/schemas/encounter-inputs.ts` into three sibling
contract modules that mirror the three existing routers, following the repo's
established `<router>-inputs.ts` convention (`attack-roll-inputs.ts` and
`spell-action-inputs.ts` already do this for other `encounter-combat`
procedures):

1. **`encounter-inputs.ts` (keeps)** — CRUD, state-transition, and
   participant-management schemas: `createEncounter` through
   `updateParticipant`, the three `add*ParticipantInputSchema` union members
   with their discriminated union and `superRefine`, plus the private
   `baseParticipantFields`/`monsterNpcStatsFields` fragments and the
   `MIN_INITIATIVE`/`MAX_INITIATIVE` and `MAX_SORT_ORDER` constants. Serves
   `routers/encounter.ts`, `services/encounter-combat/participant-action.ts`,
   and `utils/encounter-{helpers,participant-helpers}.ts`.
2. **New `encounter-combat-inputs.ts`** — turn management
   (`advanceTurnInputSchema`, `rollAllInitiativeInputSchema`) and combat log
   (`addCombatLogInputSchema`, `listCombatLogsInputSchema` plus the two
   `COMBAT_LOG_*_PAGE_SIZE` constants). Serves `routers/encounter-combat.ts`
   and `services/encounter-combat/{combat-log,turn-action,initiative-action}.ts`.
3. **New `encounter-map-inputs.ts`** — the link/unlink/autoLink token inputs
   plus `autoLinkTokensResultSchema`. Serves `routers/encounter-map.ts` and
   `services/map-tokens/participant-links.ts`.

No neutral-fragment module is needed: the current section boundaries share
nothing module-local across sections, and the genuinely shared values already
live upstream in `../constants.js`, `../rules/xp.js`, and `./encounter.js`,
which each new module imports directly.

Repoint all 10 production import sites atomically with no compat barrel or
re-exports (deep-specifier convention per `schemas/MODULE.md`; the wildcard
`"./schemas/*.js"` export map in `packages/shared/package.json` covers the new
files with no `package.json` change). Split the 1030-line colocated
`encounter-inputs.test.ts` along the same three-file lines, and update the
`schemas/MODULE.md` file inventory in the same change (the pairing list at
`:61-64`, the cross-named/unpaired section at `:72-97` — both new files have no
same-named entity file, their entity side stays `encounter.ts` — and the quick
map at `:153-162`). Verify with `bun run typecheck` and
`bun run test -- packages/shared/src/schemas` over the three resulting test
files.

## Scope / caveats

- **Out of scope:** any schema-content or validation-behavior change — in
  particular the monster-provenance union rework, which is
  [026-monster-provenance-invariants-disappear.md](./026-monster-provenance-invariants-disappear.md);
  router file renames; and client-side work (no client files import this
  module).
- **Sequencing (binding):** serialize with leaf 026, which edits the same
  participant/monster schemas. Land this mechanical split first so 026's
  semantic rework lands in the already-slimmed `encounter-inputs.ts` — or at
  minimum do not run the two leaves concurrently.
- **The participant union moves as one unit.** The discriminated union, its
  `superRefine`, its three member schemas, and the private
  `baseParticipantFields`/`monsterNpcStatsFields` fragments must stay together;
  splitting or duplicating the fragments across files would silently fork
  validation behavior. The three `add*ParticipantInputSchema` members are
  exported but, outside the module, only the colocated test imports them
  (production consumes the union type), so the entire participant section stays
  in `encounter-inputs.ts`.
- **No partial repoint, no shim.** A leftover `export … from` re-export or a
  half-done repoint leaves dual import paths for the same schema and defeats the
  boundary the split creates; `schemas/MODULE.md:196-199` forbids
  compatibility re-exports outright.
- **`autoLinkTokensResultSchema` goes to `encounter-map-inputs.ts`** with its
  input siblings — `MODULE.md:40-44` assigns request-side result schemas to
  `-inputs.ts` files. Do not relocate it to `encounter.ts` as part of this
  leaf.
- **Prior pack:** the 2026-07-25 pack's schema-layout slice (SHARED-CLUSTER-PLAN
  S1, landed `75bad57dc`) corrected entity/input placement and ruled
  "document, don't extract" for entity files holding inline inputs
  (`spell.ts`, `auth.ts`, `srd.ts`). That ruling declined creating new inputs
  modules from mixed entity files; it does not cover partitioning an existing
  `-inputs.ts` monolith, so nothing there blocks this leaf. S1 is landed and
  must not be reopened — it is precedent, not a dependency.
- **The live pack's `encounter-inputs.test.ts` instruction does not apply.**
  `code-quality-2026-07-25/40-test-payload-factories.md:308-313` says not to
  touch that test file — but that caveat rules out introducing payload
  factories, not moving the file; splitting it three ways alongside its
  production module is in scope and expected here.
- Stale `packages/shared/dist/` artifacts regenerate on build and need no
  manual attention.
- Serialize this mechanical contract/test split with leaf 064 and prefer
  landing this leaf first; after the split, 064's combat-log cursor fixture
  belongs in encounter-combat-inputs.test.ts. Do not implement the two leaves
  concurrently.
