# 4. Character creation is a 640-line four-file pseudo-module loose in the services root, and the services README misclassifies it as a flat service

Status: Not started
Theme: service module boundaries · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Character creation has physically outgrown the flat-service tier it is filed
under, but nothing marks the boundary. The workflow spans four substantial
files in the services root — `character-create.ts`, `character-create-spells.ts`,
`character-create-helpers.ts`, `starting-equipment-service.ts`, 640 lines
total — with no folder, no shared types file, and no local ownership doc. A
contributor has to reconstruct the four-file unit by chasing imports, and the
entry file makes that harder than it should be: it is simultaneously the
facade that coordinates the other three files *and* a dependency of its own
helper, because `character-create-helpers.ts` imports `ValidatedSrdRefs` back
out of `character-create.ts` — a type-only cycle inside the unit.

The in-repo classification compounds the problem. `services/README.md` — the
directory's own taxonomy, and a showcase document for this repo — defines a
flat service as "a single `<name>-service.ts` (or `<name>.ts`)" yet lists
`character-create.ts` as flat with a `(+ character-create-helpers.ts)`
parenthetical, omits `character-create-spells.ts` from the inventory entirely,
and lists `starting-equipment-service.ts` as an independent flat peer even
though its only production caller runs inside the character-creation
transaction. Anyone using the README to navigate the services directory is
actively misled about a real feature path.

The starting-equipment boundary also contradicts that transaction-only role.
`createStartingInventory` accepts `DbClient | TxClient`, advertising both an
autocommit entry path and a transaction-scoped entry path even though its sole
production caller passes the character-creation transaction client. That
union is a capability claim, not harmless generality: a future caller can use
the advertised top-level mode to persist inventory outside atomic character
assembly, permitting a partially assembled character if a later stage fails.

## Evidence

- 640 lines across four flat files, re-measured at the pin with
  `wc -l packages/server/src/services/character-create.ts packages/server/src/services/character-create-spells.ts packages/server/src/services/character-create-helpers.ts packages/server/src/services/starting-equipment-service.ts`:
  `packages/server/src/services/character-create.ts` (263),
  `character-create-spells.ts` (185), `character-create-helpers.ts` (111),
  `starting-equipment-service.ts` (81).
- `packages/server/src/services/character-create.ts:11-13` — the entry file
  imports `buildNestedCreates`, `validateAndBuildSpellCreates`, and
  `createStartingInventory` from the three siblings; it is the unit's de facto
  facade.
- `packages/server/src/services/character-create-helpers.ts:10` —
  `import type { ValidatedSrdRefs } from "./character-create.js";` — the
  helper imports a type back from the entry file (exported at
  `character-create.ts:21`), a real type-only dependency cycle.
- `packages/server/src/services/character-create.ts:230-254` — the single
  `$transaction` (character create → level-1 features → starting inventory →
  refetch); `:247` calls `createStartingInventory(tx, …)`, so starting
  equipment is an internal stage of this transaction, not an independent
  service.
- `packages/server/src/services/starting-equipment-service.ts:63-80` —
  `createStartingInventory` nevertheless accepts `DbClient | TxClient` and
  performs its equipment read and inventory bulk insert through that widened
  capability.
- `packages/server/src/utils/prisma-types.ts:142-171` — `TxClient` and
  `DbClient` intentionally expose different transaction capabilities:
  `TxClient` blocks nested transactions, while `DbClient` exposes the guarded
  top-level `$transaction`.
- `packages/server/src/services/starting-equipment-service.test.ts:42-48` and
  `:109-112` — both focused persistence cases currently call
  `createStartingInventory` with the top-level `db`, so narrowing the
  production boundary requires adapting the tests rather than widening the
  moved implementation for test convenience.
- `packages/server/src/services/starting-equipment-service.ts:63-64` has
  exactly one production importer,
  `packages/server/src/services/character-create.ts:13`. Code import
  references were re-measured with
  `git grep -n -E 'from .*.starting-equipment-service|vi\.mock\(.*starting-equipment-service' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src`;
  the remaining references are the subject-matched service test and the
  router transaction test's import and `vi.mock` path at
  `packages/server/src/routers/character-create-transaction.test.ts:5` and
  `:11`.
- `packages/server/src/services/` — no `MODULE.md` or
  `character-create-MODULE.md` exists. Re-measured with
  `find packages/server/src/services -maxdepth 1 -type f -name '*MODULE.md' -print | sort`;
  the only flat-service companions are for rest, invite, and homebrew import.
- `packages/server/src/services/README.md:42` — flat tier defined as
  "A single `<name>-service.ts` (or `<name>.ts`)".
- `packages/server/src/services/README.md:198-202` — the flat inventory lists
  `character-create.ts` "(+ `character-create-helpers.ts`)" and
  `starting-equipment-service.ts`, and omits `character-create-spells.ts`:
  the classification has already drifted from the tree.
- `packages/server/src/services/README.md:56-58` — the flat-tier "Use when"
  examples also name both `character-create.ts` and
  `starting-equipment-service.ts`.
- `packages/server/src/services/README.md:21-28` — the promotion rubric
  requires all three of: ≥2 related mutations, non-trivial concurrency
  invariants, ≥3 files pulling their weight. Character creation fails 1 and 2
  (one mutation, a plain nested-create transaction) while overflowing 3 —
  the rubric conflates earning a folder with earning a concurrency charter.
- `packages/server/src/routers/character.ts:42-45` — the sole production
  caller: a thin pass-through mutation
  (`.mutation(async ({ input, ctx }) => createCharacter(ctx, input))`).
- External import sites that must be rewired (six, re-verified with
  `git grep -n -E 'from .*(character-create|starting-equipment-service)|vi\.mock\(.*starting-equipment-service' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src`):
  `packages/server/src/routers/character.ts:23`,
  `routers/character-updated-broadcast.test.ts:6`,
  `routers/seed-read-normalization.test.ts:8`,
  `routers/character-create-transaction.test.ts:5`,
  `services/level-up/level-up-test-helper.ts:5`,
  `utils/character-mapping.test.ts:7` — plus the `vi.mock` path string at
  `routers/character-create-transaction.test.ts:11`.
- `packages/server/src/services/character-create.ts:159`, `:188`, and `:217` —
  live test seams exported from the entry file are `validateCreateInput`,
  `buildCreateData`, and `createCharacter`.

## Proposed direction

Promote character creation to `packages/server/src/services/character-create/`
and amend `services/README.md` in the same leaf — the taxonomy amendment is
inseparable from the move, not a conflict to flag and defer. No behavior
changes; verification is typecheck plus the existing tests.

1. **Create the folder** per the existing deep-module conventions
   (`README.md:33-38` facade convention):
   - `character-create/character-create.ts` — logic-bearing facade (no barrel
     `index.ts`), keeping `createCharacter` plus the live test seams
     `validateCreateInput` / `buildCreateData` exported.
   - `character-create/types.ts` — owns `ValidatedSrdRefs` (and
     `CharacterCreateContext`); this alone breaks the helper→entry type-only
     cycle at `character-create-helpers.ts:10`. `level-up/types.ts` is the
     in-tree precedent.
   - Internals with the now-redundant prefix dropped: `nested-creates.ts`
     (was `character-create-helpers.ts`; its one export is
     `buildNestedCreates`), `spells.ts` (was `character-create-spells.ts`),
     and `starting-equipment.ts` (was `starting-equipment-service.ts`, folded
     in because its sole production importer is `character-create.ts:13` and
     it runs inside the creation `$transaction`). Narrow
     `createStartingInventory` there to accept only `TxClient`; do not carry
     the pre-move `DbClient | TxClient` capability into the internal stage.
   - Colocated test files move into the folder with their subjects:
     `character-create.test.ts`, `character-create-helpers.test.ts`,
     `character-create-spells.test.ts`, `starting-equipment-service.test.ts`,
     and `services/character-create-transaction.test.ts` (the DB-trigger
     integration test colocated in the services root — distinct from the
     same-named mock-based test under `routers/`). Their relative imports
     (`../test/…`, `../prisma/…`, `../utils/…`) gain one directory level.
     Adapt the starting-equipment cases to enter an existing test transaction
     before calling the narrowed stage, or extract and test a pure item-data
     building seam while retaining transaction-backed persistence coverage.
     Do not widen the production parameter to accommodate the current tests.
2. **Rewire the six external import sites** listed under Evidence, plus the
   `vi.mock` path string at `routers/character-create-transaction.test.ts:11`
   (a string literal — typecheck will not catch it; the mock silently stops
   applying if it is missed).
3. **Write the light-tier `MODULE.md`** using the section names in
   `docs/module-docs.md:36-50`: pipeline stages (parallel validate → build
   create input → single `$transaction` with level-1 features and starting
   inventory → refetch/map), transaction ownership (the service owns the
   `$transaction`; the router `create` at `routers/character.ts:42-45` is a
   thin pass-through), contract notes (no Socket.io broadcast; auth is plain
   `protectedProcedure`), and the exported test seams. State explicitly that
   `starting-equipment.ts` is transaction-only and accepts `TxClient`; this
   makes the documented internal-stage guarantee agree with the callable
   capability. Do not write the full concurrency-invariant charter — there
   are no locks, CAS, or retry loops here. `docs/module-docs.md:52-54` already
   allows short module docs but says deep services "should be more explicit
   about contracts, invariants, and broadcasts"; add a one-line note there
   admitting the structure-driven light tier in the same change. Run
   `bun run module:index` after adding the file
   (`docs/module-docs.md:57`; the script is registered at
   `package.json:152`).
4. **Amend `services/README.md`** in the same change, recasting the promotion
   rubric (`:21-28`) as two named paths that separate what earns a folder
   from what earns the heavy charter:
   - *Invariant-driven*: the existing all-three rubric with the full
     `MODULE.md` charter, unchanged.
   - *Structure-driven*: a single mutation whose implementation already spans
     ≥3 substantive implementation files (tests excluded) earns a folder on
     structural grounds alone, carrying a light `MODULE.md` instead of the
     concurrency charter.
   Keep the "one mutation does not need a module" line, qualified to one
   mutation *in one file*. Fix the inventory in the same edit: remove
   `character-create` and `starting-equipment-service` from both flat lists
   (the Use-when examples at `:56-58` and the inventory at `:198-202`, curing
   the drift that omits `character-create-spells.ts`), and add
   `character-create/` to the deep-module inventory (`:191-192`) and examples
   (`:30-31`) as the named exemplar of the structure-driven path.

## Scope / caveats

- **No behavior change.** `createCharacter`'s logic, its existing
  `$transaction`, transaction ordering, error codes, persistence operations,
  and log event are untouched; this is a move, type relocation, compile-time
  capability narrowing, test adaptation, and doc edits. Do not introduce a
  second transaction around starting equipment.
- The widened signature is not evidence that current production creation is
  non-atomic: `packages/server/src/services/character-create.ts:230-254`
  already performs starting-equipment persistence inside its single
  transaction. This addition prevents a future standalone caller; it does not
  change the runtime transaction shape.
- **Binding rulings** (each was explicitly ruled during direction review):
  - Do not land the folder promotion while merely flagging a conflict with
    `services/README.md`; the README amendment (step 4, both promotion paths,
    both list fixes) travels in the same leaf.
  - Do not resolve this by staying flat with a `character-create-MODULE.md`
    companion: the flat tier's own single-file definition (`README.md:42`)
    and its already-drifted inventory cannot describe a four-production-file
    cluster. The stay-flat variant (types file + flat companion doc +
    inventory fix) is a strict content subset of this direction and survives
    only as a fallback if review overrides toward it — and even then the
    README amendment is still required.
  - Do not add a re-export-only `index.ts` barrel; the facade is the
    logic-bearing `character-create/character-create.ts` per `README.md:33-38`.
  - Do not leave `starting-equipment-service.ts` as a standalone flat
    service; fold it in as an internal transaction stage and remove it from
    both flat lists.
  - Do not leave the moved starting-equipment stage accepting `DbClient`;
    narrow its parameter to `TxClient` at the post-move path and adapt the
    tests that move with it.
  - Do not leave `ValidatedSrdRefs` exported from the entry file; it moves to
    `types.ts` so the cycle is broken structurally, not documented around.
  - Do not write the full concurrency-charter `MODULE.md`; this module gets
    the light tier described in step 3.
  - Do not size the rewiring at three import sites; it is six external
    importers plus the `vi.mock` path string, and the colocated
    `character-create*` / `starting-equipment*` test files move into the
    folder with their subjects.
- **Rubric-erosion risk.** The structure-driven path could become an excuse
  to folderize everything. The mitigations are part of the direction: an
  objective, greppable threshold (≥3 substantive implementation files, tests
  excluded), the invariant bar left fully intact for the charter tier, and
  one named in-tree exemplar per path.
- **Prior structural rulings do not cover this.** The 2026-07-25 pack's
  closest decisions — dropping a rest-service promotion and refusing a
  `services/character-spells/` folder — were per-service calls about other
  services; nothing there rules on character-create or the
  starting-equipment capability.
- **Cross-references.** [006-server-mappers-maintain-parallel-handwritten.md](./006-server-mappers-maintain-parallel-handwritten.md)
  works in `utils/character-mapping*`, whose test file this leaf re-points
  (one import line) — no ordering dependency, but do not work the two
  concurrently. [042-flat-character-creation-contract-forces.md](./042-flat-character-creation-contract-forces.md)
  and [045-character-creation-ability-rules-have-four.md](./045-character-creation-ability-rules-have-four.md)
  approach character creation from the shared/client contract side; avoid
  concurrent edits to the creation surfaces, no ordering required.
