# 50. Nested relation writes reach every concurrency-gated table through a non-gated delegate, so neither the type gate nor the lint sees them

Status: **Done 2026-07-27** on branch `feat/cq-server-cluster`, merge
`6246c73cf`; see [Landed](./00-index.md#landed). Closed by **direction 1 only**
— the nested branch of `local/concurrency-guard`, an unratcheted hard error,
paired with a matching codemod finding and a schema-derived relation map. The
type closure (direction 3's alternative) stays refused for the reason in
`## Scope / caveats`. **The lint is defense in depth, not closure**: a payload
assembled through a helper call or a spread still escapes it, and
[leaf 60](./60-nested-write-runtime-guard.md) owns the runtime `$extends` guard
that would not. Read the Landed row before re-deriving any of this — the leaf's
six-name relation list and its "accept the false-positive rate" option were both
superseded during implementation.
Theme: Concurrency gate completeness · Area: server · Severity: medium · Size: M

Source: code-quality audit follow-up, 2026-07-26 (surfaced by the slice C review of leaf 01 step 8) · Confidence: high

**Evidence in this leaf is pinned to `5ff5751a` (`main`), not the pack's
`883d48bf`** — it was written after slice C landed and describes the gate as it
exists now. **This is pre-existing.** No landed slice introduced it; slice C is
only what made it visible, and slice C's own hardening documented it without
closing it.

## Problem

The concurrency gate is a *delegate-name* gate. `utils/prisma-types.ts` replaces
five delegates on `TxClient`/`DbClient` — `characterStats`,
`encounterParticipant`, `encounter`, `characterSpellSlot`, `characterClass` —
with restricted versions whose `update` / `updateMany` / `updateManyAndReturn` /
`upsert` are branded non-callable properties, and `eslint-rules/concurrency-guard.js`
mirrors that same five-name set. Every other delegate passes through untouched.

Prisma does not respect that partition. The gated tables are all reachable as
*relations* of non-gated ones, and a nested write through the parent's
`update` never touches the child delegate at all:

```ts
// `character` is not gated, so nothing below is a type error or a lint hit.
await tx.character.update({
  where: { id },
  data: { stats: { update: { currentHp: 0 } } },
});

await tx.campaign.update({
  where: { id },
  data: { encounters: { updateMany: { where: {}, data: { round: 99 } } } },
});
```

Both compile. Both lint clean. Both write to a gated table, and both skip the
`version`/compound-WHERE CAS machinery that `docs/CONCURRENCY.md` exists to
force — a lost update, which is the exact failure mode the whole gate is built
to prevent.

The reason is structural rather than an oversight in either enforcement layer:

- **The type gate cannot see it.** `RestrictedDelegates` narrows the five
  delegate *properties* on the client. `Prisma.CharacterUpdateInput` is a
  different type entirely, generated from the schema's relation fields, and its
  `stats?: CharacterStatsUpdateOneWithoutCharacterNestedInput` carries its own
  `update` / `updateMany` / `upsert` members. Nothing in `prisma-types.ts`
  touches the update-input types.
- **The lint cannot see it either, by construction.** `concurrency-guard.js`
  resolves a *member expression property name* (`gatedDelegatePropertyName`,
  `:72-78`) and asks whether it is in `GATED_DELEGATES`. It is looking at
  `x.characterStats`; a nested write spells the same table as an object key
  `stats:` inside a data literal, which the rule never inspects.

Both trust-boundary documents already say so, in one sentence each, and neither
treats it as work: `docs/CONCURRENCY.md:106-108` calls it "a pre-existing escape
outside this restricted-delegate surface" and
`packages/server/src/utils/prisma-types.ts:27-28` repeats it. Those two lines
landed in slice C (`b9973404`) as part of stating the gate's limits precisely.
**Documenting a hole is not closing it, and until this leaf nothing in the
backlog owned it.** That is the finding.

**What this leaf does not claim.** There is no such write in the tree today —
see Evidence. This is a gap in the gate, not a live lost update. It matters
because the gate's entire value is that a well-intentioned author cannot
accidentally write a gated row unguarded, and along this path they can, with
nothing to tell them: no compile error, no lint message, no marker comment, and
a payload shape that looks like ordinary idiomatic Prisma.

## Evidence

- `packages/server/src/utils/prisma-types.ts:122-128` — `RestrictedDelegates`, the five gated delegate properties; `:140` (`TxClient`) and `:166` (`DbClient`) `Omit` exactly `keyof RestrictedDelegates` and leave every other delegate raw.
- `eslint-rules/concurrency-guard.js:20-26` — `GATED_DELEGATES`, the same five names; `:28` — `GATED_MUTATORS`; `:72-78` — `gatedDelegatePropertyName`, which reads a member-expression property name and therefore cannot match a `stats:` key in an update payload.
- `scripts/codemods/concurrency-guard/constants.ts:14-24` — the third copy of the same two sets, in the scripts-project codemod. Any fix has to move all three together; `scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts` is the guard that they agree.
- Reachability, from the schema: `packages/server/prisma/schema.prisma:878` (`Character.classes`), `:879` (`Character.stats`), `:882` (`Character.spellSlots`), `:891` (`Character.encounterParticipants`), `:1139` (`Campaign.encounters`), `:1275` (`Encounter.participants`). Every one of the five gated tables is a relation of a non-gated parent.
- **Compile- and lint-verified at `5ff5751a`.** A throwaway probe module declaring `tx: TxClient` / `db: DbClient` and issuing all five nested writes (`character.update` → `stats.update`, `campaign.update` → `encounters.updateMany`, `character.update` → `spellSlots.updateMany`, `→ classes.updateMany`, `→ encounterParticipants.updateMany`) typechecks clean under `bunx tsc -b packages/server` and produces zero findings from `bunx eslint`. The probe was deleted; reproduce it before acting on this leaf rather than trusting the sentence.
- What is bypassed: `packages/server/prisma/schema.prisma:957` (`CharacterStats.version`) and `:1303` (`EncounterParticipant.version`) for the version-CAS tables, and the compound-WHERE form for the rest — e.g. `packages/server/src/utils/spell-slot-mutations.ts:64-70`, which writes `where: { id, used }` and treats `count === 0` as `CONFLICT`.
- **Zero occurrences in the tree today.** `grep -rn --include='*.ts' -E "(stats|classes|spellSlots|participants|encounters|encounterParticipants): \{ *(update|updateMany|upsert)" packages/server/src` returns nothing, and neither does the multi-line form. Nested `create` writes do exist and are deliberately out of scope — the gate covers updates only (`eslint-rules/concurrency-guard.js` mirrors `GATED_MUTATORS`, and `scripts/codemods/concurrency-guard/constants.ts:21-23` records that create/delete are outside it).
- `docs/CONCURRENCY.md:106-108` and `packages/server/src/utils/prisma-types.ts:27-28` — the existing one-line acknowledgements, both added by `b9973404`.

## Proposed direction

A hypothesis, not a spec. The two candidate closures are not equivalent in cost
and the cheap one is the recommendation.

1. **Extend `eslint-rules/concurrency-guard.js` to flag nested write keys.**
   Inside any `data:` / `create:` / `update:` payload passed to a Prisma
   `update`/`updateMany`/`upsert`/`create` call, flag a property whose key is one
   of the gated tables' relation names — `stats`, `classes`, `spellSlots`,
   `encounterParticipants`, `encounters`, `participants` — whose value is an
   object literal containing a `GATED_MUTATORS` key. Reuse the existing message
   and `DIRECT_WRITE_SUGGESTIONS` map so the diagnostic names the same helper the
   direct-call path names. Land it with the same allow-list carve-outs the rule
   already has (`isMutationHelperPath`, `isTypeTestPath`).
2. **Move all three copies together and let the drift guard prove it.** The
   relation-name set is a fourth thing the three copies must agree on
   (`eslint-rules/concurrency-guard.js`, `scripts/codemods/concurrency-guard/constants.ts`,
   and the delegate list in `packages/server/src/utils/prisma-types.ts`).
   `concurrency-guard-drift.test.ts` already parses the first and third; extend
   it rather than adding a fourth un-guarded copy. Read
   `docs/guides/lint-ratchet.md` first if this lands as a ratcheted count rather
   than a hard failure — it should not, because the current count is zero.
3. **Write it into the trust-boundary docs as closed rather than acknowledged.**
   `docs/CONCURRENCY.md:106-108` and the `prisma-types.ts` header both currently
   say the escape exists; both need to change in the same commit that closes it,
   or the docs will understate the gate.
4. **Add a negative case to the fixture set**, in the same shape as the existing
   direct-call fixtures, so a future refactor of the rule cannot silently drop
   the nested branch.

## Scope / caveats

- **The type-system closure is the obvious fix and is not recommended as the
  first move.** Making nested writes a compile error means intercepting the
  generated `Prisma.<Parent>UpdateInput` types for every non-gated model that has
  a gated relation, and rewriting the relevant nested-input members — surgery on
  generated types with no natural seam, repeated for each parent, and re-derived
  every time the schema grows a relation. It was judged not worth it against a
  lint that costs one rule branch. If someone does attempt it, it belongs in its
  own leaf with its own type-test file next to
  `utils/__type-tests__/raw-client-widening-restrictions.ts`, and the lint should
  land first regardless — a lint that fires today is worth more than a type
  closure that might.
- **A lint is a weaker guarantee than the branded-type gate, and the leaf should
  not pretend otherwise.** Leaf 01's step 8 exists precisely because a
  name-matching lint is escapable by renaming a binding. The same is true here: a
  payload built into a variable and passed by name will not be caught by the
  key-matching branch unless the rule follows the binding, which
  `resolveDeclaredVariable`/`resolveIdentifierBinding` already do for the delegate
  case and should be reused for this one. Say so in the rule's header rather than
  claiming closure.
- **`create` is deliberately out of the current gate and this leaf must not
  quietly widen it.** `scripts/codemods/concurrency-guard/constants.ts:21-23`
  records that create/delete variants are outside the restricted surface. A
  nested `stats: { create: … }` is an ordinary creation path; flagging it would
  fire on legitimate character-creation code. Scope the new branch to
  `GATED_MUTATORS` only.
- **`participants` and `encounters` are both relation names *and* ordinary
  domain words.** A key-name match will see `data: { participants: { … } }` on
  models that have nothing to do with `EncounterParticipant` if any are ever
  added. Match on the parent delegate as well as the key, or accept the false
  positive rate knowingly and record the decision.
- No sequencing dependency on any other leaf. Leaf 01 has landed; this is the
  part of the same trust boundary that it explicitly did not cover.
