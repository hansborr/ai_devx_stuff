# 51. The prepared-spell limit is a check-then-act race: count, then update, with no transaction and no CAS

Status: **Done 2026-07-27** on branch `feat/cq-server-cluster`, merge
`6246c73cf`; see [Landed](./00-index.md#landed). The **transaction route** was
taken, at `isolationLevel: "Serializable"`, in the new
`packages/server/src/utils/prepared-spell-toggle.ts`; the conditional-write route
does not fit a set-level invariant. **Step 3 was answered "no"**:
`CharacterSpell` deliberately did not join the gated delegate set. **Step 4 is
still open work, not absorbed** — `calcMaxPrepared` remains unexported and
untested in isolation, so [leaf 05](./05-router-and-service-boundaries.md)
step 5 keeps its testability outcome, now against a correct helper.
`prepared-spell-toggle.ts` exists because the fix pushed the router past the
max-lines gate; it is **not** that extraction. The Landed row records what
Serializable actually buys, which is not what this leaf's `## Proposed
direction` assumed — read it before citing SSI anywhere.
Theme: Race-sensitive mutation not routed through the concurrency machinery · Area: server · Severity: medium · Size: S

Source: server/comments cluster planning session, 2026-07-26 (recorded in [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md), "Two live defects the leaves do not record") · Confidence: high

**Evidence in this leaf is pinned to `5ff5751a` (`main`), not the pack's
`883d48bf`.** The line range below was re-verified against the live file.

## Problem

`characterSpell.togglePrepared` enforces the prepared-spell cap by reading, then
writing, with nothing between them:

1. `:198-204` loads the character with its classes and stats.
2. `:207` computes the cap with `calcMaxPrepared(character)`.
3. `:209-215` issues a **separate** `characterSpell.count` for the currently
   prepared non-cantrip spells.
4. `:217-222` throws `BAD_REQUEST` if `preparedCount >= maxPrepared`.
5. `:227-230` issues `characterSpell.update` flipping `prepared`.

There is no `$transaction` around any of it and no compare-and-swap on the
write. Two concurrent `togglePrepared` calls made at `maxPrepared - 1` both read
`preparedCount = maxPrepared - 1`, both pass the guard at `:217`, and both write.
The character ends up one spell over its limit.

The consequence is a rule violation, not data corruption — which is why this is
worth an `S` and not an emergency. What makes it a real finding rather than a
theoretical one is where it sits: this repo has `docs/CONCURRENCY.md`,
`docs/guides/add-race-sensitive-mutation.md`, five gated Prisma delegates, an
`eslint-rules/concurrency-guard.js`, and a `codemod:concurrency-guard` scanner,
all built for exactly this shape. `CharacterSpell` is simply not one of the
tables any of that covers, so a read-then-write on it passes every gate the repo
owns.

**This reframes leaf 05 step 5, and the reframing is the part most likely to be
lost.** Leaf 05 proposes extracting `calcMaxPrepared` and the guard out of the
router into `utils/`. That is worth doing on its own terms — it makes the *rule*
unit-testable — but it does **not** fix the invariant, because the invariant is
not about where the check lives. A commit that performs the extraction must not
describe itself as fixing the prepared-spell limit.
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md)'s slice S7 states both halves
and separates them.

## Evidence

- `packages/server/src/routers/character-spell.ts:166` — `togglePrepared`, the affected procedure.
- `:47` — `calcMaxPrepared(character)`, the cap computation; called at `:207`.
- `:198-204` — `ctx.prisma.character.findUniqueOrThrow` with `classes` and `stats` included.
- `:209-215` — `ctx.prisma.characterSpell.count({ where: { characterId, prepared: true, spell: { level: { gt: 0 } } } })`, a second round trip.
- `:217-222` — the guard, `preparedCount >= maxPrepared` → `BAD_REQUEST "Cannot prepare more than N spells"`.
- `:227-230` — `ctx.prisma.characterSpell.update({ where: { id: record.id }, data: { prepared: !record.prepared } })`, outside any transaction, with `where` keyed on the row id only.
- No `$transaction` appears anywhere in the procedure body between `:166` and the update.
- `CharacterSpell` is not in the gated set: `packages/server/src/utils/prisma-types.ts:122-128` lists `characterStats`, `encounterParticipant`, `encounter`, `characterSpellSlot`, `characterClass`. Note `characterSpellSlot` **is** gated and `characterSpell` is **not** — two adjacent tables, one covered, one not, which is a plausible reason this was never noticed.
- `packages/server/src/services/README.md:195-207` records `character-spell.ts`'s inline spell-rule enforcement as a deliberate placement decision. That decision is about *layering* and is not evidence the invariant is safe.

## Proposed direction

A hypothesis, not a spec. Read `docs/CONCURRENCY.md` and
`docs/guides/add-race-sensitive-mutation.md` before starting — this is exactly
the change those documents are for, and the guide's pattern vocabulary should be
used rather than a bespoke fix.

1. **Pin the race with a red test first.** Two concurrent `togglePrepared` calls
   at `maxPrepared - 1` should end with exactly one success and one
   `BAD_REQUEST`/`CONFLICT`. Existing server integration tests already drive this
   router; follow their lifecycle helpers rather than a new harness.
2. **Choose the pattern before writing code.** Two shapes fit and they are not
   equivalent:
   - **Transaction + re-check.** Wrap steps 1-5 in `ctx.prisma.$transaction` and
     re-count inside it. Simple, but under Prisma's default isolation two
     transactions can still both read the pre-write count; the isolation level
     has to be raised for this to be a fix rather than a narrowing of the window.
     If you take this route, say which isolation level and why, in the code.
   - **Conditional write.** Make the update itself carry the condition, in the
     `updateMany`-with-compound-`where` + `count === 0` → `CONFLICT` shape the
     spell-slot helpers already use
     (`packages/server/src/utils/spell-slot-mutations.ts:64-70`). This is the
     house pattern and needs no isolation-level argument, but the "count of
     sibling rows" predicate does not fit a single-row `where`, so it likely
     needs a `version` column on `Character` or a different formulation.
   The choice is the substance of this leaf; do not treat it as an
   implementation detail.
3. **Decide whether `CharacterSpell` joins the gated set.** If the fix ends up
   being a locked helper in `utils/`, adding `characterSpell` to
   `RestrictedDelegates` and to both copies of `GATED_DELEGATES` is the
   consistent follow-through — but it bans direct writes repo-wide, so it needs
   the whole call-site inventory first. If the fix is transaction-local, do not
   gate the delegate: a gate with one helper behind it and a dozen ordinary
   writers is worse than none.
4. **Coordinate with leaf 05 step 5's extraction rather than racing it.** If the
   extraction lands first, this fix goes into the extracted helper. If this lands
   first, the extraction moves a correct helper instead of a broken guard. Either
   order works; landing them in the same commit does not, because it makes the
   invariant fix invisible in review.

## Scope / caveats

- **Do not describe the leaf 05 extraction as fixing this.** Stated above, and it
  is the single most likely failure mode for this leaf. Moving the check into
  `utils/` changes nothing about the race.
- **A naive `$transaction` wrap is not automatically a fix.** Under read-committed
  isolation the two counts can still both observe the pre-write state. Whichever
  route is taken must be able to answer "what stops both callers from seeing
  `maxPrepared - 1`?" in one sentence.
- **The blast radius is one spell over a cap, and the fix must not cost more than
  that.** A `CONFLICT` where users previously succeeded is a user-visible
  behaviour change on a very common interaction (preparing spells from the
  character sheet). Prefer the shape that fails closed *only* at the boundary,
  and check what the client does with a `CONFLICT` from this procedure before
  choosing.
- **Cantrips are already excluded** (`:189-193` rejects them outright, and the
  count filters `spell: { level: { gt: 0 } }`). Do not widen the guard while
  fixing it.
- **`maxPrepared === 0` skips the guard entirely** (`:208`). That is existing
  behaviour for classes with no prepared-spell mechanic; preserve it.
- Sequencing: touches the same file and the same lines as leaf 05 step 5. No
  other edge in this pack.
