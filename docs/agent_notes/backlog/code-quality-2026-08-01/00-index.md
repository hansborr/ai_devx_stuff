# Codebase Quality Audit — 2026-08-01

Status: **Finalized and landed on `main` — Phase 5 and owner-requested round 6
closed; approved and merged 2026-08-08 together with [DRAIN.md](./DRAIN.md).**
Created: 2026-08-01 · Updated: 2026-08-13
Scope: full re-sweep of `packages/{shared,server,client}`, the harness
(`scripts/`, `tools/`, `eslint-rules/`, `eslint-config/`,
`harness.controls.json`), the test suite and `e2e/`, and `docs/` — with extra
weight on areas the 2026-07-25 audit never read. Feature-opportunity proposals
are in scope.

**269 leaves: 140 landed, 129 Not started; no leaf is promoted automatically.**
The owner made a priority call on 2026-08-06 — harness leaves first,
lint-related leaves within them — granted standing merge-on-green on
2026-08-08, and on 2026-08-14 queued the rest of the harness area for an
extended unattended drain. Dispatch runs off [drain.mjs](./drain.mjs)
(`node …/drain.mjs status`), with
[DRAIN.md](./DRAIN.md) as the loop around it; this index stays the evidence and
scheduling map.

This is a reviewed evidence pack and scheduling map, not a second ready queue.
An Area boundary does not imply safe parallel work: consult each row's relation
cell and the leaf's own caveats before choosing an implementation lane.

Companion files — do not inline them here:

- [drain.mjs](./drain.mjs) — the execution surface. `status` shows the lock,
  open lanes, and what is free; `plan <UNIT>…` gates a hand-picked set against
  the edge graph and prints its lane commands; `brief <UNIT>` renders the
  implementer or reviewer mission. Start here to dispatch anything.
- [DRAIN.md](./DRAIN.md) — the loop around that tool: the lock, the review
  cycle, landing, and the rules a tool cannot decide.
- [drain-queue.json](./drain-queue.json) — machine-enforced decisions, plan
  constraints, wave membership/order, and exclusions that `drain.mjs` reads;
  [DRAIN-NOTES § The queue](./DRAIN-NOTES.md#the-queue) owns their rationale.
- [DRAIN-LEDGER.md](./DRAIN-LEDGER.md) — historical landing narrative and the
  standing merge grants; merge commits on `main` determine what has landed.
- [DRAIN-NOTES.md](./DRAIN-NOTES.md) — lane hazards, queue rationale, and why
  the protocol is shaped this way. Read when a step misbehaves, not before.
- [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md) — lenses, scale, review results, and
  coverage limits.
- [CONSTRAINTS.md](./CONSTRAINTS.md) — standing rulings, resolved round-6 cut
  dispositions, excluded scope, and unanswered owner questions.
- [BUGS-HANDOFF.md](./BUGS-HANDOFF.md) — unverified suspected bugs for a later
  `/code-review`, outside this pack's queue.
- [DEDUP-CORPUS.md](./DEDUP-CORPUS.md) — the frozen prior-pack exclusion corpus
  used by the audit waves.
- [ORCHESTRATION.md](./ORCHESTRATION.md) — the audit contract, owner decisions,
  phase ledger, coverage process, and step-9/finalization sequence.
- [RUN-LEDGER.md](./RUN-LEDGER.md) — append-only run provenance.
- [edge-graph.json](./working/phase5/edge-graph.json) — the generated relation
  ledger behind this index: reviewed S3 rulings plus leaf-declared relations,
  with retirement and supersession accounting.
- [107-PLAN.md](./107-PLAN.md), [108-PLAN.md](./108-PLAN.md), and
  [109-PLAN.md](./109-PLAN.md) — sliced execution plans for the three XL leaves.

## Scheduling rules

- **An owner priority call selects the next leaf or plan.** Severity and Size
  describe the finding; they do not establish a queue. This index deliberately
  makes no priority recommendation; the call the owner made on 2026-08-06 and
  the queue derived from it live in [drain-queue.json](./drain-queue.json).
- **Use the relation tokens as a gate, then read both leaves.** Every token is
  relative to its row. `after:NNN` and `before:NNN` are hard order: the peer must
  land before this leaf, or this leaf must land before the peer, respectively.
  `pref-before:NNN` and `pref-after:NNN` express the same directions as
  reversible preferences. `serial:NNN` permits either landing order but forbids
  concurrent implementation; `coland:NNN` makes the pair one landing unit; and
  `rebase:NNN` permits either order but requires the later work to reconcile the
  earlier outcome. `moots:NNN`, `mooted-by:NNN`, `moots-part:NNN`, and
  `part-mooted-by:NNN` name which leaf may moot all or part of the other and
  require that outcome first. `alt:NNN` requires choosing one leaf before
  scheduling; `reconcile:NNN` requires a reconciliation decision first.
  `plan:NNN-PLAN` routes scheduling through the linked plan, whose internal
  slice order governs; how much of a plan one lane implements, and whether its
  slices are ordered at all, is per-plan and is keyed in
  [drain-queue.json](./drain-queue.json) under `plans`, which is what
  [`drain.mjs`](./drain.mjs) enforces. A row includes inbound constraints as well as constraints
  the leaf declared itself; `—` means no edge was recorded.
- **S3 is authoritative for a reviewed pair.** `S3 collides` and
  `S3 contradicts` rulings render as `S3-collides!<token>` and
  `S3-contradicts!<token>`; the prefixed token is the concrete sequencing remedy
  selected after a reviewer read both leaves in full. The generated
  [edge graph](./working/phase5/edge-graph.json) retains any older declaration
  under `supersededDeclared`; do not reconstruct order from the pre-remedy S1
  ledger.
- **The plan governs scheduling for 107, 108, and 109.** Read the linked
  `NNN-PLAN.md` for slice size, internal ordering, gates, and prior-pack
  coordination. The leaf row still carries cross-leaf edges, which remain in
  force around the plan's slices. How much of a plan one lane implements differs
  per plan — 108 lands whole, 107 and 109 land slice by slice — and so does
  whether the slices are ordered: 107 is strictly sequential, 109's S2–S4 are
  order-independent. Both facts are recorded per plan in
  [drain-queue.json](./drain-queue.json) under `plans`, transcribed from each
  plan's own `## Dependency edges`, and execution is keyed on those units rather
  than on the plan as a whole.
- **Numbering is stable, not contiguous.** Leaves 096 and 161 were retired by
  S3 merges into surviving leaves 198 and 142. Their numbering holes are
  deliberate; never renumber this pack or recreate either retired leaf as a
  scheduling unit.
- **Leaf headers record implementation state.** One hundred and forty live
  leaves name their landed batch branch and the other 129 say
  `Not started`. Read `## Scope / caveats`, resolve cited symbols against the
  audit pin/current tree as appropriate, follow TDD, and use the relevant
  `docs/guides/` guide before tRPC, Prisma, socket, race-sensitive, client
  cache/socket, e2e, rules, or ratcheted-lint changes.
- **The edge graph is a minimum known constraint set, not proof of
  independence.** A blank relation cell means no reviewed or declared edge was
  recorded; it does not waive ordinary collision checks against in-flight work
  or the separate 2026-07-25 pack.
- **The pack passed a clean substantive re-review.** The initial step 9 reviewed
  the repaired graph, generator, and index until round 4 found no P0/P1 defect.
  After round 6 reopened the pack, its step-9 re-review found no substantive
  defect; its stale reader-facing counts are corrected here. See
  [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md#the-clean-round-stopping-rule-mattered).

## Priority status

This pack still does not infer a priority from severity, size, Area, or graph
degree. On 2026-08-06 the owner called one: **harness leaves first, and
lint-related leaves within them.** On 2026-08-14 the owner called the next:
**after `lint-cluster` drains, the `gate-cost` queue** — leaves that cut the
per-land verify cost and gate flake ahead of the wider backlog — and then, for
an extended unattended drain, five further queues covering every remaining
harness leaf plus the three non-harness prerequisites they need
([DRAIN-NOTES § The queue](./DRAIN-NOTES.md#the-queue) has the derivation).
One hundred and forty leaves have landed on carrier branches and 129 remain
`Not started`. [drain-queue.json](./drain-queue.json) carries the waves
those calls select, `node …/drain.mjs plan <UNIT>…` is the edge gate each lane
must pass first, and merge commits on `main` record what lands.

## Leaf catalogs

The generated routing table below points to the complete leaf catalogs. Within
each catalog, leaves stay in stable number order and the relation column uses
the compact, row-relative scheduling tokens defined above.

A catalog is a storage shard, not a scheduling boundary. Each catalog row
contains the complete known inbound and outbound tokens for that leaf, but a
peer may live in any Area or catalog. Resolve every peer number across the full
declared catalog set and read both leaves before delegation. Catalog membership
and a blank relation cell do not prove safe parallelism.

`working/phase5/build-edge-graph.mjs` refreshes the routing region and every
catalog page; edit this prose, not the generated routing rows or catalogs.

### Global edge queries
Before sequencing or batching a set of leaves (the drain is serial-only — see [DRAIN.md](./DRAIN.md)), union and classify cross-catalog incident edges with `node docs/agent_notes/backlog/code-quality-2026-08-01/working/phase5/query-edge-graph.mjs set <NNN>... [--in-flight <NNN>...]`; no result proves independence. When you are dispatching rather than studying the graph, `node docs/agent_notes/backlog/code-quality-2026-08-01/drain.mjs plan <UNIT>...` runs the same query against live lane branches and merge commits on `main`.

<!-- BEGIN GENERATED LEAF CATALOG ROUTING -->
<!-- backlog-lint-catalog: LEAVES-SHARED.md -->
<!-- backlog-lint-catalog: LEAVES-SERVER.md -->
<!-- backlog-lint-catalog: LEAVES-CLIENT-039-062.md -->
<!-- backlog-lint-catalog: LEAVES-CLIENT-213-270.md -->
<!-- backlog-lint-catalog: LEAVES-TESTS.md -->
<!-- backlog-lint-catalog: LEAVES-E2E.md -->
<!-- backlog-lint-catalog: LEAVES-HARNESS-107-136.md -->
<!-- backlog-lint-catalog: LEAVES-HARNESS-137-167.md -->
<!-- backlog-lint-catalog: LEAVES-HARNESS-168-271.md -->
<!-- backlog-lint-catalog: LEAVES-DOCS-080-097.md -->
<!-- backlog-lint-catalog: LEAVES-DOCS-098-266.md -->
<!-- backlog-lint-catalog: LEAVES-CROSS-CUTTING.md -->

**269 live leaves across 12 generated catalogs.**

|Catalog|Area|Leaf count|Number range(s)|
|---|---|---:|---|
|[LEAVES-SHARED.md](./LEAVES-SHARED.md)|Shared|22|021–038, 221–222, 240, 250|
|[LEAVES-SERVER.md](./LEAVES-SERVER.md)|Server|28|001–020, 205, 210–212, 233–234, 256–257|
|[LEAVES-CLIENT-039-062.md](./LEAVES-CLIENT-039-062.md)|Client|24|039–062|
|[LEAVES-CLIENT-213-270.md](./LEAVES-CLIENT-213-270.md)|Client|24|213–216, 226–227, 235–239, 241, 247–249, 252, 258–263, 269–270|
|[LEAVES-TESTS.md](./LEAVES-TESTS.md)|Tests|16|063–076, 242, 264|
|[LEAVES-E2E.md](./LEAVES-E2E.md)|E2E|3|077–079|
|[LEAVES-HARNESS-107-136.md](./LEAVES-HARNESS-107-136.md)|Harness|30|107–136|
|[LEAVES-HARNESS-137-167.md](./LEAVES-HARNESS-137-167.md)|Harness|30|137–160, 162–167|
|[LEAVES-HARNESS-168-271.md](./LEAVES-HARNESS-168-271.md)|Harness|29|168–177, 204, 206–209, 220, 224–225, 230–232, 243, 245–246, 253–255, 267, 271|
|[LEAVES-DOCS-080-097.md](./LEAVES-DOCS-080-097.md)|Docs|17|080–095, 097|
|[LEAVES-DOCS-098-266.md](./LEAVES-DOCS-098-266.md)|Docs|16|098–106, 217–218, 223, 228, 251, 265–266|
|[LEAVES-CROSS-CUTTING.md](./LEAVES-CROSS-CUTTING.md)|Cross-cutting|30|178–203, 219, 229, 244, 268|
<!-- END GENERATED LEAF CATALOG ROUTING -->
