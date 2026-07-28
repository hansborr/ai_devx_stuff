# 60. Nested relation writes could be closed at runtime by a Prisma `$extends` query guard, not only by a lint

Status: Proposed — design decided 2026-07-28, not started
Theme: Concurrency gate enforcement strength · Area: server · Severity: low · Size: M

Source: server-cluster pre-merge review panel, 2026-07-27 (raised by one
panelist as an option the branch's recorded option space never considered) ·
Confidence: high — the mechanism is standard Prisma, and the two facts it turns
on were verified on `feat/cq-server-cluster`

## Problem

Leaf 50 closed nested relation writes (`character.update({ data: { stats: {
update: … } } })`) with the nested branch of `local/concurrency-guard`, and
`docs/CONCURRENCY.md`, `docs/adr/0001-race-sensitive-writes.md` and
`utils/prisma-types.ts` are all careful to call it *defense in depth, not
closure*: a name-matching lint that a payload assembled through a helper call or
a spread still escapes.

Those documents present the option space as "close it in the type system, or
accept a lint". Type closure was rejected for good reason — the write goes
through the generated `Prisma.<Parent>UpdateInput`, which has no seam to
intercept per parent model. But there is a third option none of them names: a
**runtime** guard.

`packages/server/src/prisma/client.ts:12` constructs the client directly. A
`$extends({ query: { $allModels: { update, updateMany, upsert(...) } } })`
installed there could walk `args.data` for the same schema-derived
`<parent model>.<relation field>` table the lint uses (now shared by
`eslint-rules/concurrency-guard.js` and
`scripts/codemods/concurrency-guard/constants.ts`) and throw when it finds a
gated relation carrying a gated mutator.

That is **strictly stronger than the lint**: it inspects the payload that
actually reaches the driver, so it is unescapable by payload construction — the
spread, the helper call, the `let` binding, the two-hop binding and the
computed key all fail closed. It is also far cheaper than the rejected
"intercept the generated update-input types" option.

## Why this is a separate leaf, not part of the server cluster

- It is a **runtime** behaviour change on every Prisma write in the process, on
  a branch whose charter was an isolation-level fix and a lint. The blast radius
  (seeds, tests, migrations, e2e fixtures) is not reviewable inside that
  charter.
- `DbClient` deliberately omits `$extends` (`utils/prisma-types.ts`) so callers
  cannot re-widen the client. Installing an extension at construction is
  compatible with that, but the interaction has to be reasoned about and
  documented, not assumed.
- The lint stays useful either way: it fails at author time with a repair
  suggestion, where the runtime guard fails at request time.

## Steps

1. Decide the shared source for the relation table — today it is duplicated
   between the ESLint rule and the codemod constants, both checked against
   `schema.prisma` by `concurrency-guard-drift.test.ts`. A third copy needs the
   same drift coverage.
2. Prototype the `$extends` query guard in `prisma/client.ts` and measure the
   per-write cost of walking `args`.
3. Decide what it throws, and whether seeds/tests need a documented bypass.
4. Record the outcome in `docs/CONCURRENCY.md` and `docs/adr/0001` — including
   a "rejected" outcome, since the current text implies the option space is only
   type-closure versus lint.

## Decided — design panel, 2026-07-28

Three panelists (Opus 5, Fable 5, GPT/Codex with six internal angles) answered
this leaf independently against the live tree; the owner adjudicated. The
decisions below supersede the open questions in `## Steps` above. Size is
revised from **S to M, 4–5 commits**.

**Build the guard.** Unanimous. Two panelists independently produced *different*
worked examples that lint clean and type-check on `main` today:

```ts
campaign.update({ data: { characters: { update: { where, data: { stats: { update: … } } } } } })
campaignMember.update({ where: { id }, data: { character: { update: { stats: { update: … } } } } })
```

plus the same shape via `User.characters`, `Species.characters` and
`Background.characters`. The cause is not a missing table row: the rule's walker
carries the current model down only across *gated* edges and drops it on any
other hop, so **the gate is closed only at depth one** and the flat table
structurally cannot express the multi-hop case. **Reproduce at least one of these
before building** — leaf 50's throwaway-probe technique — and record it. If it
does not reproduce, stop and report; the justification goes with it.

**Artifact disposition.** Keep the ESLint nested branch as an *explicitly
non-authoritative* author-time diagnostic, rebased on generated relation
metadata — a squiggle with a repair suggestion is not redundant with a
request-time throw, and without it an unexercised bad path becomes a production
500 instead of an author-time error. Keep the restricted
`DbClient`/`TxClient`/`RawTxClient` boundary, the direct branch of
`local/concurrency-guard`, and the codemod's helper-shape halves. **Retire**
`scripts/codemods/concurrency-guard/nested-writes.ts` and its scanner wiring (a
hand-maintained clone whose only proof of equivalence is one shared corpus), the
flat `GATED_RELATION_FIELDS` table and its codemod copy, and
`concurrency-guard-nested-corpus.json` — that corpus exists to prove two static
implementations agree, and one of them is going away. Rewrite
`concurrency-guard-drift.test.ts` to guard the generated graph's freshness
against `schema.prisma` instead of comparing two static implementations.

**Source the graph by generation, not from Prisma internals.** Do not import
`config.runtimeDataModel` from `generated/prisma/internal/class.ts`; that file
warns against direct imports and is an internal surface that can shift on
upgrade. Promote the derivation `concurrency-guard-drift.test.ts` already
performs over `schema.prisma` into a generator emitting one checked-in module,
registered as a generated surface so the existing machinery owns its freshness.
Emit the **full** relation graph — every model, every `kind: "object"` field, its
target — so the walk keeps model identity across non-gated intermediates, plus a
precomputed transitive `canReachGated` map for the short-circuit. Emit
foreign-key ownership per edge (`source | target | implicit-join`), pairing each
relation with its inverse by explicit relation name or the unique unnamed
inverse; **fail generation** on an ambiguous or unpaired relation rather than
guessing.

**The v1 gating rule, and its deliberate non-goal.** v1 gates: while describing
model `M`, the walk enters relation field `f` whose target is in
`{CharacterStats, EncounterParticipant, Encounter, CharacterSpellSlot,
CharacterClass}` and the envelope under `f` carries `update`, `updateMany`,
`updateManyAndReturn` or `upsert`. Those write rows of the *target* model
regardless of FK ownership, which is why ownership is **not** a v1 criterion;
`create`, `connectOrCreate` and `delete` stay out of scope per current policy.

The documented non-goal: `connect`/`disconnect`/`set` write the *FK-owning*
side's row, so they can blind-write a gated row when the gated model owns the FK.
Worked example to cite — `Map.encounters` is the inverse side while gated
`Encounter` owns `mapId`, so connecting or disconnecting through `Map` updates
existing gated `Encounter` rows, whereas `MapToken.encounterParticipant` is
source-owned and correctly allowed today. This is why ownership is generated into
the artifact even though v1 does not gate on it.

`fix/cq-server-postmerge` later confirmed the same hole on a much more ordinary
call: `character.update({ data: { classes: { connect: { id } } } })` writes
`CharacterClass.characterId`, and the FK is on the gated side
(`schema.prisma:903`). It also found that the ESLint corpus case named
*"connect is not a write to the gated row"* generalises from
`mapToken.encounterParticipant`, where the FK is on the **non**-gated side — true
there, false for `character.classes`. Rename that case as part of this leaf, and
prefer `Character.classes` over `Map.encounters` as the worked example: it is
reachable from a call shape the codebase actually makes. Record it in the same paragraph
as the `create`/`delete` exclusion; one panelist argued for including it in v1
and lost on blast radius, not on correctness. Because `connect` is not gated in
v1, root `create` payloads need not be hooked. Register an explicit operation
list, not `$allOperations`, and drift-test that it equals the gated mutator set.

**Walk only schema-known keys.** Descend only into known relation fields and
known Prisma envelope keys of the current model — never arbitrary scalar or
`Json` objects. Otherwise the walk enters `Campaign.settings`, `Spell.classes`,
item `properties` and map-layer JSON: unbounded work over user data, and a
false-positive generator, since a `Spell.classes` value literally containing
`{ update: … }` would be flagged. Put that exact case in the payload corpus.

**Error, construction sites, bypass.** Throw a dedicated transport-neutral
programmer error carrying root model, root operation, relation path, nested
operation and gated model — not payload values. Do not map it to `CONFLICT`: no
race occurred, forbidden code executed. It should fail tests and surface as an
internal server error. **There is no bypass** — no env var, no `{ guard: false }`,
no exported raw factory, no test escape. Export a guarded `createPrismaClient()`
and route every query-capable construction site through it: production,
`prisma/seed.ts`, `prisma/seed-template.ts`, `src/test/prepare-test-db.ts`,
`src/seed/backfill-runner.ts`. Fixtures that set up gated rows via direct
delegate calls are unaffected — the guard closes nested routes, not the
sanctioned direct/helper surface; a fixture that trips it gets split, not
exempted. Pin the absence of an escape the way this repo pins its other
invariants: a test that the guard module reads no `process.env` and exports no
options object, and that `new PrismaClient` appears only inside the factory.
Prisma CLI migrations and `$queryRaw`/`$executeRaw` remain outside the guard —
**state that, do not gloss it.**

**`DbClient` and `$extends` — no conflict.** The omission exists so a *caller*
cannot re-widen a narrowed client; the extension is installed at the composition
root before any caller exists, and Prisma extensions are additive. Order:
construct → extend → narrow. Define `GuardedPrismaClient` from the factory's
return type and have `toDbClient` accept only that, keeping any widening at the
one already-sanctioned marked site, and revise the `prisma-types.test.ts` prose
claiming there is no runtime behaviour. **Pin, in the same commit that installs
the guard, that the extension applies inside `$transaction` in both the array and
interactive-callback forms** — two panelists flagged this as the assumption that,
if false, means the guard covers less than the docs would claim. If it does not
hold, stop before writing the doc rewrite.

**Documentation.** Four blocks currently assert the lint is the only enforcement
on this path and all four are load-bearing: `docs/CONCURRENCY.md`, the
`prisma-types.ts` header, `docs/adr/0001-race-sensitive-writes.md` (Consequences
plus its `enforced_by` front-matter), and the Status lines on leaves 50 and 60.
Also update `docs/guides/add-race-sensitive-mutation.md`. This is where the review
risk concentrates, not in the code — leaving them would have the docs *overstate*
the gate, the mirror image of the sin leaf 50 exists to correct.

## Verify

```
bun run test -- --project server src/utils/serializable-isolation.test.ts
bun run test:scripts:file -- scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts
```
