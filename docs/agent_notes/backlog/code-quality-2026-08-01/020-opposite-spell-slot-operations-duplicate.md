# 20. `consumeSpellSlot` and `recoverSpellSlot` hand-maintain mirror copies of the same 30-line Pattern B CAS protocol

Status: Not started
Theme: duplicated concurrency protocol · Area: server · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/src/utils/spell-slot-mutations.ts` is the sole sanctioned
escape past the type-level ban on `characterSpellSlot` writes, and its two
racing helpers — `consumeSpellSlot` and `recoverSpellSlot` — each carry a
complete hand-written copy of the same Pattern B protocol: load the row,
`NOT_FOUND` if missing, bound-check with `BAD_REQUEST`, compare-and-swap
`updateMany` keyed on `{ id, used }`, `CONFLICT` on zero affected rows,
refetch. The two 30-line function spans are byte-identical except for four lines:
the function name, the bound predicate (`used >= total` vs `used <= 0`),
one `BAD_REQUEST` message, and `increment` vs `decrement`.

That symmetry is exactly what makes the duplication risky rather than merely
verbose. A future change to affected-row handling, return shape, or the CAS
WHERE clause has to be applied twice, and nothing but reviewer vigilance
catches an edit that lands in one direction only. A silently diverged copy
here is not a cosmetic bug — it is a race-handling bug in locking code that
callers across four service files rely on. The surface is rarely edited and
deliberately audited, which keeps the day-to-day tax low, but is also why a
divergence would likely go unnoticed for a long time. A smaller irritation
rides along: the utility's `recoverSpellSlot` collides with the same-named
request-facing service export, forcing an `InTx` import alias at the one call
site that needs both.

## Evidence

- `packages/server/src/utils/spell-slot-mutations.ts:43-72` —
  `consumeSpellSlot`: `findUnique` (`:49-51`), `NOT_FOUND` (`:52-57`),
  bound check `slot.used >= slot.total` → `BAD_REQUEST` (`:58-63`),
  `updateMany` CAS on `{ id: slot.id, used: slot.used }` (`:64-67`),
  `count === 0` → `CONFLICT` (`:68-70`), `findUniqueOrThrow` refetch (`:71`).
- `packages/server/src/utils/spell-slot-mutations.ts:79-108` —
  `recoverSpellSlot` repeats the protocol line for line. A diff of the two
  30-line spans (`:43-72` vs `:79-108`) shows exactly four differing lines:
  the name, `slot.used <= 0` (`:94`), the message ``Level ${…} spell slots
  already full`` (`:97`), and `decrement` (`:102`). Everything else —
  including both error messages at `:55`/`:91` and `:69`/`:105` — is
  identical.
- `packages/server/src/services/character-live-state/spell-slot.ts:8-12` —
  the alias collision: `recoverSpellSlot as recoverSpellSlotInTx`, because
  the service file exports its own `recoverSpellSlot` at `:35`.
- `packages/server/src/utils/spell-slot-mutations.ts:6-25` — the
  sanctioned-escape header: this file is the only place permitted to cast
  through to `RawTxClient` for `characterSpellSlot` writes, and it documents
  why the CAS pair needs the protocol while the three non-racing helpers
  (`resetAllSpellSlots`, `setSpellSlotTotal`, `grantTemporarySlot`) do not.
- Four non-test caller files import the pair:
  `services/character-live-state/spell-slot.ts:8-12` (both),
  `services/character-live-state/sorcery-point.ts:12`,
  `services/spell-casting/non-combat-cast.ts:8`, and
  `services/spell-casting/combat-transaction.ts:8` (consume only).
- The helper names are load-bearing in docs: `docs/CONCURRENCY.md:287-291`
  lists both under Pattern B (and `:412` names `consumeSpellSlot` in the
  cross-table lock-order inventory);
  `docs/guides/add-race-sensitive-mutation.md:27-30` (guide step 5) names
  both as the existing Pattern B helpers;
  `packages/server/src/services/spell-casting/MODULE.md:27` names
  `consumeSpellSlot`. `packages/server/src/services/character-live-state/MODULE.md:33`
  names the request-facing service's own `recoverSpellSlot`, so that line does
  not document the aliased utility helper.
- Coverage today is asymmetric: `consumeSpellSlot` has direct unit tests at
  `packages/server/src/utils/concentration-helpers.test.ts:177-219`
  (increment, `NOT_FOUND`, `BAD_REQUEST` message); `recoverSpellSlot` is
  exercised only through router integration tests at
  `packages/server/src/routers/spell-slot.test.ts:132-170`.

## Proposed direction

Extract a **private, unexported, table-local** used-counter CAS primitive
inside `spell-slot-mutations.ts`, and keep `consumeSpellSlot` /
`recoverSpellSlot` as thin exported wrappers.

1. The primitive stays in this file and stays unexported — that is
   load-bearing, not a style preference. It keeps the escape inside the sole
   sanctioned `RawTxClient` file and does not expand the race-sensitive
   helper surface that `docs/guides/add-race-sensitive-mutation.md` (steps
   3-5) and the concurrency docs govern.
2. Parameterize it as a small config object — delta (`increment` /
   `decrement`), guard predicate, and the `BAD_REQUEST` message — rather
   than a direction string. Wrappers must preserve the exact error codes,
   messages, and return shape. The consume tests at
   `concentration-helpers.test.ts:177-219` pin its `NOT_FOUND` and
   `BAD_REQUEST` messages, while `routers/spell-slot.test.ts:132-170` pins
   recovery success data and status codes but not recovery error text. Add
   direct `recoverSpellSlot` unit coverage first (TDD), including its
   `NOT_FOUND`, `BAD_REQUEST`, and `CONFLICT` contracts, before rewriting that
   currently indirect-only path.
3. Treat renaming the exported wrappers (e.g. `*InTx` to dissolve the alias)
   as **optional**, and default to skipping it. The names appear in
   `docs/CONCURRENCY.md:287-291` and `:412`,
   `add-race-sensitive-mutation.md:27-30`, one applicable MODULE.md file, and
   four caller files — the character-live-state MODULE names the unchanged
   service wrapper — more churn than the dedup itself, against a one-line
   alias. If the rename is taken anyway, all of those doc updates are
   in-scope in the same change; doc drift here is a known failure mode.

## Scope / caveats

- **The sanctioned-escape header (`spell-slot-mutations.ts:6-25`) stays
  verbatim.** The 2026-07-25 pack's
  [CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md) (row on
  trimming the `utils/*-mutations.ts` headers) permanently refuses trimming
  these headers against `docs/CONCURRENCY.md`; one consult called them "the
  highest-value comments in the server". This leaf dedupes bodies, never
  header prose. If the extraction makes a header sentence inaccurate, extend
  it minimally; do not restructure it.
- **Expect reviewer scrutiny; the adjacent precedent cuts both ways.** The
  prior pack refused merging `assertTurnLock`'s two branches in the sibling
  `encounter-state-mutations.ts`
  ([05-router-and-service-boundaries.md](../code-quality-2026-07-25/05-router-and-service-boundaries.md),
  step 7 dropped permanently) because two flat, separately auditable lock
  predicates beat a conditionally-built WHERE. That ruling is explicitly
  scoped to that function — and here the CAS WHERE clause
  (`{ id: slot.id, used: slot.used }`) is *identical* in both copies, so
  nothing conditional enters the lock predicate; only the delta, guard, and
  message vary. Keep it that way: if the extraction would make the WHERE
  clause conditional, stop.
- **Do not generalize the primitive beyond this table.** `docs/CONCURRENCY.md`
  §Pattern B's objection that consolidating helpers "would conflate unrelated
  models" is a cross-table concern; a table-local extraction does not violate
  it, but extending the primitive to `character-class-mutations.ts` (the
  other Pattern B family) would. Out of scope.
- The three non-CAS helpers in the file (`resetAllSpellSlots`,
  `setSpellSlotTotal`, `grantTemporarySlot`) are deliberately outside the
  protocol (header `:19-24`) and are untouched.
- The `rawWrites` widening at `:32-35` and its `type-assertion-boundary`
  marker are already single-sourced; this leaf does not touch them.
- Read `docs/CONCURRENCY.md` and
  `docs/guides/add-race-sensitive-mutation.md` before starting — this file
  is race-sensitive mutation-helper surface by definition.
- No sequencing dependencies on other leaves in this pack.
