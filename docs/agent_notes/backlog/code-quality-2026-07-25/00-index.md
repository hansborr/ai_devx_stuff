# Codebase Quality Audit — 2026-07-25

Status: Parked evidence pack — no leaf is promoted automatically
Created: 2026-07-25
Updated: 2026-07-28 — twenty-five leaves completed across ten deliveries (see
[Landed](#landed)); all six XL leaves have a scheduling plan, leaf 53 has one
too, and the client, harness, shared and server/comments clusters have one each;
thirteen leaves (50 through 62) were added from later implementation reviews,
planning sessions and merge panels, and five of those (50, 51, 52, 55, 61) have
since landed; owner decisions are now recorded for leaves 53, 54 and 55
Scope: Refactor / rewrite / simplification opportunities across `packages/{shared,server,client}`, the in-repo AI/dev harness (`scripts/`, `tools/`, `eslint-rules/`, `eslint-config/`), and the test suite.

Focus: maintainability, idiom, entrenched layout and structure, large comment
blocks, and naming (including single-identifier renames).

## Read this first

The three sections of a leaf carry different weight, and you should read them
accordingly.

- **`## Problem` and `## Evidence` are load-bearing.** Every claim carries a
  `path:line` or a measured count. Evidence is pinned to a commit and line
  anchors rot as unrelated work lands — re-resolve by symbol name before acting
  on one, but expect the claim itself to hold.
- **`## Proposed direction` is a hypothesis, not a spec.** Of 62 leaves,
  twenty-five have now been implemented (see [Landed](#landed)); the other 37
  have not, and
  28 of those have had theirs superseded by a plan — the six XL leaves
  individually, leaf 53 individually, and the client, harness, shared and
  server/comments clusters
  collectively. **Leaves 53 and 54 carry owner rulings on top of that:** both are
  recorded under `## Decided direction`; both are ready to schedule but remain
  unpromoted, and neither ruling decides sequencing. For 53, read
  [53-PLAN.md](./53-PLAN.md) *and* the ruling — the plan decides how, the ruling
  decides what, and the plan does not re-open it. 54 is plan-free. Several leaves have an
  obvious fix that is wrong: a render-phase Zustand reset, a formula that
  silently changes `proficiencyBonus(21)` from 2 to 6, a runtime import cycle, a
  schema change that strips legacy persisted homebrew keys. **Read
  `## Scope / caveats` before you start** — that is where the "the obvious fix
  here is wrong, and here is why" reasoning lives.
- **Six leaves are XL (07, 27, 28, 34, 40, 42), and each now has a scheduling
  plan** — `07-PLAN.md`, `27-PLAN.md`, `28-PLAN.md`, `34-PLAN.md`, `40-PLAN.md`,
  `42-PLAN.md`, linked from their rows in [Leaves](#leaves). **Read the plan
  before the leaf.** Every plan supersedes its leaf's `## Proposed direction`
  after a cross-model consult, and most re-scope the leaf substantially — 34, 40
  and 42 come out of the XL bracket entirely, and steps are dropped in all six.
  The size and XL markings in the table below, and the caveats and dependency
  edges quoted from the leaves, are therefore **the leaf's view, not the plan's**:
  each plan carries its own "Index reconciliation" list and applies it when its
  first slice lands, so this index deliberately still reads as the pre-plan
  state for 07, 34, 40 and 42. (27 and 28 have had their dependency edges
  corrected here already.)
- **Four clusters of non-XL leaves also have a plan; this completed planning for
  the original 49-leaf audit set** —
  [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md) (08, 09, 10, 12,
  13, 14, 15, 16, 17, 48), [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md)
  (29, 30, 31, 32, 33, 35, 36, 49),
  [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md) (18, 19, 20, 21, 22, 23, 25,
  26) and [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) (02, 03, 04, 05,
  06, 44, 45, 46). Later review leaves 50-60 stand alone unless their row names
  a relationship to one of those plans; the decisions in 53 and 54 do not add
  them to a cluster plan. **Leaf 53 has its own scheduling plan**,
  [53-PLAN.md](./53-PLAN.md), written after the owner ruling and superseding the
  leaf's implementation sketch — but **its "Index reconciliation" list is not
  applied yet**: it applies when slice T1 lands, so row 53 below still carries
  the leaf's `L` size and its `+ socket` area, both of which the plan corrects.
  **The same rule applies to a planned leaf: read the plan, not the leaf.** See
  the note under [Leaves](#leaves) — the plans shrink or drop work the rows below
  still list at full size, except for the shared and client rows, whose
  reconciliations have been applied.
- **`SERVER-COMMENTS-PLAN.md`'s two headline verdicts, so they are not
  re-planned.** First, **the server boundary layering is sound** — not one of
  leaves 02, 03, 04 or 05 contains a finding of the form "this logic is in the
  wrong layer", except leaf 05 step 5, and
  `packages/server/src/services/README.md:203-207` already records that one as
  known and deliberately scoped out of an earlier audit. Two independent consults
  reached that verdict separately. What the four server-boundary leaves actually
  hold is an unenforced type boundary (02, the cluster's best single change), an
  API-shape inconsistency inside a correct authorization model (03), cleanup left
  behind a *finished* migration (04 — its "half a boundary" headline overstates
  it and the plan does not adopt that framing), and stale docs plus one
  private-API reach-in (05). Second, **leaves 44, 45 and 46 are roughly
  three-quarters busywork**: the plan keeps about a quarter of them — the subset
  where the string is data reaching a second audience, or where a name produces a
  wrong answer — and refuses the rest. The plan also surfaced two live defects no
  leaf recorded; both are now written up, as leaves 51 and 52.
- Four leaves name their own split before scheduling: 40 (three leaves), 31
  (three leaves, its L rating being per-part), 27 (two leaves) and 07 (three
  streams). Leaf 01 is optionally splittable at its steps 1-6 / 7-8 seam.

## Executive summary

**The application code is in better shape than the harness and the test suite,
and the two halves should be scheduled differently.** The application has no god files (the largest
hand-written server source is 561 lines), the router/service layering documented
in `packages/server/src/services/README.md` holds in the large (leaf 05 collects
three narrow drifts and one stale MODULE doc, not a broken layering), schema
naming across the shared package is disciplined (124 `*InputSchema` exports, each
paired with its inferred `*Input` type), every non-test script is reachable, no
generated file has been hand-edited, e2e uses page objects throughout with zero
`waitForTimeout`, and the client package contains no TODO/FIXME/HACK markers at
all.

The harness and the test suite are a different story: a 2,526-line shell script,
a 2,761-line test file, a 603-line untyped shadow router, and several unfinished
migrations all live there.

The debt that does exist is a **mixture**, not one thing. In rough order of how
much of the pack it accounts for:

1. **Duplication that should have been extraction** — the largest single group.
   The codebase repeatedly solved a problem correctly once, then paid for that
   solution by copy-paste: 21 identical casts with 21 identical justification
   comments (leaf 01), a 10-line test preamble in 90 files (leaf 39), 44 shell
   files each redefining `fail()` (leaf 27), eleven hand-written copies of one
   shell finding shape and three copies of one path normaliser (leaf 31).
2. **Weakly typed boundaries** — a hand-written shape replaces a generated one and
   the lost information is bought back with casts (leaves 01, 07, 11, 24, 41).
3. **Incomplete migrations left readable as active contract** — vestigial
   wrappers, a dead re-export shim, a half-applied test-helper migration, and a
   shipped migration recipe for a finished migration (leaves 04, 26, 39, 44).
4. **A shared substrate created and then only partly adopted** — `scripts/lib`'s
   `parseCli` has 10 importers against 19 hand-rolled argv walkers, and its
   canonical `PROCESS_ARGV_USER_ARGS_START` is imported by 4 of the 42 files that
   carry the offset, against 32 local re-declarations under seven different names
   (leaf 30). `eslint-rules/ast-helpers.js` is the counter-example and shows what
   "finished" looks like: 16 of the 32 registered rules import it plus two shared
   helper modules, and no local `unwrapChain`/`staticPropertyName` copy remains.
   Leaf 38 is scoped to `parentOf` (seven definitions across two competing homes) and
   `isFunctionNode` (four sites, three semantically distinct bodies — one throws
   where the others return `false`, so a blind codemod changes rule behaviour),
   the rule-registry ordering, and config tests parked in the wrong project.
5. **Conventions documented but unenforced** — `scripts/README.md` states a
   directory rule that 62 top-level files across seven flat families violate
   (leaf 28).
6. **Orientation contracts missing where the charter requires one** — the 87-file
   `components/sheet/` (leaf 48), `scripts/drift-ai/`'s 344 modules and the
   `scripts/` layout as a whole (leaf 28), and the fixture copy-set analyzer
   inside `scripts/path-policy/` (leaf 49 — the only one scoped to a single
   sub-tool rather than a whole directory family).
7. **Real modelling and contract defects.** These are not stylistic. Leaf 19 was
   a live rules defect: versatile weapon damage was silently dropped because one
   SRD concept is spelled `versatileDice` in one half of the codebase and
   `twoHandedDice` in the other, with nothing translating between them (fixed
   2026-07-26 — see [Landed](#landed)). Leaf 51 is the second: the prepared-spell
   limit counted, then wrote, with no transaction and no CAS, in a repo that has
   a documented pattern and three enforcement layers for exactly that shape
   (fixed 2026-07-27 — see [Landed](#landed)).
   Leaf 50 is the gap those enforcement layers left — every gated table was
   writable through a nested relation write on a non-gated delegate, which
   neither the branded type nor the name-based lint could see (closed by lint
   2026-07-27 — see [Landed](#landed); leaf 60 holds the stronger runtime
   closure). Leaf 58 is the
   third, and it is the counterpart to 51 rather than more of it: character
   creation writes six prepared level-1 spells for a wizard whose cap is four,
   with no concurrency involved at all, because creation makes no cap check —
   the same invariant, enforced on one of its two writers.

### Comment density

**Comment volume is a narrow problem, not a broad one.** Measured
comment density is healthy in the large files: `verify-engine.sh` 8%,
`policy.sh` 13%, `worktree-db.sh` 14%, `doctor.sh` 20%. Twelve files across
`eslint-rules/`, `eslint-config/` and `tools/` exceed 40% comment density, but
ten of them are under 100 non-blank lines, where the ratio says little; the two
substantial ones are `eslint-config/max-lines-exceptions-codec.js` (60%) and
`eslint-config/restricted-syntax-builder.js` (50%). Judge long blocks one at a
time: most are **load-bearing and must be kept verbatim** — the
concurrency trust-boundary headers, the auth timing-oracle explanation, the
Socket.IO disconnect ordering note, the AoE coordinate model, the Zustand
callback-after-commit invariant, and the SRD geometry derivations among them.

The real comment problem is two specific things, leaves 44 and 45:

- **Archaeology shipped as contract** (leaf 44) — comments recording the change
  that produced the code rather than what the code does: bare leaf and task ids
  (`arch-plans-2026-07 leaf 02`, `DX5.3c-DX5.3f`), a spike record for a rejected
  design, a migration recipe for a finished migration, an anchor to a deleted
  `awk` script, `(done)` follow-ups. Some of these strings reach two audiences
  beyond the source file: four render into `docs/generated/harness-controls.md`,
  and `scripts/lint-ratchet/diagnostics.ts` puts the same `principle` text into
  the agent-facing regression envelope.
- **Comments compensating for code** (leaf 45) — where the fix is a rename, an
  extraction, or a type. Sharpest case: a file header claiming a compile-time
  guarantee the types do not actually provide.

### Naming

Leaf 46 collects the pure renames, with more in 17, 36
and 37. Representative: a variable named `action` holding a `ChatMessage`;
`finishTopLevelCommand` which runs the command rather than finishing it; an
`is_*` shell helper whose payload is stdout rather than a boolean, sitting beside
a sibling that signals success with a *nonzero* exit (leaf 37 — two neighbouring
functions with two different defects: rename the first and leave its return codes
alone, un-invert the second); `EpochWindow` carrying an exit code; `testId`/`tests`
throughout a lint kernel with nothing to do with tests; one entity spelled
`w`/`h` in one module and `width`/`height` in its sibling.

## How to use this pack

- **One leaf = one coherent piece of work**, usually several commits — with four
  exceptions that name their own split before scheduling: 40 (three leaves), 31
  (three leaves, its L rating being per-part), 27 (two leaves) and 07 (three
  streams). Leaf 01 is optionally splittable at its steps 1-6 / 7-8 seam.
- **Check "Scope / caveats" for a dependency before promoting.** Many leaves have
  one. Server: 04→05, 05↔45, 05↔46, 06↔07, and `52→06 step 2` — **that one is
  now satisfied**: leaf 52 landed in merge `6246c73cf`, so leaf 06 step 2 can
  register the four generators as `packages/server` scripts without breaking
  them. Leaf 05 step 5 also survives leaf 51's landing and was deliberately not
  absorbed by it; see the leaf 51 row in [Landed](#landed). Client: use
  [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md#dependency-edges), not the
  superseded leaf chain. Its C2→C3, V1→V2 and C3→V2 edges are satisfied in
  merge `6cf8c78d5`; the eight open slices have no hard edge. F2 follows F1 only
  as a homebrew-tree sequencing preference, and Q3 inherits the ratchet state
  C4 already improved. Shared:
  **none from the leaves** — the one edge they recorded (`21 step 5↔22 step 5`)
  was never semantic and is dissolved; the cluster's real edges live in
  [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md#dependency-edges) and are
  between *slices*, not leaves (`I1→I2→I3` hard; everything else soft or absent).
  Harness: 28.1→29 and 27.2→27.3→32 step 4, both as
  re-derived in [27-PLAN.md](./27-PLAN.md) and [28-PLAN.md](./28-PLAN.md) — the
  plans supersede the leaves' own wider edges (`28 steps 1-2→29` and
  `27 steps 1-4→27 step 5`), which over-block leaf 29 and leaf 32 behind work
  those leaves do not need. Leaf 27's pre-commit extraction (plan slice 27.3)
  still owns the `scripts/tests/test-pre-commit.sh` name and the smoke-subject
  regeneration; leaf 32 consumes it and writes no gate coverage of its own.
  27 and 32→31 step 13, 31↔49. Tests: 39→40, 47→42 (sequence 47 first so 42
  restructures against typed `e2e/helpers/api.ts` calls) — **both upstream ends
  are now satisfied**: 39 and 47 have landed, so 40 and 42 are unblocked.
  The harness edges above are the leaves' own; see the note under
  [Leaves](#leaves) — its cluster plan re-derives them.
- **Re-verify `path:line` before implementing.** Evidence in leaves 01-49 is
  pinned to `883d48bf`; leaves 50, 51 and 52 were written later and pin their
  own anchors to `5ff5751a`, each saying so in its header. Anything written
  during the slice-D bookkeeping pass — the slice-D rows in [Landed](#landed)
  and the four rows added to
  [Constraints on future proposals](#constraints-on-future-proposals) — pins its
  anchors to `7a4b10ac`, which is `main` at that point. Line anchors move
  quickly — if a citation does not land, resolve the symbol by name rather than
  assuming the finding is stale. Anything newly written during the
  shared-cluster bookkeeping pass — the leaf-18/20 rows in [Landed](#landed),
  leaf 41's partial-hardening note, the class-semantics follow-on in
  [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md), and the whole-tree
  straggler constraint — pins new anchors to `ec4d732c4`, current `main` for
  that pass.
- Anything newly written during the final shared-cluster bookkeeping pass —
  the leaf-22/23/26 rows in [Landed](#landed), the final shared-plan outcomes,
  and the two new standing checks in
  [Constraints on future proposals](#constraints-on-future-proposals) — pins
  its anchors to `75bad57dc`, current `main` for that pass.
- Leaf 53 was written from the final shared-cluster review and pins its complete
  evidence set to `75bad57dc`, which remains `main`; its header says so.
- Anything newly written during the client-cluster bookkeeping pass — the
  client rows in [Landed](#landed), client-plan outcomes, transferred leaf-46
  evidence, and the strengthened documentation/straggler constraints — pins
  new anchors and counts to `6cf8c78d5`, current `main` for that pass.
- Leaf 54 was written from the client-cluster pre-merge review and pins its
  complete evidence set to `6cf8c78d5`; its header says so.
- Anything newly written during the leaf-53/54 owner-decision pass — the
  decisions, the leaf-54 route reader/emitter sweep and the reconciled rows
  below — pins new anchors to `2decbb56a`, current `main` for that pass. The
  original leaf evidence remains pinned to the commits declared above.
- Leaves 58 and 59 were written from the server-cluster review rounds and pin
  their evidence to `f16079c2f`; leaf 60 came from that branch's pre-merge panel
  and pins to `b16000968`. Anything newly written during the server-cluster
  bookkeeping pass — the leaf-50/51/52 rows in [Landed](#landed) and the two new
  [Constraints](#constraints-on-future-proposals) rows — pins its anchors to
  `6246c73cf`, current `main` for that pass. **Leaf 51's landing moved
  `character-spell.ts`**: `togglePrepared`'s body now lives in
  `packages/server/src/utils/prepared-spell-toggle.ts`, so every leaf anchor
  into that router below `add` has shifted. Resolve by symbol.
- **Read "Scope / caveats" first.** See "Read this first" above.
- **Follow TDD and the relevant guide** under `docs/guides/` before tRPC, Prisma,
  socket, race-sensitive, client cache/socket, e2e, rules, or ratcheted-lint work.
- **Promote per the backlog README rules** — one leaf at a time, into
  `in_progress/`, after an owner priority call. This is not a second ready queue.
  The backlog README's entry for this pack is derived from this index; keep them
  in step.

## Suggested first slice

Ordered for payoff-per-risk. **Items 1-6 landed on 2026-07-26** — see
[Landed](#landed); item 7 is the next candidate. Leaf 47 landed alongside 39 as
its sequencing partner (`47→42`). Item 1 is
[SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)'s own nominated first slice,
inserted here when that plan's index reconciliation was applied; it had already
landed by then, so it is recorded rather than advised.

1. ~~**W1** (XS, leaf 19 steps 1-2, per
   [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)) — the pack's only live
   user-visible defect: versatile weapon damage silently dropped because
   `enrichFromSrd` reads `versatileDice` and never falls back to the
   `twoHandedDice` the writers store. One `??` in one adapter, red-first.~~ Done
   in slice C, alongside item 6.
2. ~~**Leaf 24** (XS) — a one-annotation fix removing a cast and nine erased
   types.~~ Done.
3. ~~**Leaf 11** (M) — swap `string` for the existing `MapTool` union; one
   misleading JSDoc and one `type-assertion-boundary` marker go away, and a typo
   in any of the six `tools: new Set([...])` literals becomes a compile
   error.~~ Done.
4. ~~**Leaf 43** (S) and **leaf 37** (S) — small, self-contained, low risk. Note
   leaf 43 opens with a feasibility check that may stop the leaf.~~ Done; the
   feasibility check did fire, and was resolved rather than obeyed (see
   [Landed](#landed)).
5. ~~**Leaf 39** (L) — the largest line reduction in the test suite. Only step 6, the
   90-file `useTestApp()` sweep, is mechanical; the rest of the leaf changes
   failure behaviour, adds fixture APIs, and touches DB teardown.~~ Done, with
   steps 5 and 7 skipped (see [Landed](#landed)).
6. ~~**Leaf 01** (L) — the highest-value structural item, but read its caveats: the
   safe version is five file-local helpers, not one global one, and its payoff is
   compile-time checking, not runtime behaviour — Prisma already rejects unknown
   arguments.~~ Done, with step 2 skipped as the leaf itself instructs. The
   caveat held (five file-local helpers, no global `toRawTx`), and step 8 also
   closed a structural hole in the guard it was built on — see
   [Landed](#landed).
7. **Leaf 02** (M per [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md), slice
   S1) — the next candidate, and the one both server consults ranked first. It is
   the only item in the pack where a rename silently disables every broadcast at
   runtime with nothing failing to compile.

**Do not start with:** leaves 29, 32 (four-figure bash and the commit gate itself —
highest operational risk in the pack), or any XL leaf (07, 27, 28, 34, 40, 42)
without reading its `NN-PLAN.md` first. Each XL leaf now has one, and the plan —
not the leaf — is the schedulable unit.

## Landed

Twenty-three leaves were implemented and merged into `main` across 2026-07-26 and
2026-07-27, in eight deliveries: leaves 24, 11, 37 and 43 on branch
`feat/cq-slice-a` (merge
`0d6f0f8c`), leaves 39 and 47 on branch `feat/cq-slice-b` (merge `70ed2540`),
leaves 19 (in part) and 01 on branch `feat/cq-slice-c` (merge `028a21d5`), and
leaves 21 and 25 plus the remainder of 19 on branch `feat/cq-slice-d` (merge
`7a4b10ac`); leaves 18 and 20 then closed across six shared-plan slices on
branch `feat/cq-shared-cluster` (merge `ec4d732c4`); leaves 22, 23 and
26 closed across seven landed slices plus one deliberate decline on branch
`feat/cq-slice-f` (merge `75bad57dc`); leaves 48, 09, 10, 12 and 13 then closed
across the client cluster's first seven slices on branch `feat/cq-slice-g`
(merge `6cf8c78d5`); and leaves 50, 51 and 52 closed on branch
`feat/cq-server-cluster` (merge `6246c73cf`). Their rows in
[Leaves](#leaves) are marked **Done** and each leaf note carries the same
status. Leaf 55 then landed as the ninth delivery on branch
`feat/cq-common-language-ownership` (merge `137cd7991`) on 2026-07-28, and leaf
61 as the tenth on branch `fix/saving-throw-proficiency-identity`. No other leaf
in this pack is complete.

**Leaf 61 is the pack's first entry that was not found by an audit.** It came
out of a reviewer tracing consumers on an unrelated branch, was verified as a
live gameplay defect rather than a cleanup, and is the only leaf here whose
severity is `high`. Leaf 62 is its deliberately deferred half.

**Slice D was the first slice scheduled from a cluster plan rather than from
leaves.** It landed seven of [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)'s
twenty-two slices — W2, A1, D1, D2, K1, K2 and K3 — which is what completes
leaf 19 and closes leaves 21 and 25. The plan's `## Slices` table now records
per-slice landing state; read it, not this section, when picking the next shared
slice.

**The shared cluster is finished.** Its last delivery landed S1, S2, S3, U1,
U2, E1 and E2, closing leaves 22, 23 and 26. Twenty-one of the plan's
twenty-two slices landed. The remaining slice, U3, is **closed-declined**, not
open work: all three pre-merge panelists endorsed skipping it because its four
`campaignId`-only socket payloads are independent wire contracts in different
directions that merely coincide in shape. With nothing to extend, derivation
could only alias them to one schema object, weakening both the registry's
schema-identity assertion and the typechecker's signal for a mis-wired event,
for a realistic saving of about 8 lines out of 188. Do not re-open U3.

**The client cluster is in progress.** Its first delivery landed C1, C2, C3,
C4, V1, V2 and O1, closing leaves 48, 09, 10, 12 and 13. Eight slices remain:
N1, Q1, Q2, Q3, F1, F2, X1 and O2. Read
[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md)'s `State` column rather than
inferring pickup work from the leaves.

**`feat/cq-server-cluster` is not a
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) delivery**, despite the
branch name. It landed the three standalone server leaves the plan's writing
*produced* — 50, 51 and 52 — and touched none of that plan's slices. Leaves 02,
03, 04, 05, 06, 44, 45 and 46 are all still open, and leaf 02 remains the
[Suggested first slice](#suggested-first-slice)'s next candidate.

**The branch's largest durable output is a correction to `docs/CONCURRENCY.md`,
`docs/adr/0001-race-sensitive-writes.md` and `services/rest-MODULE.md` that no
leaf asked for**, and it should not be re-derived from scratch by the next
race-sensitive change. All three had claimed for months that long rest's
`isolationLevel: "Serializable"` transaction is protected because Postgres SSI
detects read/write anti-dependencies with a concurrent `performLevelUp`. **It
does not.** `performLevelUp` passes no `isolationLevel`, so it runs READ
COMMITTED, and Postgres tracks anti-dependencies only *between* serializable
transactions. What actually protects long rest is **first-updater-wins on the
`CharacterClass` rows `resetAllHitDice` writes** before `syncSpellSlots` runs.
This was settled by probing the real database — a serializable/READ COMMITTED
anti-dependency pair commits both sides 15/15, the same pair with both sides
serializable aborts one 15/15, and the first-updater-wins abort fires 10/10 —
and is now pinned by `packages/server/src/utils/serializable-isolation.test.ts`
so the prose cannot drift back. A second correction rides with it: under
`@prisma/adapter-pg` a serialization abort has **two** shapes, and the repo's
retry predicate previously matched only one. A statement-level abort
(first-updater-wins, long rest's case) maps to Prisma's `P2034`; an abort raised
at an interactive `COMMIT` (SSI's usual reporting point, and the prepared-spell
toggle's case at 17:1 in a measured four-way race) escapes as a bare
`DriverAdapterError` with `cause.kind === "TransactionWriteConflict"` and **no
`code`**. `rest-service.ts`'s local P2034-only predicate could therefore never
fire, so long rest's Serializable retry was dead code; the predicate now lives in
`utils/prisma-errors.ts` as `isPrismaSerializationFailure`, matches both shapes,
and is shared. Neither branch is dead — do not "simplify" it back to one.

Each of the three leaves landed red-first behind a reproduction, and the branch
carried a Codex review pass plus a **five-model** pre-merge panel — two models
larger than the three-model panels the earlier slices used. **Only three of its
twenty-one commits are the implementations**; two file the new leaves and the
other sixteen are review and panel fixes, five of which correct claims the
branch itself had introduced and then had to walk back — the P2034 story was
rewritten three times before it was measured (see the leaf 50 and 51 rows). The panel
and the adjudication pass that followed filed three new leaves rather than
widening the branch: **58** (creation writes over the prepared cap — a rules
defect, no concurrency involved), **59** (`characterSpell.add`'s P2002 surfacing
as a 500, plus a P2025 window leaf 51's in-transaction re-read newly opens) and
**60** (the runtime `$extends` guard that would close leaf 50's remaining
escapes). None is implemented.

Each slice went through a Codex review pass and a three-model pre-merge panel
before landing, and each landed behind a full sequential `verify`. Where the
implementation diverged from the leaf's `## Proposed direction`, the Outcome
column records the divergence and why — a skipped step is a recorded decision,
not an oversight, and should not be re-scheduled from the leaf.

**One process note, for whoever lands the next server-side leaf.** Slice C's
regression was caught by the land gate and *not* by `verify:changed`:
`scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts` textually
parses `packages/server/src/utils/prisma-types.ts`, and the boundary rework broke
its parser, but the `scripts` slot is outside changed-mode scope for a
server-only diff (fixed in `4da1764f`). Any leaf that changes the *shape* of a
file a scripts-project drift guard parses — `prisma-types.ts`,
`eslint-rules/*.js`, the harness manifests — should run `bun run verify` rather
than trusting `verify:changed`. Logged at
`/home/node/persist/musi/pain_points.log` under "2026-07-26 — `verify:changed`
can omit the scripts-project drift guards"; it is a harness gap, not a finding
against this pack. **Leaf 50 was the next leaf that shape applied to** — it
rewrote `eslint-rules/concurrency-guard.js`, `concurrency-guard-drift.test.ts`
and the codemod together — and the note did its job: the drift guard became the
seam the branch built on rather than something it broke, and the guard now
derives its map from `schema.prisma` instead of parsing a hand-copied list.

| # | Commits | Outcome |
|---|---|---|
| 55 | rules: `0d97cfa3a` · server: `50cfd2479` · migration: `bc39286cc` · client: `133edc7fd` · review: `c77734de5`, `1c5019fb9`, `96e71b9e6` | **Done with the owner-ruling backfill.** `starting-languages.ts` names Common as the SRD 5.2.1 universal starting language, and `deriveProficiencies` composes it for every authenticated `character.create` caller. Helper, direct-service, router and player-visible E2E tests cover the invariant; caller-supplied expert Common remains one expert row under exact `type:name` de-duplication, while a separate derived-only test fails if server derivation is removed. Identity is deliberately case- and whitespace-sensitive to preserve open custom/imported proficiency labels; canonical Common is added alongside `"common"` or `" Common"`, and the migration records the same irreversible choice. The idempotent data migration adds Common only where missing and was verified against missing/existing fixtures plus a second execution; the repo has no per-migration behavior-test convention, so no one-off harness was added. The client injection was removed deliberately, both wizard display sites now consume the shared helper, and mutation input represents player choices. The proficiency step displays Common by default; the review step's pre-existing no-extra-language gate still hides the Languages summary and is recorded as follow-up scope. All pinned evidence paths still existed in the live tree; the leaf's only original factual correction is that `character.create` is a protected authenticated mutation, not an unauthenticated public procedure. |
| 48 | C1: `82b65a724` | **Done as planned.** The 87-file sheet directory now has a charter-complete `MODULE.md` and generated index row, with stable external entry points separated from page-private implementation and the both-responsive-trees mount invariant recorded. No directory split landed. |
| 09 | C2: `7157b9ee6`, `bcf6ef559` · review: `8c8725e14` | **Done, cut to the plan's S-sized reset contract.** All four tool-reset paths share `buildToolReset`; the later review pin distinguishes viewport semantics, so only `resetTransient` returns the stage to origin. The action creators are grouped by concept rather than the old line-count story. Steps 3 and 4 remain dropped. |
| 10 | C3: `b2e401433` · C4: `2bf519846` · review/fix: `e19f558c6`, `9c3eca901`, `8c31d9f64`, `1f12e369a` | **Done, with a real regression reproduced and fixed red-first.** C4 deleted the render-state sync effect. C3 centralized layout-effect resets, but the first version inverted reset-versus-selection-sync ordering: a pre-mount participant selection left `selectedTokenId` set after `selectedParticipantId` cleared. The fix re-reads the combat store inside `useSelectionSync` while keeping `selectedParticipantId` subscribed only as a re-run trigger; the site documents why that apparently redundant shape is load-bearing. The read gate and derived-selection steps remain dropped. |
| 12 | V1: `07f45793b`, `bbe5314e2`, `3503f0284`, `f3d2ce0a3`, `f92d01706` · V2: `a3912f37b`, `3501ec2ed`, `a35f62474`, `29c341625`, `6a56afe6b`, `389a0e749`, `a8743886e`, `4d27ec80b` · review: `0cc4342f8`, `fa2bb8586`, `bec3b377f`, `fccb58539`, `bf89b8ddc` | **Done, with the server predicate aligned and the campaign-id expansion deliberately excluded.** Membership role is now the one DM predicate and the viewer scope crosses the installed Konva Stage. The change is correct but currently unobservable: campaign creation writes the creator as the only DM, invites write players, and no role-promotion endpoint exists. Remaining behavioural `isDm` props at InitiativeTracker Next Turn and MapCanvas token dragging are real boundaries, not half-migrations. The character-sheet URL/campaign-link mismatch is leaf 54. |
| 13 | O1: `3bbeb3078` | **Done with only the option-free unit kept.** Token context-menu state is shared; MapCanvasFrame, panel primitives and `handleTokenMoved` remain deliberately unextracted. The rest of the leaf is dropped, not deferred. |
| 50 | impl: `0faf39748` · review/fix: `6db2231f1`, `591a8dd01`, `88fb8ba74`, `1574af543`, `fa18242f9`, `9fdfdd5d9`, `b16000968` | **Done via the lint route (direction 1), and it shipped as an unratcheted hard error.** The nested branch of `local/concurrency-guard` now flags `character.update({ data: { stats: { update: … } } })` and its nine siblings. Current tree count is zero, so it lands as a plain error with no `lint-ratchet.baseline.json` entry — read `docs/guides/lint-ratchet.md` only if that ever changes. **The leaf's relation-name list was wrong and the fix was to stop hand-listing.** The leaf proposed six names; `schema.prisma` actually declares ten paths to a gated model, including `MapToken.encounterParticipant`, `CombatLog.participant`, `CombatLog.encounter` and `Class`/`Subclass.characterClasses`. `scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts` now **derives** the relation-field→gated-delegate map from `schema.prisma` and fails if either enforcement copy drifts, so a new relation to a gated model breaks the guard instead of silently widening the escape. **The leaf's "match on the parent delegate as well as the key" caveat was live, not theoretical**: the first cut produced two reproduced false positives on a hard-error rule — `spell.update({ data: { classes: { update: … } } })` (`Spell.classes` is a `Json` scalar; `Character.classes` is the gated relation) and a non-Prisma `store.update({ where, data: { stats: { update: … } } })`. Both detectors now key on `<parent model>.<relation field>` and require a `<client>.<model>` receiver. Cost recorded rather than hidden: a gated relation reached *through* a non-gated relation envelope is no longer flagged. Three more escapes were found and closed after the first cut — a value that is not a Prisma payload shape, a `satisfies`/`as`/`!` wrapper (the spelling AGENTS.md pushes authors toward), and shorthand `{ stats }`, which the ESLint rule caught and the codemod did not. **The codemod is paired, not incidental:** its nested detector moved into `scripts/codemods/concurrency-guard/nested-writes.ts` with the rule's rooting and binding resolution, and `eslint-rules/concurrency-guard-nested-corpus.json` is run through *both* implementations from their own suites, because the old drift guard compared copied name maps rather than detector behaviour and the two had already diverged. `repairKind` dropped from `codemod` to `manual`: splitting a parent write from a gated write is a judgement call about transaction boundaries, so the generated agent-facing docs no longer point at a codemod that cannot repair a nested finding. **Direction 3 held**: `docs/CONCURRENCY.md`, `docs/adr/0001-race-sensitive-writes.md` and `utils/prisma-types.ts` now say the escape is closed *by a lint*, explicitly weaker than the branded-type gate — a payload assembled through a helper or a spread still escapes. Leaf 60 is the runtime closure that would not. The type-closure direction stays refused for the leaf's own reason. |
| 51 | impl: `4866df17b` · review/fix: `a8e19781f`, `0be7f1bbe`, `23c57d057`, `1df14756a`, `5b0d29b85`, `41d11c82a`, `1ecf192f4`, `d4cbdeb0b`, `624acf652` | **Done via the transaction route, at `isolationLevel: "Serializable"`, and the leaf's "answer what stops both callers in one sentence" test is the reason the record below is long.** None of Patterns A/B/C fits: the cap is a *set-level* invariant ("at most N of this character's non-cantrip rows are prepared"), so there is no version column, no counter that is the lock key, and no single-row `where` that can encode a count of siblings. The read and the write now share one Serializable transaction in `packages/server/src/utils/prepared-spell-toggle.ts`; SSI sees each transaction's `prepared = true` write land inside the predicate the other one counted and aborts the second committer. Reproduced red-first by a seeded four-way race (12 prepared against a cap of 9, every run); it now yields exactly one 200. **The Serializable rationale in the branch was wrong twice before it was right, and the corrected version is the durable part.** SSI detects anti-dependencies **only between two Serializable transactions**, so it buys long rest nothing against `performLevelUp`, which passes no `isolationLevel` and runs READ COMMITTED — what protects long rest is first-updater-wins on the `CharacterClass` rows it writes. Probed against the real database and pinned by `packages/server/src/utils/serializable-isolation.test.ts`; see the note above this table. The toggle's own comment claiming a concurrent level-up "cannot move the cap under the count" was corrected the same way — reading the cap inputs inside the transaction narrows a staleness window, it does not buy detection. **The cap is not a global invariant and the docs no longer claim one:** character creation marks all six of a level-1 wizard's chosen spells prepared against a cap of four, with no cap check at all, so no locking discipline fixes it. That is leaf 58. The docs now claim only that `togglePrepared` never raises the count above the cap. **A shared per-character advisory lock was rejected, and the recorded reason was itself corrected** — the first version ("a lock adds no check creation never makes") is equally true of Serializable and settles nothing. The reasons that discriminate: advisory locks have no Prisma API and need raw SQL fenced by `raw-prisma-sql`, and a `Character`-scoped lock would add a permanent entry to the canonical acquisition order that long rest and level-up must honour forever. The accepted cost is recorded rather than denied: SSI aborts on *any* concurrent prepare for the character, not only at the cap boundary. **Retries use jittered backoff, deliberately, and long rest's do not** — first-updater-wins can only fire after the conflicting writer has committed, so long rest re-reads settled state; the toggle's losers restart together. `docs/CONCURRENCY.md` bounds that rationale rather than generalising it: the toggle now reads `CharacterStats` and `CharacterClass` inside a Serializable transaction and long rest writes both, so the two serializable paths form a real SSI edge whose losers *could* restart together. If long rest ever surfaces `CONFLICT` in practice, give it the toggle's `backoff()` rather than raising `LONG_REST_MAX_RETRIES`. Behaviour at the boundary is preserved: a retry that re-counts against the winner's committed state returns the pre-existing `BAD_REQUEST "Cannot prepare more than N spells"`, and `CONFLICT` is reachable only once the budget is spent. **`CharacterSpell` deliberately did NOT join the gated delegate set** (leaf step 3's second branch) — the fix is transaction-local, so a gate would leave one guarded caller and a dozen ordinary writers. **`utils/prepared-spell-toggle.ts` exists because the fix pushed the router past the max-lines gate, and it is NOT leaf 05 step 5's extraction**: `calcMaxPrepared` is still unexported and untested in isolation, so that leaf keeps its testability outcome — now against a correct helper rather than a broken inline guard. `services/README.md` records why the new module is a util and not a service. Two test-quality repairs landed on the branch's own new tests: the router race asserted `succeeded <= 1` and ignored `rejected`, so an empty fulfilled array passed every assertion, and the retry schedule ran on real sleeps, which re-collided under the repo-wide gate. Both are now deterministic (injectable jitter, a `beforeWrite` barrier with a 10s timeout, and a tripwire on the racer-count/`SERVER_TEST_POOL_MAX` coupling). Side effect worth knowing: the router shed its `ratchet/max-depth-production` baseline entry. |
| 52 | `455bac12e` | **Done as proposed, taking the direct `import.meta.dirname` form rather than a count-the-dots walk at each site.** All four generators now resolve through one new `packages/server/src/seed/srd-generator-paths.ts`, which owns the single repo-root walk; `srd-generator-paths.test.ts` pins it against committed markers, asserts each output path lands on the artifact it regenerates, and fails if any generator reintroduces `process.cwd()`. **Verification diverged from the leaf's step 2, and the divergence is the caveat the leaf itself predicted.** `docs/refs/` is an optional gitignored operator checkout and is absent, so byte-identical regenerated output could not be proven. What was proven by execution instead: each generator run from an unrelated temporary cwd now reports `ENOENT` on the repo-root SRD input and creates no tree under the invocation directory. The change touches path resolution only, no generator body. The `52→06 step 2` precondition is discharged. |
| 24 | `c36c9a17` | As proposed. The explicit `Record<…, z.ZodType>` annotation is gone, nine schema member types are inferred again, and the downstream cast went with it. |
| 11 | `1f750dc5`, `b1f337cd`, `a716407d`, `3b091e28` | As proposed, plus two follow-ons the leaf did not name: the template tool-shape mapping got a single home in `map-canvas-store.ts`, and the template toolbar's tool inventory was centralized rather than re-listed. |
| 37 | `9811294b`, `665d5bce`, `f102a89e` | As proposed — both contracts written down, the inverted lint-coverage capture signal un-inverted, and each half pinned by a new smoke test (`scripts/ai-hooks/test-lint-coverage.sh`, plus response-code precedence cases in `scripts/ai-hooks/test.sh`). |
| 43 | `6e4adaa4`, `816eb53a` | Done **via the `.mjs` route**. Step 1's feasibility check fired on the first pass and stopped the leaf; review overturned that stop. The route taken was to rename the two TypeScript lane entrypoints (`scripts/stryker-scripts.ts`, `tools/stryker-lint-ratchet.ts`) to `.mjs`, so all four lanes consume `stryker.shared.mjs`. The leaf's "a two-lane factory is a worse outcome — do not ship one" caveat was therefore satisfied, not waived. `816eb53a` is a pre-merge review fix: the factory throws on unknown or missing lane options instead of silently dropping them, restoring the error surface the inline configs got from Stryker's own options validator. The leaf's ask to refresh the four-lane inventory in `../mutation-testing-stryker.md` is done in the same commit as this reconciliation. |
| 39 | `ef649600`, `25ee860d`, `a1163805`, `25239249`, `3e437e7e`, `befef4f1`, `974398c8`, `f005d208`, `8942a9e7`, `3a445eb4` | Steps 1-4 and 6 as proposed; **steps 5 and 7 skipped as unjustified, not deferred.** Step 5 (deleting the ten `trpcData` re-exports) removes no duplicated code by the leaf's own admission and would add a second import to 39 files — the eleven re-exports are still there deliberately. Step 7 (per-domain `useEncounterContext()` / `useMapContext()`) is the signature-pass-through anti-pattern the leaf's own caveats reject for `useTestApp()`'s `beforeEach` half; the 27-file count does not change that, so it is dropped rather than left open. **Step 6 took a different shape than the leaf describes**: `useTestApp()` takes an *assignment callback* (`useTestApp((created) => { app = created; })`) rather than returning a delayed handle, which keeps `app` a plain `FastifyInstance` at all 92 call sites with no deferred proxy and no `.current` indirection. The lifecycle is factored into a hook-free `createTestAppLifecycle()` so the ordering is testable without Vitest. Step 3's deliberate behaviour change did expose real failures, fixed in place (`974398c8`). Four commits are review/panel fixes: `befef4f1` preserves per-suite `beforeAll` timeouts the wrapper had flattened, and `8942a9e7`/`3a445eb4` close a genuine teardown race the sweep made reachable — Vitest rejects a timed-out `beforeAll` without cancelling the promise it awaits and still runs `afterAll`, so an app created after teardown now closes itself instead of leaking. |
| 47 | `aa28611c`, `2eba51f7`, `240d6700`, `d5510d3e`, `4d8e0bd1`, `311337f8`, `cf464422`, `41b50b1d`, `37b70f7e`, `259cbd55`, `785fd83b` | All six steps done, with two divergences. **Steps 4 and 5 were swapped**: the six wrapper groups were converted onto `AppRouterInputs`/`AppRouterOutputs` first (`2eba51f7`-`4d8e0bd1`) and the two transports were keyed on a procedure path afterwards (`311337f8`). Converting the wrappers first meant each group's inferred shapes were compiler-checked as it landed, and left the transports with exactly one caller shape to satisfy; retyping the transports first would have broken all 19 wrappers in one commit. **Five of the eight `Api*` interfaces were kept, as derived aliases rather than deleted**: `ApiCreateCharacterOptions`, `ApiCharacterDetail`, `ApiEncounterSummary`, `ApiEncounterDetail` and `ApiEncounterParticipant` are now one-line `Pick<>`/indexed-access aliases over the router maps and are load-bearing names in the specs that import them. Only `ApiCharacterSpellSlot`, `ApiChatMessage` and `ApiCombatLog` — the three with no importer outside `api.ts` — were deleted; `ApiLevelUpCharacterInput` was added as a derived alias. Step 3's typecheck slot is the load-bearing half: without it the whole leaf is ungated. `41b50b1d` and `785fd83b` are review fixes to that slot — the e2e lane no longer depends on the package build, and it now scans the complete e2e source set rather than a subset. `37b70f7e`/`259cbd55` pin the seeding fixtures' input surface with type-tests after the panel found inference had widened it. |
| 18 | I1: `1c43d221` · I2: `297e67e0` · I3: `885e2b58` · review: `2bf109e2`, `1abc7738`, `aa37460f`, `d660e1e8`, `f0144398` | **Done, with the review rounds closing the producers as well as the consumers.** I1 named the twelve-value `SrdClassId` and eight-value `SpellClassId` domains, kept one hand-written total map and derived its partial reverse. Its `listSpellsInputSchema.classId` close went further after review: the final schema uses the eight-tag enum directly, not `idField.pipe(z.enum(...))`, because the pipe kept the input type `string` and therefore bound no caller. I2 retyped all four SRD-keyed tables without narrowing their public `string` boundaries, preserved every unknown-id fallback, and deleted the dual-key prepared-spell lookup. **The requested compatibility branch for a bare-tag `Class.id` was declined.** `seedClasses` is the only live `Class` writer, its data has used `class-*` ids since the table was introduced, no migration inserts a class, and `CharacterClass.classId` is an FK; moreover, main's `getLevel1SpellSelection` already had no dual-key fallback. Accepting `"wizard"` would have made HEAD more permissive than main for a row only hand-written SQL can create. The producer was closed instead: `SeedClass.id` is `SrdClassId` and the seed has a runtime pin. I3 replaced all six ad-hoc conversions with `spellClassIdForClassId(): SpellClassId | undefined`; the prefix-strip fallback was dead against the closed spell-tag vocabulary and is gone. The undefined result deliberately has three answers at its callers: creation/review skip the query, server validation matches no spell, and the add-spell dialog retains its existing **All Classes** filter. `d660e1e8` corrected an intermediate JSDoc that had wrongly described all three as an empty result. **`Spell.classes` is now single-sourced too:** one exported `spellClassesSchema` is used by the entity schema, wire mapper, both server validators and seed writer. A red router test proved the old split let `["wizard", "artificer"]` pass add-validation, commit a `CharacterSpell`, and throw only while mapping the response. The homebrew authoring model remains deliberately open because it rebuilds `HomebrewEntry.data` — the plan's Trap 2. |
| 19 | W1: `29ac3137`, `272cd4a0` · W2: `a2335c75`, `a2e2923f`, `39ad2cd3` · A1: `9b7dd0aa` | **Done, across slices C and D.** Slice C landed W1, the live-defect adapter fix (described below); slice D landed the riders W2 and A1, which is everything the plan schedules. **W2**: the three shared test imports were retargeted at `./srd-weapons.js` and the relocation facade at `attack-damage.ts:15-22` deleted; `WeaponData.damageType` narrowed from `string` to `DamageTypeName`, with the property arbitrary widened to exercise every canonical value; and the plan's *optional* third commit taken — `item-weapon-fields.tsx` now derives its weapon-property checkboxes from the shared `WEAPON_PROPERTIES` with `"special"` appended explicitly, keeping the existing accessible labels. The plan's three prohibitions held: `WeaponData.properties` was not narrowed, `character-rules.ts:157-165`'s tombstone is byte-unchanged, and `"special"` was not added to the shared list. **One permanent lint exception was recorded rather than dodged, and it should not be re-opened.** The type import that narrowing `damageType` requires pushes `packages/shared/src/rules/srd-weapons.ts` past the 300-line `local/max-lines` cap, so `eslint-config/max-lines-exceptions.baseline.json` now carries a `lifecycle: "permanent"` 310-line entry for it. Three independent reviewers judged the exception legitimate: the file is one cohesive transcribed SRD table, splitting it would fragment a reviewable rules artifact, and shaving the import to duck the cap is metric-gaming, not a structural improvement. **A1** (optional) extracted the `armor-class.ts:103-105` category heuristic into a named, commented helper explaining why the persisted `armorPropertiesSchema` carries no category; `unarmoredAc` still takes two parameters, the PHB comment is where it was, and no AC number changed. Below is the slice-C record of W1, kept because its correction is the one most likely to be re-raised. [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md) re-scoped the leaf from L to one XS adapter fix plus riders, and this landed the adapter fix: `enrichFromSrd` now resolves `wp.versatileDice ?? wp.twoHandedDice` (`packages/shared/src/rules/attack-damage.ts`), red-first behind a new shared-seam test in `attack-damage.test.ts` and a repointed resolver regression in `resolve-attack.test.ts`. The plan's correction held: **`?? srd?.versatileDice` was deliberately not added**, and the reason is now a comment in the code beside the fallback rather than only in the plan — an SRD fallback would attach the SRD longsword's `1d10` to a custom same-named 2d6 weapon. The two-representation contract (`twoHandedDice` is the authoring/storage spelling, `versatileDice` the rules spelling, this function the only translator, neither key removable from a persisted schema) is written down at the same seam. **Steps 3 and 4 did not land and were not deferred silently**: neither is scheduled at all — no reader exists outside the adapter, and 4 is the persisted-key migration the plan's Trap 2 guards. Steps 5, 6, 7 and 8 landed in slice D as W2 and A1, with step 7's `unarmoredAc(hasShield)` half dropped. |
| 01 | `6e86b597`, `396802c8`, `f127d2eb`, `6247138b`, `e3aa6838`, `143f728e`, `a5df6870`, `f7b1d4e3`, `a3340b6b`, `b435158c`, `03cd70a8`, `b9973404`, `8eb6feb6`, `2093989d` | Steps 1 and 3-8; **step 2 skipped**, as the leaf itself instructs (it is an optional separate commit that step 1 does not need, and the two `interop` casts at `routers/encounter.ts:192-193` survive untouched). Steps 1, 3-7 landed as proposed: three enum columns un-widened and five casts deleted, ten `Record<string, unknown>` filters and eleven update payloads retyped onto the generated Prisma inputs, four `map-types.ts` result interfaces replaced by `z.input` aliases, the copy-defined builders folded onto one key-allowlist helper, and `prisma-types.ts`'s five-way skeleton deduped with every `@deprecated` line kept verbatim. **Step 8 turned out to be larger than the leaf knew, and that is the important part of this landing.** The 21 casts collapsed to five file-local `rawWrites` helpers as asked, but review found the mechanism they sit on **was never structurally closed**: the banned write methods were typed `never`, and `never` is assignable to everything, so `const raw: Prisma.TransactionClient = tx` compiled and handed back every banned method with no cast, no marker, and no `concurrency-guard` lint hit — a renamed binding also escapes that rule's name matching. Nine distinct assignability directions compiled. `f7b1d4e3` replaced `never` with a branded, non-callable `ConcurrencyGatedWrite`; `a3340b6b` and `b435158c` closed `$extends` and `TxClient.$transaction` as two more instances of the same class of escape; `03cd70a8` narrowed each of the five `rawWrites` helpers to `RawWriteClient<"…">` so one sanctioned cast cannot write another gated table. All of it is pinned in `packages/server/src/utils/__type-tests__/raw-client-widening-restrictions.ts`, and `docs/CONCURRENCY.md` and `docs/guides/add-race-sensitive-mutation.md` were corrected — both had described the old `never` model. The leaf's "do NOT extract a shared `toRawTx`" caveat was honoured: five helpers, five markers, no global escape. `4da1764f` is the land-gate fix described below. |
| 21 | K1: `04fe17f8`, `931ea939`, `ee5f1f3e`, `0c88baed`, `695f6545` · K2: `1df927f4`, `0174e251`, `acb7ac75` · K3: `f43ef4ce`, `aa554a4b`, `da598760` | All five steps, as the plan's three slices. **K1 grew past its leaf, and that growth is the durable part.** The leaf asked only that `MIN_LEVEL`/`MAX_LEVEL` get one home; what landed is a canonical `CHARACTER_LEVELS` tuple in `packages/shared/src/constants.ts` declared `as const satisfies readonly [typeof MIN_LEVEL, ...number[], typeof MAX_LEVEL]`, with `CharacterLevel` derived from it — so the bounds and the enumeration can no longer drift apart without a compile error, and the hand-enumerated union is gone. That retired a cast in `rules/encounter-difficulty.ts`, dropped `spell.ts`'s local `MAX_CHARACTER_LEVEL` and `homebrew.ts`'s literal lower bound, and moved the broad `no-magic-numbers` disable from `schemas/character.ts` to `constants.ts` with no net suppression change. `constants.ts` still imports only Zod, so the leaf-module assumption K1 rests on holds. `931ea939` and `ee5f1f3e` are steps 2-3 as written. **One deliberate behaviour change landed, and it was a 2-vs-1 split on the pre-merge panel** (`695f6545`): `calculateEncounterDifficulty` now throws a named `RangeError` on a non-whole `characterLevel`. The intermediate `find`-based clamp K1 introduced silently mapped `4.5` to level 5 and `NaN` to level 20; the pre-branch code threw an incoherent `TypeError` off an `undefined` budget row on the same inputs. The deciding argument was the `NaN` case: it hands a DM the level-20 budget row, rating a real encounter as *easier* than it is, in the panel used to decide whether to run the fight — a wrong-but-plausible number is worse there than a stop, and a named error is closer to pre-branch behaviour than a silent answer. Out-of-range *whole* levels still clamp (0→1, 25→20, still pinned). Unreachable through both live call paths: `encounterParticipantSchema` validates `.int().min(MIN_LEVEL).max(MAX_LEVEL)` and the value is fed from the Prisma `Int` column `Character.level`. **K2** introduced `D20_SIDES`, kept `MAX_D20_ROLL` and `NATURAL_CRIT` as the plan required, and did not route `resolveConcentrationSave` through `resolveD20Roll` or merge the three `HALF_DIVISOR`s. Its client half (`0174e251`) extracted only the shared "what did the decisive die show" step into `packages/client/src/lib/natural-roll.ts`; the two call sites keep their differing crit policies. That asymmetry is the panel's one remaining open item — see the [Constraints](#constraints-on-future-proposals) row on `isNatural20`; it is pinned producer-side by `acb7ac75`, not fixed. **K3** landed the ASI extraction, then (`aa554a4b`) **deleted the compatibility re-export outright rather than leaving a shim**: ADR-0005 requires an import to name the file that defines the symbol, and the package is private with every consumer in-tree, so there was nothing for a shim to be compatible with. `packages/shared/src/schemas/MODULE.md` gained a third file role ("fragment files") to describe `asi.ts`, corrected in `da598760` — the first wording claimed a fragment "imports only from other leaves", which its own headline example (`asi.ts` importing `abilityAbbreviationSchema` from `./srd.js`) contradicts. The real invariant is directional: a fragment may import other schema files as long as they do not import its consumers back. |
| 22 | S1: `8759849e`, `26ced3e0` · U1: `f9a76396` · U2: `bc07c160` · review: `96e5de2e`, `a7c1a320`, `79e2b2a8`, `bd6544a1` · U3: **closed-declined** | **Done, with two deliberate behaviour changes and one deliberate non-change.** S1 gave notification and weapon-mastery entities their own files. U1 replaced the order-dependent notification-data union with one strict optional-key object: a `{ messageId }`-only row used to be erased to `{}`, and a wrong-typed `campaignId` used to parse successfully; both red-first pins now protect the stricter schema. Review then made the read path strictly more preserving than before by salvaging each independently valid known key, with a tripwire over `notificationDataSchema.shape`. U2 made a non-object `LevelChoice.choiceData` row degrade to `{}` instead of failing the whole character load, while the unknown-object tail remains lossless. **U3 is closed-declined with all three panelists concurring:** the four `campaignId`-only schemas are different-direction wire contracts, not one concept; aliasing them to one object identity would defeat `broadcast-registry.test.ts`'s `expect(entry.schema).toBe(...)` assertion and weaken the typechecker's mis-wiring signal, for about 8 lines saved in a 188-line file. |
| 23 | S1: `8759849e`, `26ced3e0`, `ff24492f` · S2: `6684cd53` · S3: `b83df21f` · review: `19f8557e`, `fcb71f17` | **Done, but only after the documentation slice was reviewed claim-by-claim three times.** S1 moved the two misplaced entities and corrected the cited `schemas/MODULE.md` claims. Post-implementation review found one more false statement; the pre-merge panel found three more: schema files do own runtime constants, nine schema files have no colocated test, and `weapon-mastery-inputs.ts` could not remain under “files with no same-named partner” after S1 created that partner. The last repair was a whole-document sweep. S2 completed the condition-schema rename without conflating the name enum with the SRD reference row. S3 derived `characterSummarySchema` and restored `.min`/`.max` on character and class level; this is a deliberate live-output tightening, red-first: Prisma has no CHECK constraint, so a hand-written out-of-range row now fails `character.list`. |
| 26 | S1 rider: `ff24492f` · E1: `be7dfd94`, `b2bc96e5` · E2: `961886de` · review: `24fe5592` | **Done, with the plan's cut-down scope holding.** S1 recorded why the bare timestamp strings are deliberate. E1 removed the unused same-file `ClassPreparedEntry` alias and reused `FRESH_ACTION_ECONOMY` for the real turn-start reset; the whole-tree straggler sweep was clean, and all three panelists independently confirmed it. The similar object in `encounter-query.ts` remains because it is a privacy redaction, not a rules default. E2 removed the original-index emulation, its double assertion and both Stryker suppressions; the strengthened stability tests stayed green and mutation testing scored 100%. Review caught the rules obligation E2 initially missed: SRD 5.2.1 p.13 gives ties to the GM/players, while Musi uses modifier then caller order. The rule site, both unordered Prisma callers and policy-named tests now say so. That naming does not resolve the product gap; leaf 53 owns it. |
| 20 | R1: `e2c01ed3`, `a534d49d`, `2592227e` · R2: `998d742c` · R3: `23a5aa68` · review: `91760d03`, `7169e116` | **Done, with the plan's corrections holding.** R1 deleted the unused `isSubclassLevel`, folded fractional CR labels onto one pair list without weakening `parseCr`, documented `PROFICIENCY_BONUS_TABLE`'s SRD provenance, named the cantrip tables as Musi caster-type fallback policy, and pinned their existing invalid-level answers. No table became a formula. R2 closed `SKILL_ABILITY_MAP`/`SKILL_NAMES` while retaining `skillModifier(string)` and its unknown-name `0` contract. R3 made the two drawing limits independent literals and corrected the point-count contract. **Review found and folded three live stragglers:** `monster-form-data.ts` now uses shared `formatCr`; `map-canvas-store.ts` uses `DEFAULT_STROKE_COLOR`/`DEFAULT_STROKE_WIDTH`; and `drawing-overlay.tsx` uses `MIN_FREEHAND_POINTS` for the preview over the same coordinate array the save path validates. The last one prevents a future drift where the user sees a stroke that silently fails to save. |
| 25 | D1: `34624532` · D2: `71c456f6` | Both steps as planned, no divergence. **D1** made `diceGroupResultSchema`/`rollResultSchema` the single source for `DiceGroupResult`/`RollResult`, and took the "rename away" side of the choice the plan left open — the duplicate `*Parsed` aliases are gone and the client consumers point at the canonical names, so no two live names remain. The unreachable `notation` fallback at `dice-roller.ts:55` is gone; the conditional spread at `:43` and `ParsedNotation.notation`'s optionality are untouched. **D2** replaced the zero-sided sentinel record with a `kind: "dice" \| "flat"` discriminated union and an exhaustive switch in the roll loop. The persisted-shape prohibitions held exactly: `rollResultSchema` and `diceGroupResultSchema` are byte-unchanged, flat terms still emit `{ rolls: [], subtotal }`, no discriminator was added to the result types, and the `1d20+5` fixture was rewritten as two terms rather than deleted. |

## Leaves

> **Where a row links a plan, the plan wins.** The `Sev`/`Size` values and the
> dependency edges quoted in "How to use this pack" are the *leaf's* view,
> recorded before the six XL plans and the four cluster plans were written. The
> plans supersede both: several leaves are shrunk (shared 23, client 08/15/17),
> several are dropped outright or reduced to an opportunistic
> remainder (client 13, client 14 as a scheduled session, client 15's drawer
> half, client 17 steps 3/5/6, harness 29 step 5, harness 49's test split), and
> harness 32 steps 4-5 are refused on operational grounds. **Except for the
> shared and client rows, these rows are deliberately left at their pre-plan
> values** — each
> plan carries its own "Index reconciliation" list
> and applies it when its first slice lands, so the reconciliation happens once,
> against real work, rather than twice. Read the plan before you size, sequence
> or promote any leaf it covers.
>
> **[SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md)'s reconciliation has been
> applied** (2026-07-26, after slice D). Rows 18, 19, 20, 22, 23 and 26 now carry
> the plan's sizes rather than the leaves'; the shared dependency edge
> `21 step 5↔22 step 5` is deleted as dissolved; three rows were added to
> [Constraints on future proposals](#constraints-on-future-proposals); and each
> of the eight shared leaves carries a Status pointer to the plan and a record of
> which of its steps are dropped or merged. **All eight shared leaves are now
> closed and the plan is finished:** twenty-one slices landed and U3 is
> closed-declined with reasons. The plan remains the authoritative outcome
> record; there is no shared-cluster pickup tail.
>
> **[CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md)'s reconciliation has been
> applied** (2026-07-27, after its first landing). Rows 08, 09, 10, 12, 13, 14,
> 15, 16, 17 and 48 now carry the plan's sizes and dispositions rather than the
> leaves'; the superseded client dependency chain was replaced by the plan's
> slice edges; all ten leaves carry a Status pointer and explicit dropped/merged
> steps; and leaf 17's pure-rename sweep moved to leaf 46. **The client cluster
> is in progress, not finished:** C1, C2, C3, C4, V1, V2 and O1 landed in merge
> `6cf8c78d5`; N1, Q1, Q2, Q3, F1, F2, X1 and O2 remain.

| # | Leaf | Area | Sev | Size |
|---|---|---|---|---|
| 01 | [Hand-written row/payload types re-erode Prisma's generated types, then buy the loss back with casts](./01-prisma-boundary-type-erosion.md) — **Done** 2026-07-26 (see [Landed](#landed)) | server | medium | L |
| 02 | [The Socket.IO decorator is untyped, so a rename would silently disable every broadcast](./02-fastify-io-augmentation.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | server | medium | M |
| 03 | [Authorization helpers take the caller three different ways](./03-authz-caller-contract.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | server | medium | L |
| 04 | [Socket broadcast boundary left half-migrated](./04-socket-broadcast-surface.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | server | medium | M |
| 05 | [Router/service boundaries drift from the repo's own promotion rubric](./05-router-and-service-boundaries.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | server | medium | L |
| 06 | [The SRD seed generators are an unattested code-generation pipeline](./06-seed-pipeline-and-generators.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | server | medium | L |
| 07 | [Spell-casting and level-up widen their own types, then pay to re-narrow them downstream](./07-spell-casting-and-level-up-shape.md) — scheduling plan: [07-PLAN.md](./07-PLAN.md) | server | medium | **XL** |
| 08 | [Client form primitives are re-invented per feature folder](./08-form-field-primitive-and-placement.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); open as F1/F2 | client | medium | M |
| 09 | [map-canvas-store is split by line count, not by concept](./09-map-canvas-store-decomposition.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | client | medium | S |
| 10 | [Effects glue VTT store state to route identity, so each switch commits one stale frame](./10-client-effect-misuse.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | client | medium | M |
| 11 | [Canvas tool dispatch widens the closed `MapTool` union to `string`, then casts back](./11-canvas-tool-typing.md) — **Done** 2026-07-26 (see [Landed](#landed)) | client | low | M |
| 12 | ["Am I the DM" has three client derivations, one contradicting the server's own check](./12-campaign-context-prop-drilling.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | client | medium | L |
| 13 | [Sibling campaign surfaces copy each other's chrome](./13-client-shell-duplication.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); **Done** 2026-07-27, remainder dropped (see [Landed](#landed)) | client | low | XS |
| 14 | [Character-sheet dialog wiring is flattened into seven loose state pairs and 24-prop pass-throughs](./14-sheet-dialog-state-and-props.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); open as O2 plus F2 rider | client | low | XS |
| 15 | [Two client state shapes are wider than their legal values](./15-client-discriminated-state.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); open as N1 | client | medium | S |
| 16 | [Client query plumbing is hand-rolled where TanStack Query already covers it](./16-client-query-layer.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); open as Q1/Q2/Q3 | client | low | M |
| 17 | [Client hook and prop APIs carry no domain meaning, so MODULE.md carries it instead](./17-client-hook-naming.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); open as X1 | client | low | XS |
| 18 | [Class identity uses two competing string conventions with a silent dual-key fallback](./18-shared-class-identity.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | shared | medium | M |
| 19 | [Versatile weapon damage is silently dropped because one concept is spelled two ways](./19-weapon-and-armor-catalog.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-26 (see [Landed](#landed)) | shared | medium | S |
| 20 | [Shared rules state simple relationships in forms nothing can check](./20-rules-tables-to-formulas.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | shared | low | S |
| 21 | [Rules constants every layer must agree on are re-declared privately in three packages](./21-shared-constants-single-source.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-26 (see [Landed](#landed)) | shared | low | M |
| 22 | [Order-dependent `z.union`s with catch-all fallbacks stand in for discriminated unions](./22-shared-discriminated-unions.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-27, with U3 closed-declined (see [Landed](#landed)) | shared | low | S |
| 23 | [The shared schemas directory has documented conventions its own files break](./23-schema-layout-and-naming.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | shared | low | S |
| 24 | [`HOMEBREW_DATA_SCHEMAS`'s `z.ZodType` annotation erases nine schema types and forces a cast](./24-homebrew-registry-typing.md) — **Done** 2026-07-26 (see [Landed](#landed)) | shared | low | XS |
| 25 | [The dice model encodes flat modifiers as a zero-sided die](./25-dice-model.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-26 (see [Landed](#landed)) | shared | medium | M |
| 26 | [shared's exported surface has drifted from its consumers](./26-shared-dead-and-vestigial.md) — cluster plan: [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | shared | low | XS |
| 27 | [The shell smoke suites re-declare their own test framework per file](./27-shell-test-substrate.md) — scheduling plan: [27-PLAN.md](./27-PLAN.md) | harness | medium | **XL** |
| 28 | [The scripts/ layout contract is prose-only](./28-scripts-layout-families.md) — scheduling plan: [28-PLAN.md](./28-PLAN.md) | harness | medium | **XL** |
| 29 | [worktree-db.sh and stop-policy.sh hold seven copies of the same state codec](./29-bash-to-ts-cores.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | medium | L |
| 30 | [Canonical CLI primitives exist under scripts/lib, but argv offsets have seven spellings](./30-cli-arg-substrate.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | medium | L |
| 31 | [The scripts/ leaf-utility layer: residual guard adoption, shell finding shape, path-policy duplication](./31-harness-shared-helpers.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | medium | L |
| 32 | [Git hooks hold 900 lines of gate orchestration inline](./32-git-hook-shims.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | medium | L |
| 33 | [Harness env vars carry several unrelated prefixes and no documented rule](./33-env-var-prefixes.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | low | S |
| 34 | [drift-ai and drift-triage carry their internal contracts as free-form records and positional params](./34-drift-ai-typing.md) — scheduling plan: [34-PLAN.md](./34-PLAN.md) | harness | medium | **XL** |
| 35 | [code-intel and logs-audit carry structure by convention](./35-code-intel-internals.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | medium | L |
| 36 | [lint-ratchet's portable kernel speaks the vocabulary of a system it is not](./36-lint-ratchet-vocabulary.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | low | L |
| 37 | [Two ai-hooks shell contracts are unwritten](./37-ai-hooks-contracts.md) — **Done** 2026-07-26 (see [Landed](#landed)) | harness | low | S |
| 38 | [The local-ESLint directory hand-copies AST helpers across two competing homes](./38-eslint-rule-helpers.md) | lint | medium | M |
| 39 | [Server test helpers grew by copy-paste: a 10-line preamble in 90 files](./39-server-test-lifecycle.md) — **Done** 2026-07-26 (see [Landed](#landed)) | tests | medium | L |
| 40 | [Test inputs are inline literals and positional tuples instead of typed factories](./40-test-payload-factories.md) — scheduling plan: [40-PLAN.md](./40-PLAN.md) | tests | medium | **XL** |
| 41 | [The client's tRPC test mock is a 603-line untyped shadow router](./41-mock-trpc-typing.md) — `srd.listSpells` partly hardened in merge `ec4d732c4`; the leaf remains open and owns any broader harness pattern | tests | medium | L |
| 42 | [The encounter combat E2E is one 22-test serial narrative that repairs shared state](./42-e2e-encounter-narrative.md) — scheduling plan: [42-PLAN.md](./42-PLAN.md) | tests | medium | **XL** |
| 43 | [Every Stryker config re-copies the same runner/reporter/threshold block](./43-stryker-config-duplication.md) — **Done** 2026-07-26 (see [Landed](#landed)) | tests | low | S |
| 44 | [Comments record the change that produced the code instead of what the code does](./44-comment-archaeology.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | comments | medium | L |
| 45 | [Contracts are documented in comments that live away from the code enforcing them](./45-comments-compensating-for-code.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | comments | medium | M |
| 46 | [Identifiers name the wrong thing: one word for two entities, one entity under two words](./46-naming-renames.md) — cluster plan: [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md) | cross-cutting | low | L |
| 47 | [The E2E API helper hand-writes 19 tRPC call signatures and casts every response](./47-e2e-api-client-typing.md) — **Done** 2026-07-26 (see [Landed](#landed)) | tests | medium | M |
| 48 | [`components/sheet/` is 87 flat files with no `MODULE.md`](./48-sheet-module-doc.md) — cluster plan: [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md); **Done** 2026-07-27 (see [Landed](#landed)) | client | low | S |
| 49 | [The path-policy fixture analyzer is nine modules with no `MODULE.md` and one 803-line test](./49-path-policy-fixture-analyzer.md) — cluster plan: [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md) | harness | low | M |
| 50 | [Nested relation writes reach every concurrency-gated table through a non-gated delegate](./50-nested-relation-concurrency-gate.md) — pre-existing; anchors pinned to `5ff5751a`; **Done** 2026-07-27 (see [Landed](#landed)), closed by lint only — leaf 60 holds the runtime closure | server | medium | M |
| 51 | [The prepared-spell limit is a check-then-act race](./51-prepared-spell-limit-race.md) — anchors pinned to `5ff5751a`; reframes leaf 05 step 5, which is **not** absorbed by this fix; **Done** 2026-07-27 (see [Landed](#landed)) | server | medium | S |
| 52 | [All four SRD seed generators resolve their paths from `process.cwd()`](./52-seed-generator-cwd-dependence.md) — anchors pinned to `5ff5751a`; precondition for leaf 06 step 2, now discharged; **Done** 2026-07-27 (see [Landed](#landed)) | server | low | XS |
| 53 | [Initiative ties need a DM-facing resolution workflow](./53-initiative-tie-resolution-policy.md) — **Decided** 2026-07-27; scheduling plan: [53-PLAN.md](./53-PLAN.md), whose index reconciliation (including size L→M and dropping `+ socket`) applies when slice T1 lands, so the Area and Size here are still the leaf's; ready to schedule, not promoted; owner chose DM resolution over an automatic secondary key; original anchors pinned to `75bad57dc`, decision-pass anchors to `2decbb56a` | shared + server + client + socket | low | L |
| 54 | [Character sheet campaign context must come only from the character's authoritative link](./54-character-sheet-campaign-context.md) — **Decided** 2026-07-27; ready to schedule, not promoted; delete the route search param rather than reconcile two ids; original anchors pinned to `6cf8c78d5`, decision-pass anchors to `2decbb56a`; not part of the client-cluster remainder | client | low | S |
| 55 | [`character.create` produces a character without Common unless the wizard is the caller](./55-common-language-ownership.md) — the follow-up owner the client cluster's Q2 deferral promised; **Done** 2026-07-28 with the owner-ruling backfill and redundant client injection removed (see [Landed](#landed)); anchors re-verified from pinned `709b27668` against the live tree | shared + server + client | low | M |
| 56 | [Every infinite list replays all loaded pages on refetch, and the SRD compendium reads pay it for immutable data](./56-infinite-list-refetch-cost.md) — deferred out of slice Q3's charter; one caching policy across all four infinite queries, not two patched call sites; anchors pinned to `709b27668` | client | low | S |
| 57 | [Zero-baseline `exitPath` is validated as a non-empty string, and two ratchets point at a file that does not exist](./57-ratchet-exit-path-validation.md) — pre-existing on `main`, found while refuting a different `exitPath` claim; anchors pinned to `709b27668` | harness | low | XS |
| 58 | [Character creation writes six prepared level-1 spells for a wizard whose cap is four](./58-creation-writes-over-prepared-cap.md) — **a rules defect, not a concurrency one**: creation makes no cap check, so no locking discipline fixes it; verified by execution against the real `createCharacter` path; a `change-rules-logic.md` change that must first answer what a wizard's sixth spell means; closes the counterexample `docs/CONCURRENCY.md` names when it narrows the prepared-cap claim to the toggle path; anchors pinned to `f16079c2f` | shared + server | medium | S |
| 59 | [`characterSpell.add` checks for an existing row, then inserts against a unique constraint, so the loser gets a 500](./59-character-spell-add-unique-race.md) — the database already enforces the invariant; only the P2002 translation is missing, and `isPrismaUniqueViolation` exists for it; **not leaf 51 again** — no transaction or isolation level belongs here; anchors pinned to `f16079c2f`, and leaf 51's landed fix moves them | server | low | XS |
| 60 | [Nested relation writes could be closed at runtime by a Prisma `$extends` query guard, not only by a lint](./60-nested-write-runtime-guard.md) — the third option `docs/CONCURRENCY.md` and ADR-0001 never named; strictly stronger than leaf 50's lint because it inspects the payload that reaches the driver, so spreads and helper-assembled payloads fail closed; a runtime change on every Prisma write, which is why it is not part of the server cluster; anchors pinned to `b16000968` | server | low | S |
| 61 | [Server-resolved combat looked saving-throw proficiencies up by full ability name while the stored identity is the abbreviation](./61-saving-throw-proficiency-identity.md) — a live gameplay defect, not a cleanup: concentration lost Barbarian/Fighter/Sorcerer their CON bonus after attack and spell damage, and **every** class lost both proficient saves against server-resolved spell saves, all low by `+2…+6`; client sheet and VTT were already correct, so the sheet showed a bonus the server never applied; the masking fixtures inserted a `"Constitution"` row the class-derived path never creates and rolled RNG extremes no bonus could change; reads are now alias-tolerant because the free-form create input keeps full-name writes reachable, and client adoption is deferred to leaf 62; anchors pinned to `c104b310`; **Done** 2026-07-28 on `fix/saving-throw-proficiency-identity` (`dd6b9f49f`) | shared + server | high | S |
| 62 | [The two client saving-throw readers each hand-roll ability identity, so they disagree with the server on alias spellings](./62-client-ability-identity-adoption.md) — leaf 61's deferred half: `saving-throws.tsx` and `stats-tab-rolls.tsx` still build their own uppercased `Set` with no trim and no alias table, so a `"Constitution"` row grants the bonus server-side but renders as non-proficient on the sheet and rolls un-bonused from both surfaces; predates leaf 61 at identical severity and is now duplication *against an existing shared helper*; filed by that branch's four-model merge panel | client + shared | low | XS |

## Constraints on future proposals

Each row is a change that looks attractive from the outside and should not be
proposed, with the reason it is wrong here.

| Do not | Because |
|---|---|
| Split `e2e/encounter-combat.spec.ts` (779 lines, one describe) before reusable API seeding exists | The serial structure is deliberate: `test.describe.configure({ mode: "serial" })` at `:54`, with nine shared mutable `let` fixtures at `:56-67`. Leaf 42 owns the split, and only after the seeding helpers exist. |
| Fold the lint-ratchet guides together | The split is audience-partitioned and documented, and the fold was performed once in the opposite direction on purpose. The four guides total 2,080 lines with no material overlapping text. |
| Treat `sensor-near-duplicates.baseline.json` as a work queue | It is the adjudicated output of a recorded triage (`docs/agent_notes/backlog/drift-triage-2026-07-13/verdict-collection.json`). Entries leave it when an extraction is worth doing on its own merits (for example `264d565e`), never because the baseline lists them. |
| Merge `trpc-shared-input-schema.js` / `-output-schema.js` | The shared machinery is already extracted into `trpc-shared-schema-import-collector.js`; ~25 declarative lines remain in each rule. |
| Merge the codemod input/output candidate finders | Inherits its remedy from the rule merge above. |
| "De-duplicate" `harness-emit-envelope.ts`'s two validators | They are not identical — each emits four distinct user-facing messages with different nouns, and the file carries a recorded accept-with-reason. |
| Parameterize the baseline merge-driver family | Already parameterized: each installer is ~15 lines of metric assignments sourcing a 155-line shared body. |
| Remove `WEAPON_MASTERY_MAP`'s `?? null` as dead code | Live under this repo's settings — `noUncheckedIndexedAccess: true` (`tsconfig.base.json:16`). Removing it produces TS2322. |
| Collapse the two lookup mechanisms in `conditions.ts` | Not redundant: `isValidCondition` is a *type predicate* and needs the `.some()` form; `Map.has()` does not narrow. |
| Force `homebrew.ts`'s three hand-rolled schemas onto the `.extend` convention | They are different contracts — `monster.ts:161-176` documents the read-vs-write damage-type split as deliberate. |
| Consolidate the result and response schemas in `combat-action.ts` | They are already consolidated: `spellCastResultSchema` is the tRPC `.output(...)` at `cast-spell.ts:103`. |
| Build one authoritative SRD equipment catalog | A drift guard already exists (`packages/server/src/test/srd-weapon-sync.test.ts`), and both forms of consolidation contradict documented decisions. Leaf 19 covers the request/response half that is in scope. |
| Replace the e2e response readers wholesale | There is one 35-line partial reader (`e2e/page-objects/vtt-drawer-response.ts`), which is deliberate runtime validation. Leaf 47 covers the request/response-typing half. |
| Delete the `in-vtt-drawer` effect as redundant with render | Load-bearing: `close` resets the whole global drawer store, which the render path does not do. |
| Give `use-weapon-roll.ts`'s `isNatural20` the `notation.includes("d20")` gate that `roll-toast.ts`'s `detectCrit` has | The asymmetry is deliberate and was left in place by the slice-D panel (`0174e251`, `acb7ac75`). `detectCrit` receives arbitrary rolls, so it must ask whether the roll was a d20 at all; `isNatural20` receives only what `equipment-summary.tsx:94` produces, and that hardcodes `1d20${modifier}`. Adding the gate would be behaviour-identical today and its failure mode is *silent* — a future non-d20 attack die would simply stop critting, with nothing saying why. The premise is pinned producer-side instead (`equipment-summary.test.tsx`), so it fails at the point it is broken. **The latent gap the gate would close is real but unreachable**: were a non-d20 attack die introduced, damage would double without a NAT badge. Fix the producer or the pin, not the consumer. |
| Convert `PROFICIENCY_BONUS_TABLE` or the three cantrip tables to a clamp-then-formula | **Refuted permanently by [SHARED-CLUSTER-PLAN.md](./SHARED-CLUSTER-PLAN.md); this is leaf 20's own headline and it is wrong.** `docs/guides/change-rules-logic.md:21-23` mandates the table form for transcribed SRD rules, and the conversion is not behaviour-preserving: `proficiencyBonus(21)` returns `2` today and `6` under `2 + Math.floor((level - 1) / 4)`. The tables *are* the out-of-range guard. The cantrip tables additionally cannot receive an SRD citation — they are keyed on `CasterType`, and the 2024 SRD's class-specific counts differ. |
| Rename `twoHandedDice` to `versatileDice` in any writer or persisted schema | They are the storage spelling and the rules spelling of one concept, with exactly one declared adapter (`enrichFromSrd`) between them, and that contract is now a comment at the seam. Zod strips unknown keys, so removing `twoHandedDice` from `weaponPropertiesSchema`, `equipmentWeaponDataSchema` or `homebrewWeaponDisplaySchema` erases it from every legacy row at read time; the homebrew form's `buildWeaponData` rebuilds the whole payload from its own model, so it writes that erasure back. Leaf 19 steps 3-4 propose exactly this and are **not scheduled**. |
| Derive `ACTION_ECONOMY_CONFIG`'s `field` from `ActionEconomyState` | `ActionEconomyState` is three independent booleans and encodes no `action → actionUsed` relation, so there is nothing to derive from. Doing it would mean inventing a new shared export to serve one client component. Leaf 26 step 3's action-economy half is dropped for this reason. |
| Call a rules-facing slice complete without classifying its provenance and naming any non-SRD policy in the tests | `docs/guides/change-rules-logic.md:7-10` and `:42-45` already require this, but E2 still initially missed it until review. For every rules-facing slice in this pack, explicitly ask “SRD rule, named outside source, or Musi policy?” and make each policy-protecting test name say which answer it pins. A generic “read the guide” note was not a sufficient completion check. |
| Call a “make the doc true” slice complete after checking only the claims the leaf cited, or review only the changed words of an edited factual claim | S1 needed three rounds because each review widened the audit surface: the first implementation fixed the cited claims, post-implementation review found another false statement, and the pre-merge panel found three more. The final `schemas/MODULE.md` repair checked the whole document file-by-file against the tree. The client landing then supplied the sharper case: two false MODULE claims were inherited, but one branch edit rewrote a vaguer true claim into a more specific false one. **Editing a factual documentation claim makes the whole claim yours**, not only the phrase in the diff. A slice whose payoff is document truth must verify every factual claim in that document; any other slice must at least verify every claim it materially edits. |
| Add `characterSpell` to `RestrictedDelegates` and the two `GATED_DELEGATES` copies now that the prepared-spell toggle is transaction-safe | Leaf 51 considered it (its step 3) and refused it deliberately. The fix is transaction-local, so gating the delegate bans direct writes repo-wide and leaves one guarded caller against a dozen ordinary writers — worse than no gate. `docs/CONCURRENCY.md` §Scope also still classes the spell list as a single-writer, non-candidate table. Re-open this only with the whole call-site inventory in hand, which is what the leaf asked for and nobody has produced. |
| Simplify `isPrismaSerializationFailure` (`packages/server/src/utils/prisma-errors.ts`) to the `P2034` check, or replace the retry-shape tests with unit tests that hand-roll the adapter's error | **Both branches are live and the second one is the common case.** Under `@prisma/adapter-pg` a statement-level abort maps to P2034, but an abort raised at an interactive `COMMIT` — which is where SSI usually reports anti-dependencies — is re-rejected as a bare `DriverAdapterError` with `cause.kind === "TransactionWriteConflict"` and no `code`. Measured 17:1 in favour of the un-coded shape on a four-way prepared-toggle race. A P2034-only predicate is exactly the bug this landed to fix: it made long rest's Serializable retry dead code for as long as it existed. `serializable-isolation.test.ts` pins both shapes against the *real* driver on purpose — hand-rolled shapes would stay green through an upstream rename while production stopped retrying. |
| Restore any wording that says Postgres SSI protects long rest against a concurrent `performLevelUp`, or add a deterministic secondary key story to it | It is false and it was in three documents and two code comments for months. `performLevelUp` runs READ COMMITTED, and SSI tracks anti-dependencies only between two serializable transactions. Long rest is protected by first-updater-wins on the `CharacterClass` rows `resetAllHitDice` writes. Probed 15/15, 15/15 and 10/10 against the real database, and pinned by `packages/server/src/utils/serializable-isolation.test.ts` — change the test before you change the prose. |
| Hand-list the relation names in `local/concurrency-guard`'s nested branch, or drop the parent-model rooting as over-engineering | The leaf's own hand-list was wrong: it named six relation paths, `schema.prisma` declares ten. The map is derived from the schema by `concurrency-guard-drift.test.ts` so schema growth breaks the guard instead of silently widening the escape. The rooting is not decoration either — without it, `spell.update({ data: { classes: { update: … } } })` is a hard error on a `Json` scalar, and a non-Prisma `store.update({ where, data: { stats: … } })` is a hard error on nothing at all. Both were reproduced. |
| Call a value or schema single-sourced before sweeping the whole tree for semantic duplicates | **Whole-tree straggler search is an acceptance criterion for every single-sourcing slice.** Review found a surviving duplicate on three consecutive deliveries, most recently three in merge `ec4d732c4`: fractional CR labels outside `formatCr`, drawing-tool defaults outside `DEFAULT_STROKE_COLOR`/`DEFAULT_STROKE_WIDTH`, and the freehand preview threshold outside `MIN_FREEHAND_POINTS`. Current anchors are pinned to `ec4d732c4`: `monster-form-data.ts:102`, `map-canvas-store.ts:199-200` and `drawing-overlay.tsx:170` now consume the shared sources. Search by both identifier and literal/semantic role; a new canonical export makes an undiscovered live copy more misleading, not less. **The criterion held on both later deliveries:** E1's sweep was clean, and the client cluster's sweep was clean across `packages/`, `scripts/` and e2e; all three panelists independently confirmed each result. Keep the check. |

## Coverage

**In scope:** all of `packages/{shared,server,client}/src` except generated
Prisma output; `scripts/` (all 162 root scripts by name, `lib/`, `git/`, `harness/`,
`ai-hooks/`, `tests/`, `path-policy/`, `codemods/` layout, plus sampled `drift-ai/`,
`code-intel/`, `logs-audit/`, `drift-triage/` module bodies); all 92 `eslint-rules/`
files by name and ~15 in full; every `eslint-config/*.js`; `tools/lint-ratchet/`;
all 6 root tsconfigs, all four Stryker configs (`stryker.config.mjs`,
`stryker.config.server.mjs`, `scripts/stryker-scripts.ts`,
`tools/stryker-lint-ratchet.ts`), all 10 vitest configs, `knip.config.ts`,
`playwright.config.ts`; `e2e/` in full (49 `.ts` files); `.husky/*`; all 171
package.json scripts across the six tracked manifests.

**Out of scope:** `harness.controls.json` internals (2,819 lines, treated as
generator input); `scripts/codemods/` implementations (452 files, mostly fixtures);
`packages/server/src/generated/`; most of `scripts/drift-ai/`'s 344 module bodies;
`docs/` beyond the files leaves cite. Absence of a leaf in these areas is not
evidence that they are clean.

**Deliberately excluded:** bug hunting and security review (use `/code-review` and
`/security-review`), and anything owned by
`docs/agent_notes/backlog/codebase-audit/` (closed 2026-07-19).

## Overlap with existing backlog

Three landed plans cover ground these leaves re-enter. Read them as prior art and
re-scope the leaf against what those slices already changed:

- `docs/agent_notes/backlog/arch-plans-2026-07/03-harness-hook-shim-generation.md`
  (Done, `3e9b28df`) → leaf 32, which states the boundary: that plan owns the
  generated `.claude`/`.codex`/`.copilot` shims, leaf 32 owns the git hooks the
  same convention excludes.
- `docs/agent_notes/backlog/arch-plans-2026-07/02-harness-cli-parse-spec.md`
  (Done, `62285ebb`, slices S0-S6) → leaf 30. That plan built the spec-driven
  `parseCli` in `scripts/lib/cli.ts` whose adoption tail leaf 30 measures. Read
  its slice records alongside the standing policy at
  `scripts/lib/process-argv.ts:8` ("Existing CLIs converge opportunistically; new
  CLIs import it") — together they are why a surviving hand-rolled walker is not
  automatically an oversight.
- `docs/agent_notes/backlog/arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md`
  (Implemented; S0+S1 landed as `ebe99dd0`, S3 dropped) → leaf 29. It is the
  precedent for the shape leaf 29's step 5 proposes — a TypeScript `*-core.ts`
  owning parse/serialize/transform behind a bash library that keeps locks,
  `mktemp`, git and `date` (`scripts/lib/verify-metadata-core.ts:3-6`). Its S2
  record carries the per-call cost of that split and the ruling that `jq` stays
  as a hook- and CLI-local exception; read both before extending the split to a
  new cluster.

One open note is genuinely competing work and must be reconciled before either
is scheduled: `docs/agent_notes/backlog/scripts-flat-family-reorg.md` (Parked) →
leaf 28.
