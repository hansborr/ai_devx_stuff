# Concurrency Codemod Feasibility

Status: Archived. Planning completed and the checker-first baseline landed as
`bun run codemod:concurrency-guard -- --check`; remaining optional hardening is
tracked in `../backlog/concurrency-guard-followups.md`.

## Decision Framing

Automation can enforce shapes; it cannot decide whether a new write deserves a
gate. The three-bar gate in `docs/CONCURRENCY.md:9` requires multiple
real-world writers, user-visible wrong state, and non-trivial recovery
(`docs/CONCURRENCY.md:11`). New gates also need a reported real-session bug,
not theoretical race matching (`docs/CONCURRENCY.md:40`). The guide repeats the
same framing: start with the decision, not the lock
(`docs/guides/add-race-sensitive-mutation.md:3`).

In scope:

- Detect direct writes to already-gated delegates.
- Detect `RawTxClient` imports outside the mutation-helper trust boundary.
- Check existing helper internals for CAS shape.
- Inventory obvious helper-call order inside transactions.
- Generate concurrency-test skeletons for humans to complete.

Out of scope:

- Deciding whether a table should become gated.
- Choosing Pattern A/B/C, blind metadata, last-writer-wins, or no gate.
- Proving row-identity disjointness for cross-table writers.
- Rewriting caller conflict semantics.

## Existing Guardrails

- `packages/server/src/utils/prisma-types.ts:13` defines `RawTxClient` as the
  sole raw escape, and the restricted delegates make `.update`, `.updateMany`,
  and `.upsert` `never` for gated tables
  (`packages/server/src/utils/prisma-types.ts:26`,
  `packages/server/src/utils/prisma-types.ts:38`,
  `packages/server/src/utils/prisma-types.ts:50`,
  `packages/server/src/utils/prisma-types.ts:62`,
  `packages/server/src/utils/prisma-types.ts:74`).
- `TxClient` and `DbClient` expose those restricted delegates to business code
  (`packages/server/src/utils/prisma-types.ts:90`,
  `packages/server/src/utils/prisma-types.ts:121`).
- ESLint blocks `RawTxClient` imports outside `prisma-types.ts` and
  `utils/*-mutations.ts` (`eslint.config.js:252`, `eslint.config.js:279`).
- The guide names these as the useful checks to preserve
  (`docs/guides/add-race-sensitive-mutation.md:66`).

## Candidate Targets

### 1. Direct Gated Delegate Writes

Recognition: `CallExpression` with a property-access callee ending in
`update`, `updateMany`, or `upsert`; receiver resolves by name or type to
`characterStats`, `encounterParticipant`, `encounter`, `characterSpellSlot`,
or `characterClass`.

Existing sensor: typecheck already fails via restricted delegates.

Codemod value: better diagnostics and helper-specific suggestions. Auto-fix is
only safe for trivial, explicit shapes. `EncounterParticipant` alone could mean
`updateParticipantStatsLocked`, `updateParticipantStatsLockedWithExpectedVersion`,
or `blindUpdateParticipant`
(`packages/server/src/utils/participant-stats-mutations.ts:15`).

Verdict: yes detection; partial fix.

### 2. `RawTxClient` Imports Outside Helpers

Recognition: import declarations from `**/prisma-types.js` with named import
`RawTxClient`, outside the same allowlist as `eslint.config.js:259`.

Existing sensor: ESLint already blocks this (`eslint.config.js:279`).

Codemod value: low; it can report likely helper families but should not remove
the import because the raw writes below it still need manual rewrite.

Verdict: yes detection; no meaningful fix.

### 3. Pattern A Helper Shape

Recognition: in `character-stats-mutations.ts` and
`participant-stats-mutations.ts`, inspect raw `characterStats.updateMany` /
`encounterParticipant.updateMany`. Required shape is row id plus `version` in
`where`, `version: { increment: 1 }` in `data`, and zero-count `CONFLICT`
handling (`packages/server/src/utils/character-stats-mutations.ts:70`,
`packages/server/src/utils/participant-stats-mutations.ts:72`).

Codemod value: high-signal helper-internal invariant. Fix is safe only when the
local row/version identifiers are obvious.

Verdict: yes detection; partial fix.

### 4. Pattern B Helper Shape

Recognition: in `spell-slot-mutations.ts` and `character-class-mutations.ts`,
inspect raw `updateMany` calls for the counter key in `where` plus zero-count
`CONFLICT`. Current keys are `used`
(`packages/server/src/utils/spell-slot-mutations.ts:54`,
`packages/server/src/utils/spell-slot-mutations.ts:90`), `hitDiceUsed`
(`packages/server/src/utils/character-class-mutations.ts:33`), `level`
(`packages/server/src/utils/character-class-mutations.ts:74`), and `subclassId`
(`packages/server/src/utils/character-class-mutations.ts:100`).

Codemod value: useful invariant check. Auto-fix is unsafe when the previous
value variable or error semantics are not obvious.

Verdict: yes detection; partial/no fix.

### 5. Pattern C Compound WHERE

Recognition: in `encounter-state-mutations.ts`, inspect raw
`encounter.updateMany` calls. Required fields vary by helper: state transition
uses `state: from` (`packages/server/src/utils/encounter-state-mutations.ts:77`);
turn advance uses `state`, `currentTurnIndex`, and `round`
(`packages/server/src/utils/encounter-state-mutations.ts:108`);
turn-index shift uses expected index
(`packages/server/src/utils/encounter-state-mutations.ts:141`);
`assertTurnLock` uses state plus round/turn as appropriate
(`packages/server/src/utils/encounter-state-mutations.ts:193`,
`packages/server/src/utils/encounter-state-mutations.ts:214`).

Codemod value: good internal invariant check. Fixing is brittle because missing
WHERE fields must come from the caller's previously-read snapshot.

Verdict: yes detection; no general fix.

### 6. Cross-Table Lock Order

Recognition: inside `$transaction(async (tx) => ...)` callbacks and
tx-accepting functions, record known helper calls and map them to the canonical
order `CharacterStats -> CharacterClass -> CharacterSpellSlot ->
EncounterParticipant` (`docs/CONCURRENCY.md:153`).

Codemod value: advisory inventory only. It cannot prove row-identity
disjointness, which is the documented reason the spell-casting monster path can
take `EncounterParticipant` early (`docs/CONCURRENCY.md:168`).

Verdict: partial detection; no fix.

### 7. Conflict Semantics

Recognition: helper return type and zero-count handling. Pattern A/B helpers
throw `CONFLICT`; `advanceTurnCompound` returns row count so callers can choose
`BAD_REQUEST` vs `CONFLICT` (`docs/CONCURRENCY.md:137`).

Codemod value: can detect missing zero-count handling inside helper files, but
cannot infer caller UX semantics.

Verdict: partial detection; no fix.

### 8. Invariant-Style Test Scaffolding

Recognition: command target names a router/service/test. Generated skeleton
should follow the state-consistency invariant pattern
(`docs/CONCURRENCY.md:287`) and the guide's example list
(`docs/guides/add-race-sensitive-mutation.md:52`). It should not generate
`[200, 409]` response assertions unless a CAS token such as `expectedVersion`
exists (`docs/CONCURRENCY.md:300`).

Verdict: yes generation; not enforcement.

## Recommended Scope

Build a checker first, not a general auto-rewriter.

Smallest valuable slice:

- `--check`: scan server source for direct gated writes and forbidden
  `RawTxClient` imports; scan helper files for Pattern A/B/C CAS invariants.
- `--all`: same scan across `packages/server/src/**/*.ts`.
- Single-file mode: scan one `.ts` file.
- No default auto-fix. A later `--fix-trivial` can target only helper-internal
  edits with obvious identifiers.

Enforce means detect and fail. Fix means rewrite source. Business-code fixes
should stay manual because selecting the correct helper is domain work.

## Implementation Sketch

- File: `scripts/codemods/concurrency-guard.ts`.
- Package script: `codemod:concurrency-guard`, following `package.json:27`.
- CLI: mirror `structured-logging-fix` with `--check`, `--all`, `--dry-run`,
  and single-file mode (`scripts/codemods/structured-logging-fix.ts:31`).
- AST tooling: use `ts-morph`, matching current codemods
  (`scripts/codemods/structured-logging-fix.ts:6`,
  `scripts/codemods/trpc-shared-output.ts:45`). Reuse shared codemod helpers
  if a fix mode appears (`scripts/codemods/lib/trpc-shared-schema.ts:40`,
  `scripts/codemods/lib/trpc-shared-schema.ts:504`).
- Tests: add `scripts/codemods/concurrency-guard.test.ts` and fixtures under
  `scripts/codemods/fixtures/concurrency-guard/`, following fixture metadata
  and directory comparison in `scripts/codemods/trpc-shared-schema-codemod.test.ts:88`
  and `scripts/codemods/trpc-shared-schema-codemod.test.ts:145`.
- Optional lint rule: add only after the checker is stable. Register under the
  local plugin at `eslint.config.js:16` and scope to `packages/server/src/**/*.ts`.
  Do not duplicate typecheck unless the rule gives materially better messages.
- Integration: start manual via
  `bun run codemod:concurrency-guard -- --check`. Prefer a later `doctor`
  warning before any pre-commit or `verify:changed` blocker.

AST passes:

1. Classify paths: helper, type-test, generated, test, business code.
2. Find forbidden `RawTxClient` imports.
3. Find gated delegate mutator calls outside helpers.
4. Verify helper `updateMany` WHERE/data/count guard shapes.
5. Emit advisory transaction-order inventories for known helper calls.
6. Print file:line, target, verdict, and suggested helper/doc link.

## Risks And Open Questions

- False positives can push agents to weaken intentional last-writer-wins paths.
  The non-candidate list at `docs/CONCURRENCY.md:27` must remain policy.
- Auto-fixing can choose the wrong helper, especially for
  `EncounterParticipant` blind metadata vs expected-version CAS
  (`docs/CONCURRENCY.md:309`).
- Cross-table warnings need allowlisted rationale for row-disjoint exceptions
  (`docs/CONCURRENCY.md:168`).
- Name-based AST matching may miss aliases, destructuring, wrappers, or
  `unknown` casts. Type-aware matching is slower and more fragile.
- Test scaffolding should probably be a later separate command; fixture setup
  and final-state assertions need domain knowledge.

## Recommendation

Build it only as a checker first. Do not build a general auto-fixer yet.

Rough effort: 1-2 days for `scripts/codemods/concurrency-guard.ts` plus fixture
tests for direct writes, forbidden raw imports, Pattern A/B/C helper-shape
regressions, and advisory lock-order output. Add about a day if receiver-name
matching is not enough and type-aware resolution is needed.

Do not wire it into pre-commit until a manual run on the current tree produces
no findings or only reviewed allowlisted findings. The value is sharper
diagnostics around existing typecheck/ESLint guardrails, not broader automatic
gating.
