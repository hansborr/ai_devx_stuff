# 19. Mapper and broadcast suites seed characters through character-create service internals instead of a DB-level fixture

Status: Not started
Theme: test fixture layering · Area: server · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three suites whose subject is *not* the character-create service — the
`mapCharacterDetail` utility mapper suite, the `character.updated` socket
broadcast regression suite, and the seed→read normalization roundtrip suite —
all import `buildCreateData` and `validateCreateInput` from
`services/character-create.ts` purely to seed a character row for setup. That
reverses the intended test dependency: low-level mapper and socket-contract
tests now sit downstream of a higher-level service's implementation details, so
any refactor of the creation workflow (signature changes, splitting the
validate/build pair, moving the ref-resolution step) breaks suites that have
nothing to say about creation. In the mapper suite the two-line seed incantation
is repeated nine times, multiplying the churn. The reason the suites reached for
service internals is real: the only public character fixture, `createCharacter`
in `test/character-fixtures.ts`, drives the full tRPC route and needs a Fastify
app plus an auth token, which DB-level suites do not have — there is simply no
low-level seed helper to use. Character-service changes are a common path in
this app, so the missing helper is paid for repeatedly.

## Evidence

- `packages/server/src/utils/character-mapping.test.ts:7` — the utility mapper
  suite imports `buildCreateData, validateCreateInput` from
  `../services/character-create.js`.
- `packages/server/src/utils/character-mapping.test.ts:38-39, 59-60, 79-80, 95-96, 127-128, 144-145, 159-160, 172-173, 208-209`
  — the `validateCreateInput`/`buildCreateData` seed pair repeated nine times
  (re-counted at the pin) in a 248-line suite.
- `packages/server/src/utils/character-mapping.test.ts:17-28` — the suite also
  re-declares its own `BASE_INPUT`, a value-for-value copy of
  `VALID_CREATE_INPUT` (`packages/server/src/test/character-fixtures.ts:5-16`),
  down to the "Thorn Ironfist" name.
- `packages/server/src/routers/character-updated-broadcast.test.ts:6` — the
  broadcast regression suite imports the same pair; its single use at `:41-43`
  exists solely to build the fixture character before the socket assertions.
- `packages/server/src/routers/seed-read-normalization.test.ts:8` — same import
  in the normalization roundtrip suite; single use at `:164-166`, again only to
  seed the row that `mapCharacterDetail` then reads.
- `packages/server/src/test/character-fixtures.ts:18-31` — the one public
  helper, `createCharacter(app, token, …)`, requires a Fastify instance and an
  access token because it goes through `/trpc/character.create`; unusable from
  a plain-DB suite without standing up an app.
- `packages/server/src/services/character-create.test.ts` is the one importing
  suite whose subject actually is the creation service. A fourth test-side
  importer exists at
  `packages/server/src/services/level-up/level-up-test-helper.ts:5`, with its
  use at `:45-46`; it seeds level-up fixtures through the same pair.
- `packages/server/src/utils/character-mapping.ts:10-23` — `CHARACTER_INCLUDE`,
  the include shape a DB-level fixture must satisfy so mapper suites can load
  `CharacterWithRelations` (`:25-27`) rows directly.

## Proposed direction

Add a DB-level character seed helper (typed `prisma.character.create` using
`CHARACTER_INCLUDE`-compatible data) to
`packages/server/src/test/character-fixtures.ts` and use it in
`character-mapping.test.ts`, `character-updated-broadcast.test.ts`, and
`seed-read-normalization.test.ts` and
`services/level-up/level-up-test-helper.ts`, reserving `buildCreateData`/
`validateCreateInput` imports for suites whose subject is the character-create
service itself. Remove the now-obsolete
`utils/character-mapping.test.ts` → `services/character-create.ts` exception
from `scripts/drift-ai/layer-direction.ts` in the same change.

Mechanics to make that executable:

- The helper takes a `userId` (and optional input overrides defaulting to
  `VALID_CREATE_INPUT`) and returns the created row; the mapper suite needs it
  loaded with `include: CHARACTER_INCLUDE` (`character-mapping.test.ts:40-43`),
  while the broadcast suite only needs the `id` (`:43-44`), so return the
  included shape and let callers take what they need.
- Deleting the imports also retires the mapper suite's private `BASE_INPUT`
  copy (`character-mapping.test.ts:17-28`) in favor of `VALID_CREATE_INPUT`,
  and drops the now-unused `db`/`test-db` imports where the seed pair was the
  only consumer.
- `services/character-create.test.ts` keeps its imports untouched — it is the
  service-workflow suite the internals exist for.
- Per-suite verification: `bun run test -- <file>` for each of the three
  edited suites, plus the focused level-up suites that consume
  `createFighterCharacter`; re-run the layer-direction check after deleting
  its obsolete allowed edge.

## Scope / caveats

- Refactoring `character-create.ts` itself (splitting or re-signaturing
  `validateCreateInput`/`buildCreateData`) is out of scope; this leaf only
  moves test setup off those internals.
- Do not route the new helper through the tRPC path or the service: the point
  is a fixture whose only dependency is Prisma plus the include shape. If the
  raw `Prisma.CharacterCreateInput` literal inside the helper needs a cast,
  follow the `type-assertion-boundary` marker rules — though `*.test-helper`
  files are exempt, `character-fixtures.ts` is not named `*.test-helper` and
  is not exempt as-is.
- Behavior assertions must not change: the three suites' expectations stay
  byte-identical; only setup moves.
- Prior mapper hardening covered malformed persisted `choiceData`/condition
  values (the seed→read normalization suite exists for that); this leaf is
  about the fixture dependency only and must not weaken those
  non-canonical-value seeds — `seed-read-normalization.test.ts:170-172` writes
  a display-cased condition row directly on purpose, and that direct Prisma
  write stays.
- **Sequencing:** land this fixture-decoupling before
  [004-character-creation-large-pseudo-module-loose.md](./004-character-creation-large-pseudo-module-loose.md),
  which otherwise rewires the same three imports plus the level-up helper to a
  moved facade. [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md)
  may also edit `seed-read-normalization.test.ts`; either order works, but do
  not work them concurrently. Leaf
  [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md)
  migrates the layer-direction allowed edge this leaf removes, so whichever
  lands second must use the resulting one-edge inventory.
