# 59. `characterSpell.add` checks for an existing row, then inserts against a unique constraint, so the loser gets a 500

Status: Proposed — not promoted
Theme: Race-sensitive mutation not routed through the concurrency machinery · Area: server · Severity: low · Size: XS

Source: server-cluster review round, 2026-07-27 (found while confirming that
leaf 51's fix left the rest of `character-spell.ts` unexamined) · Confidence:
high

**Evidence in this leaf is pinned to `f16079c2f` (`main`), not the pack's
`883d48bf`.** `packages/server/src/routers/character-spell.ts` *does* differ on
`feat/cq-server-cluster`: leaf 51's fix extracted `togglePrepared`'s body into
`utils/prepared-spell-toggle.ts`, which moves `add` from `:60` to `:25`. The
`add` procedure itself is untouched by that change — re-resolve the anchors below
by symbol, not by number.

## Problem

`characterSpell.add` decides "does this character already know this spell?" with
a read, then acts on that answer with a write, and nothing holds between them:

1. `:102-109` — `characterSpell.findUnique` on the `characterId_spellId`
   compound key.
2. `:111-116` — if a row came back, throw `BAD_REQUEST "Character already knows
   this spell"`.
3. `:118-126` — `characterSpell.create`.

There is no `$transaction` around the three steps. Two concurrent `add` calls for
the same `(characterId, spellId)` both read `existing === null`, both pass the
guard, and both reach the insert. The database catches it —
`@@unique([characterId, spellId])` is declared on the model — so the loser's
`create` raises Prisma `P2002`.

**Nothing translates that.** `add` has no `try`/`catch`, and there is no layer
above it that maps Prisma codes: `trpc/trpc.ts` installs only an
`errorFormatter` (which decorates Zod issues), and `app.ts`'s
`fastifyTRPCPlugin` `onError` hook *logs* internal errors without remapping
them. So the P2002 escapes as a plain thrown error, tRPC wraps it as
`INTERNAL_SERVER_ERROR`, and the caller receives an HTTP 500 with a
`trpc internal error` line in the server log — on a path whose intended answer
for exactly this end state is a `BAD_REQUEST` with a written user-facing message.

The repair already exists in the tree and is applied to this same shape three
times. `isPrismaUniqueViolation` (`utils/prisma-errors.ts:12-18`) is the P2002
predicate, and `services/character-live-state/stats-conditions.ts:197-205`
wraps a structurally identical check-then-act insert with a comment that names
the race as the reason: "A concurrent committer can still win the race between
the check above and this insert; the case-sensitive unique key catches the
canonical duplicate, so keep the P2002 -> CONFLICT mapping as a backstop." That
is precisely the backstop `add` lacks.

**Why this is `low`/`XS` and still worth filing.** The window is a few
milliseconds and `add` is owner-only (`assertCharacterOwner` at `:63-65`), so the
racer is one user double-clicking, or two of their own tabs — not an adversary
and not a common accident. What earns it a leaf is the *shape*, not the odds: an
un-translated database error on a procedure that already wrote the correct
error for the same outcome, in a repo that owns a named helper for this exact
translation and applies it everywhere else.

## Evidence

All anchors are `main` (`f16079c2f`) line numbers in
`packages/server/src/routers/character-spell.ts` unless another file is named.

- `:60` — `add: protectedProcedure`, the affected procedure.
- `:63-65` — `assertCharacterOwner(ctx.prisma, input.characterId, ctx.user.id, ...)`,
  so both racers are necessarily the same authenticated user.
- `:102-109` — `ctx.prisma.characterSpell.findUnique({ where: { characterId_spellId: { characterId, spellId } } })`,
  the "already knows" read.
- `:111-116` — `if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Character already knows this spell" })`,
  the intended answer.
- `:118-126` — `ctx.prisma.characterSpell.create({ data: { characterId, spellId, source, prepared: spell.level === 0 }, include: { spell: true } })`,
  outside any transaction and with no `catch`.
- No `$transaction` appears anywhere in the procedure body between `:60` and
  `:126`.
- `packages/server/prisma/schema.prisma:1013` — `@@unique([characterId, spellId])`
  on `model CharacterSpell` (`:1003-1017`). The constraint the second insert
  hits.
- `packages/server/src/utils/prisma-errors.ts:12-18` — `isPrismaUniqueViolation`,
  a type predicate for `PrismaClientKnownRequestError` with code `P2002`, already
  exported and already unit-tested (`prisma-errors.test.ts:13-25`).
- Prior art on the identical shape:
  `packages/server/src/services/character-live-state/stats-conditions.ts:197-205`
  (check-then-insert with a P2002 backstop and a comment explaining the race);
  `packages/server/src/routers/campaign.ts:264-273`;
  `packages/server/src/routers/homebrew-campaign.ts:58-63`.
- No remapping layer above the router:
  `packages/server/src/trpc/trpc.ts:78-80` creates the tRPC instance with
  `errorFormatter: formatTrpcError` and nothing else, and `formatTrpcError`
  (`:57-76`) only attaches `validationErrors` from a `ZodError` cause;
  `packages/server/src/app.ts:237-244`'s `onError` logs when
  `error.code === "INTERNAL_SERVER_ERROR"` and returns, changing no code.
- `CharacterSpell` is deliberately **not** in the gated delegate set
  (`packages/server/src/utils/prisma-types.ts`), and `docs/CONCURRENCY.md`
  records that ruling as part of leaf 51's fix ("`CharacterSpell` stays out of
  the gated delegate set: the fix is transaction-local, and a gate with one
  guarded caller and a dozen ordinary writers is worse than none"). This leaf
  does not reopen it.

## Proposed direction

A hypothesis, not a spec. Read `docs/guides/add-race-sensitive-mutation.md`
first, but note that this is the cheapest case that guide covers — the database
already enforces the invariant correctly, and only the error translation is
missing.

1. **Pin it red first, and reuse the existing race substrate.** Two concurrent
   `add` calls for the same `(characterId, spellId)` should end with one success
   and one `BAD_REQUEST`, never a 500. `packages/server/src/test/race-helpers.ts`
   provides `raceTest({ concurrency, setup, action, invariant })`, used by
   `routers/character-spell-concurrency.test.ts` (added on
   `feat/cq-server-cluster`) for exactly this kind of end-to-end assertion.
   Heed that file's own header caveat: `app.inject` starts requests together but
   forces no interleaving, so assert only properties that hold under every
   ordering — here, "no response is a 500" and "exactly one row exists" — rather
   than a specific winner. A timing- or sleep-based test for a millisecond
   window will be flaky in a repo-wide gate and will be deleted by someone else
   later. If a deterministic overlap is needed, follow
   `utils/prepared-spell-toggle.test.ts`, which pins the interleaving-sensitive
   half at the helper level instead of over HTTP.
2. **Wrap the `create` and map `isPrismaUniqueViolation` to the same error the
   pre-check throws.** Four lines, matching `stats-conditions.ts:197-205`.
3. **Decide the error code deliberately, and say why in the code.** The three
   existing P2002 call sites all map to `CONFLICT`; the sequential answer on
   *this* path is `BAD_REQUEST`. Two callers reaching the same end state should
   not get different codes because one lost a race, which argues for
   `BAD_REQUEST` here — but that breaks the tree's local convention, so make it
   an explicit, commented choice rather than a copy of either neighbour. Check
   what the client does with each code from this procedure before choosing.
4. **Keep the pre-check.** It is not redundant: it produces the friendly message
   without paying an exception on the common path, and deleting it would make
   every duplicate add a caught database error. `stats-conditions.ts` keeps both
   for the same reason and calls the catch a "backstop".

## Scope / caveats

- **This is not leaf 51 again, and must not be fixed like it.** Leaf 51 was a
  *set-level* cap invariant with no database constraint behind it, which is why
  it needed a Serializable transaction. Here the invariant is single-row
  uniqueness that Postgres already enforces perfectly — the database wins the
  race correctly and the only thing missing is the translation. Reaching for a
  transaction, an isolation level, or a CAS here is over-engineering, and
  raising the isolation level would buy a retry loop for a case that needs a
  four-line catch.
- **Do not gate the `characterSpell` delegate.** The ruling recorded in
  `docs/CONCURRENCY.md` stands; a P2002 catch is transaction-free and does not
  disturb it.
- **Do not generalise this into a global P2002 middleware.** The three existing
  call sites each choose a different message and this one likely chooses a
  different code; a tRPC-wide mapper would flatten distinctions the routers make
  on purpose, and would silently change the response for every future unique
  constraint added to the schema.
- **`remove` has the sibling shape and is *not* covered by this leaf's evidence.**
  `:144-168` reads the row (`:152-160`), throws `NOT_FOUND` if absent
  (`:161-163`), then deletes by id (`:165`). A concurrent remove would make the
  delete fail on a missing row, which Prisma reports as `P2025` rather than
  `P2002` — a different code, a different intended error (`NOT_FOUND`), and a
  different predicate, and unlike the `add` path above **this one was not
  verified**. Fix it in the same session only if you pin it with its own red
  test; do not fold it into `add`'s catch.
- **`togglePrepared` has the same `P2025` window, and leaf 51's fix kept it.**
  Raised independently by two reviewers on the `feat/cq-server-cluster` panel,
  2026-07-27. The router reads the `CharacterSpell` row, then
  `commitPreparedToggle` re-reads it inside the Serializable transaction with
  `findUniqueOrThrow` (`utils/prepared-spell-toggle.ts`, `where: { id:
  input.recordId }`). A concurrent `remove` landing between those two reads
  raises `P2025`, which `isPrismaSerializationFailure` does not match, so it is
  rethrown and surfaces as HTTP 500 where the sequentially-equivalent answer is
  `NOT_FOUND`. Pre-existing — the inline `update` leaf 51 replaced had the same
  window — and deliberately out of that leaf's scope, but the in-transaction
  re-read is new code, so record it here rather than leaving it implied. The
  natural fix is the same one this leaf proposes for `remove`: a non-throwing
  `findUnique` plus an explicit `NOT_FOUND`, which under Serializable also makes
  a later concurrent delete a retry that then returns the same mapped result.
- **Check the output contract before restructuring.** `add` returns
  `characterSpellWithDetailsSchema`, built from `created` plus
  `resolveCombatEligibility` over `character.classes`. A catch branch throws and
  returns nothing, so the shape is unaffected — but any attempt to convert this
  to an upsert would have to rebuild that payload.
- Sequencing: none. Touches only `character-spell.ts`, and leaf 51's landed fix
  has already moved the surrounding lines, so re-resolve by symbol before
  editing.
