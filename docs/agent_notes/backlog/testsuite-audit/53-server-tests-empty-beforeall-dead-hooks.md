# 53. Nine empty `beforeAll(async () => {})` stubs are dead lifecycle hooks forcing unused `beforeAll` imports across six server test files

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting. (Line numbers refreshed for merge `692b437a`, which centralized the DbClient cast via `test/test-db.ts` in the three `utils/*-mutations.test.ts` files — removing a 2-line cast block and shifting those stub line numbers up by 2, but leaving every empty `beforeAll` stub in place.)
Lens: maintainability · Area: packages/server tests (utils/ + services/) · Severity: low · Size: XS · Confidence: high
Theme: dead-test-code · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
Six `packages/server` test files declare nine `beforeAll(async () => {})` hooks whose bodies are empty. Each does nothing: it runs a no-op once per suite, and in every case it is immediately followed by a real `beforeEach(async () => { await cleanDb(); ... })` that performs the actual per-test setup. The empty `beforeAll` is pure dead code — it changes neither setup nor assertions — and its only side effect is forcing an otherwise-unused `beforeAll` symbol into each file's `vitest` import.

The maintainability cost is twofold. First, the pattern reads as a copy-paste scaffold that was stamped out and never filled in: a reader scanning the suite sees `beforeAll` and reasonably infers that expensive suite-level setup exists (a shared fixture, a one-time seed), then has to read the empty body to discover it is a lie. Second, the orphaned `beforeAll` import is exactly the kind of "imported but only used by dead code" symbol that erodes trust in a file's import list. These are colocated DB-backed suites (`updateCharacterStatsLocked`, `advanceClassLevel`, `setSubclass`, `createStartingInventory`, the participant-stats lock variants, `character-mapping`, `character-create`), so they are read often by anyone touching the race-sensitive mutation helpers; the false suite-level-setup signal lands precisely where setup semantics matter most.

This is the lowest-priority item in the audit set — cosmetic housekeeping with zero runtime or coverage impact — and under the repo's audit weighting it ranks below the tooling/dogfood-test findings.

## Evidence
- `packages/server/src/services/starting-equipment-service.test.ts:11` — `beforeAll(async () => {})`, immediately followed by the real `beforeEach(async () => { await cleanDb(); ... })` at `:13`. `beforeAll` is imported only here (line 1 import; 2 total `beforeAll` occurrences in the file = the import + this stub).
- `packages/server/src/services/character-create.test.ts:24` — empty `beforeAll`, real `beforeEach` at `:26`; `beforeAll` imported at line 3 and used nowhere else.
- `packages/server/src/utils/character-stats-mutations.test.ts:45` and `:161` — two empty `beforeAll` stubs (each followed by a `cleanDb()` `beforeEach` at `:47` and `:163`); `beforeAll` imported at line 1, 3 total occurrences = import + 2 stubs.
- `packages/server/src/utils/character-class-mutations.test.ts:49` and `:119` — two empty stubs (`advanceClassLevel`, `setSubclass` suites); same import-only-for-stubs shape.
- `packages/server/src/utils/participant-stats-mutations.test.ts:47` and `:68` — two empty stubs; `character-mapping.test.ts:25` — one empty stub.
- Repo-wide `rg 'beforeAll\(async \(\) => \{\}\)' packages/server/src` returns exactly 9 matches in exactly these 6 files (enumeration complete). In each file the `beforeAll` count equals (1 import + number of stubs), so removing the stubs genuinely orphans the import in all six.

## Proposed direction
Delete all nine `beforeAll(async () => {})` calls and drop the now-unused `beforeAll` symbol from the `vitest` import line in each of the six files. No behavior change: the no-ops did nothing, and the real per-test setup in each `beforeEach` (including `cleanDb()` and fixture creation) is untouched, so every suite's coverage is preserved exactly. Verify with `bun run test -- packages/server/src/utils/character-stats-mutations.test.ts` (and the other five) — identical pass counts, zero assertion edits.

Optionally, add an eslint-rules guard that flags empty lifecycle-hook bodies (`beforeAll`/`beforeEach`/`afterAll`/`afterEach` with an empty `{}` body) so the scaffold pattern cannot silently reappear. The repo already authors ~19 custom rules under `eslint-rules/`, each with a matching `.test.js` (e.g. `no-llm-artifacts.js`/`no-llm-artifacts.test.js`, `type-assertion-boundary.js`/`.test.js`), so this fits the established local-rule convention. This optional rule must not block the core deletion.

Estimated impact: removes 9 dead hooks across 6 files and their orphaned imports, clarifying that these suites have no suite-level setup. Zero runtime saved (the no-ops are free) and zero coverage change — this is readability/onboarding housekeeping, not a speed finding.

## Scope / caveats
TOUCH: only the six cited `packages/server` test files — delete the 9 empty hooks and drop the now-unused `beforeAll` import token from each. NOT-TOUCH: the `beforeEach` setup, any fixture helper, any assertion, and any source under test. RISK: none — deleting empty `{}` bodies cannot change setup or assertions, and the import removal is mechanically verified (each file uses `beforeAll` solely for the stubs). SEQUENCING: trivial standalone XS with no dependency on any other finding.

BOUNDARY: this is a pure dead-code-removal finding, not a duplication finding and not a colocation finding (cf. codebase-audit slug `34-saving-throw-tests-misplaced`, which moves live tests; here nothing moves and nothing is duplicated). It is also distinct from the audit's DB-setup-cost and weak-assertion findings — those concern what `beforeEach`/assertions *do*; this concerns hooks that do *nothing*. Folds in the duplicate pass-1 finding "Nine empty `beforeAll(async () => {})` stubs are dead lifecycle hooks (and force unused `beforeAll` imports)", which made the identical claim; the two are merged here with no change in scope.
