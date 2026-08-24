# Codebase Quality Audit — 2026-07-25

Status: Parked evidence pack — no leaf is promoted automatically
Created: 2026-07-25 · Updated: 2026-08-01
Scope: refactor / simplification opportunities across `packages/{shared,server,client}`, the harness (`scripts/`, `tools/`, `eslint-rules/`, `eslint-config/`) and the test suite.

**20 leaves open, 52 [landed or deliberately closed](#landed).** Next
candidate: **owner priority call required**.

**This pack is worked one lane at a time, in series.** Promote a single leaf into
`in_progress/` after an owner priority call, finish it, then take the next. This
index is not a second ready queue.

Companion files — do not inline them here:

- [CONSTRAINTS.md](./CONSTRAINTS.md) — the do-not-propose ledger (changes that
  look attractive and are wrong here) plus the landed plans these leaves
  re-enter. Read before accepting scope this pack does not already carry.
- [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md) — what the audit found, the comment and
  naming lenses, and the in/out-of-scope boundaries. Background, not scheduling
  input.

## Scheduling rules

- **The plan is the schedulable unit, not the leaf.** 18 of the 20 open leaves
  are superseded by a plan (see the `Plan / remaining slices` column). Plans
  re-scope substantially: sizes shrink and steps are dropped. Read the plan for
  what to do, the leaf for evidence, and each plan's `State` column for what is
  left.
- **Read the leaf's `## Scope / caveats` before starting.** Several leaves have
  an obvious fix that is wrong — a render-phase Zustand reset, a formula that
  changes `proficiencyBonus(21)` from 2 to 6, a runtime import cycle, a schema
  change that strips legacy persisted homebrew keys.
- **`## Problem` and `## Evidence` are load-bearing** — every claim carries a
  `path:line` or a measured count. Line anchors rot; re-resolve by symbol name,
  but expect the claim to hold. Each leaf declares its own evidence pin in its
  header (leaves 01-49 pin to `883d48bf`).
- **Rows for 07, 34, 40, 42 and 53 carry the *leaf's* pre-plan `Sev`/`Size`**
  (marked \*); each plan applies its own "Index reconciliation" when its first
  slice lands. 34, 40 and 42 leave the XL bracket then, and 53 goes L → M;
  **07-PLAN re-scopes leaf 07 into five slices but does not resize it**, so that
  row's XL is its settled value, not a pending one.
- **One leaf = one coherent piece of work**, usually several commits — except 40
  (three leaves), 31 (three, its L being per-part), 27 (two) and 07 (five slices
  in two independent streams, per [07-PLAN](./07-PLAN.md), not the leaf's own
  three), which name their own split before scheduling.
- **Do not start with** leaves 29 or 32 (four-figure bash and the commit gate
  itself — the highest operational risk in the pack), or any XL leaf (07, 27, 28,
  34, 40, 42) without reading its `NN-PLAN.md` first.
- **Any leaf that changes the *shape* of a file a scripts-project drift guard
  parses** — `prisma-types.ts`, `eslint-rules/*.js`, the harness manifests —
  must run `bun run verify`, not `verify:changed`: the `scripts` slot is outside
  changed-mode scope for a server-only diff. Harness gap, tracked in
  `/home/node/persist/musi/pain_points/focused-verification-gaps.md`.
- Follow TDD and the relevant `docs/guides/` guide before tRPC, Prisma, socket,
  race-sensitive, client cache/socket, e2e, rules, or ratcheted-lint work.
- Keep the backlog README's entry for this pack in step with this index.

## Next up

**Owner priority call required.** The scheduled
[SERVER-COMMENTS](./SERVER-COMMENTS-PLAN.md) remainder is finished: S14-S16 are
landed as merge `a01edb455`. S17-S20 remain optional and are
not promoted automatically. Leaf 45 is closed; leaf 46 stays open only on S19
and S20, just as leaf 03 stays open only on S17 and S18.

**Leaf 06 is finished but its steps 5-8 are parked, not open.** They rewrite or
depend on committed generator output that no gate and no implementer without
`docs/refs/` cloned can verify — a property of the documented input design, not a
scheduling gap. Do not re-file them as pickup work.

## Open leaves

| # | Leaf | Area | Sev | Size | Plan / remaining slices |
|---|---|---|---|---|---|
| 03 | [Authorization helpers take the caller three different ways](./03-authz-caller-contract.md) — **only the optional S17 and S18 remain** (leaf steps 4 and 6); no scheduled work is left | server | medium | M | [SERVER-COMMENTS](./SERVER-COMMENTS-PLAN.md) S17/S18 (both optional) |
| 07 | [Spell-casting and level-up widen their own types, then re-narrow downstream](./07-spell-casting-and-level-up-shape.md) — next slice **07.1**, now down to its comment/doc/test remainder (`utils/string-order.ts` and the four repointed `spell-casting/` copies are done); then 07.2/07.3, with 07.4/07.5 as an independent stream | server | medium | **XL**\* | [07-PLAN](./07-PLAN.md) 07.1-07.5 |
| 27 | [Shell smoke suites re-declare their own test framework per file](./27-shell-test-substrate.md) | harness | medium | **XL** | [27-PLAN](./27-PLAN.md) |
| 28 | [The `scripts/` layout contract is prose-only](./28-scripts-layout-families.md) | harness | medium | **XL** | [28-PLAN](./28-PLAN.md) |
| 29 | [`worktree-db.sh`/`stop-policy.sh` hold seven copies of one state codec](./29-bash-to-ts-cores.md) | harness | medium | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H1/H2 landed in `2667ee8e0`; H11/H12 remain blocked on unlanded 28-PLAN slice 28.1 |
| 30 | [Canonical CLI primitives exist, but argv offsets have seven spellings](./30-cli-arg-substrate.md) | harness | medium | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H3-H5 landed in `ac3ce2b0f`; no scheduled slice remains |
| 31 | [Leaf-utility layer: guard adoption, shell finding shape, path-policy duplication](./31-harness-shared-helpers.md) | harness | medium | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H6-H10 landed in `1bfbfc115`, `e7462ee51`, and `bdc120756`; H14 landed in `64a7fac64`; H15 remains blocked on unlanded 27-PLAN slice 27.3; normalized changed-scope path factoring is recorded but unscheduled |
| 32 | [Git hooks hold 900 lines of gate orchestration inline](./32-git-hook-shims.md) | harness | medium | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H16/H17 landed in `c6e1be2a2`; no scheduled slice remains |
| 33 | [Harness env vars carry several prefixes and no documented rule](./33-env-var-prefixes.md) | harness | low | S | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H17 landed in `c6e1be2a2`; no scheduled slice remains |
| 34 | [drift-ai/drift-triage carry contracts as free-form records and positional params](./34-drift-ai-typing.md) | harness | medium | **XL**\* | [34-PLAN](./34-PLAN.md) |
| 35 | [code-intel and logs-audit carry structure by convention](./35-code-intel-internals.md) | harness | medium | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H18/H19 landed in `57ef569e5`; optional H20/H21 remain unstarted |
| 36 | [lint-ratchet's portable kernel speaks the vocabulary of a system it is not](./36-lint-ratchet-vocabulary.md) | harness | low | L | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H22/H23 landed in `e2dc60cb9`; steps 3 and 4 were dropped, so no scheduled slice remains |
| 40 | [Test inputs are inline literals and positional tuples, not typed factories](./40-test-payload-factories.md) | tests | medium | **XL**\* | [40-PLAN](./40-PLAN.md) |
| 41 | [The client's tRPC test mock is a 603-line untyped shadow router](./41-mock-trpc-typing.md) — scheduled slices 41.1 and 41.2 are implemented; only the optional tidy remains | tests | medium | S | [41-PLAN](./41-PLAN.md) 41.3 (optional, not scheduled) |
| 42 | [Encounter combat E2E is one 22-test serial narrative repairing shared state](./42-e2e-encounter-narrative.md) | tests | medium | **XL**\* | [42-PLAN](./42-PLAN.md) |
| 46 | [Identifiers name the wrong thing (owns leaf 17's pure renames too)](./46-naming-renames.md) — **only optional S19 and S20 remain**; no scheduled work is left | cross-cutting | low | S | [SERVER-COMMENTS](./SERVER-COMMENTS-PLAN.md) S19/S20 (both optional) |
| 49 | [path-policy fixture analyzer: nine modules, no `MODULE.md`, one 803-line test](./49-path-policy-fixture-analyzer.md) | harness | low | M | [HARNESS-CLUSTER](./HARNESS-CLUSTER-PLAN.md) H13/H14 landed in `64a7fac64`; H15 remains blocked on unlanded 27-PLAN slice 27.3; the test split was dropped |
| 53 | [Initiative ties need a DM-facing resolution workflow](./53-initiative-tie-resolution-policy.md) | shared+server+client+socket | low | L\* | [53-PLAN](./53-PLAN.md) |
| 71 | [The lint and runtime nested-write walkers duplicate one subtle payload-state machine](./71-nested-write-walker-parity.md) — future simplification only; runtime remains authoritative and the 45-case lint floor stays until replaced | harness+server | low | M | — |
| 72 | [Sheet capability gating can fail open when a prop builder gains a callback](./72-sheet-capability-callback-source.md) — future-drift hardening; the empty viewer details region is opportunistic only | client | low | S | — |

\* pre-plan value; the plan's reconciliation applies when its first slice lands
(see the `Sev`/`Size` rule above — 07 is the one that will not move).

**Leaf 53 carries an owner ruling** (`## Decided direction`, DM resolution over
an automatic secondary key). The ruling decides *what*, the plan decides *how*,
and the plan does not re-open it.

## Cluster state

Each plan's `State` column is the authority; do not infer pickup work from the
leaves.

- **Shared: finished.** 21 of 22 slices landed; U3 is closed-declined.
- **Client: finished.** All 15 slices landed across merges `6cf8c78d5` and
  `d539cfdbd` — [CLIENT-CLUSTER-PLAN.md](./CLIENT-CLUSTER-PLAN.md).
- **Server/comments: scheduled work finished.** S14-S16 are implemented; S17-S20
  remain optional — [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md). Leaf 67
  was an unplanned review follow-up and did not re-open S13.
- **Harness: in progress.** 18 of 23 slices landed across merges `2667ee8e0`,
  `ac3ce2b0f`, `1bfbfc115`, `e7462ee51`, `bdc120756`, `c6e1be2a2`,
  `e2dc60cb9`, `57ef569e5`, and `64a7fac64`. Five slices remain open: H11 and
  H12 are blocked on unlanded 28-PLAN slice 28.1, H15 is blocked on unlanded
  27-PLAN slice 27.3, and H20/H21 are optional and unstarted —
  [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md). Leaf 68 is an unplanned
  residual now closed by focused assertions over the two existing copy lists;
  it did not start or re-scope the cluster.

## Dependency edges

Serial single-lane work already removes the file-collision hazards several of
these edges also guarded; what is left is ordering.

- **Server/comments** — no scheduled edge remains. Only the optional
  `S17 → S18` pair remains.
  Use [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md#dependency-edges), not
  the leaves' own chain.
- **Harness** — per
  [HARNESS-CLUSTER-PLAN.md](./HARNESS-CLUSTER-PLAN.md#dependency-edges):
  `28.1 → H11/H12`, `H1 → H11 → H12`, `H13 → H14 → H15`, `27.3 → H15`, soft
  `H6 → H7`, and the optional `H18 → H20 → H21`. H6-H10, H16-H19, H22 and H23
  are landed; this index does not choose the next slice. The leaves' own wider edges are superseded — the
  plan narrows `27 and 32 → 31 step 13` to `27.3 → H15` (leaf 32 step 4 is not
  scheduled) and dissolves `31 ↔ 49` by merging leaf 31's path-policy third into
  H13-H15.
- **Tests** — 40 and 42 are unblocked; 42 restructures against the typed
  `e2e/helpers/api.ts` that leaf 47 produced.
- **Competing parked work:** leaf 28 vs
  `docs/agent_notes/backlog/scripts-flat-family-reorg.md` — reconcile before
  scheduling either.

## Landed

Fifty-two leaves — 01, 02, 04-06, 08-26, 37-39, 43-45, 47, 48, 50-52,
54-70 — landed or were deliberately closed across twenty-seven
deliveries, 2026-07-26 to 2026-07-31. Leaf 38 is implemented on branch
`fix/cq-38-eslint-rule-helpers` as `aa637df60`, `baea1e65a`, `f543b18e0`,
`b5f25bc3f`, `510a8e5ec`, and `7bfabf09f`: its single AST-helper home is
protected by an export-driven collision test, its registry is ordered and
complete, and rule changes force those guards under changed verification. Its
third part was deliberately declined after implementation review: the three
config-focused suites stay in `eslint-rules` because a separate
`eslint-config` project added substantial ownership plumbing and a second test
command without adding behavioral coverage. That rejected split is not
follow-up work. The separate central-mock extraction was deliberately not
promoted. Leaf 60 is implemented on branch
`fix/cq-60-nested-write-runtime-guard`: one generated reachable relation subgraph now drives the
non-authoritative nested lint diagnostic and the mandatory Prisma runtime
guard; every client construction uses the guarded factory, and helper/spread
payloads plus both transaction forms are pinned. v1 deliberately leaves
create/delete/connect-style operators and raw SQL outside the boundary. Leaf
64 is implemented on branch
`fix/cq-64-70-guard-corpora`: at landing, the direct and nested concurrency
detectors ran shared, non-empty behavior corpora in both AST engines. Leaf 60
later retired the nested ts-morph detector while preserving its ESLint
diagnostic and all 45 former parity cases in a lint-only corpus; the direct corpus still pins the wrapped
alias, function-parameter, initializer-wrapper, renamed-parameter and
template-member cases. Leaf 64's bundled concurrency disclosure/comment/race-
test residue remains closed. Leaf
70 is the second commit on that branch: the helper-collision guard now protects
all named exports from every other JavaScript module per rule target at every
declaration depth, and the one surfaced byte-identical helper copy was replaced
by its shared import without an allowlist. Leaf 45 is implemented on branch
`feat/cq-server-comments-s14-s16`, merge `a01edb455`. Leaves 58 and 59 are
implemented on branch `fix/cq-58-59-prepared-spell-writes` as `dba7a6190` and
`4fe710e4e`. Leaves 62 and 67 are implemented on branch
`fix/cq-62-67-identity-and-docs` as `e0651d774` and
`e02a4c676` + `3d46a513e`. The same branch completed the separate DM
live-state campaign-input sweep in `b83a6bd91`. Leaf 66 is implemented on
`fix/cq-66-sheet-owner-capability` as `f0f180778`, with review corrections
through `2f478da92`, merged as `51065bc7c`: one render-time access discriminant now projects owner-only
structural and owner-or-DM live-state callbacks without a whole-sheet mode,
read-gate change, or dialog lifecycle work. Existing read policy remains
settled: inventory and enriched spell lists are owner-only, while public
`character.get` retains raw known-spell junction rows. Its two non-blocking
pre-merge panel residuals are filed as open leaf 72 rather than reopening the
landed leaf. Leaves 57 and 65 are implemented
on branch
`fix/cq-57-65-vacuous-guards` as `cf0f85d34` and `4c252b8e3`, with review
follow-ups `69360d873`, `9fa1958ba`, `8f8100169`, and `08ec2fbf7` (the last
supersedes the exact snapshot-key mirror from `8f8100169`).
Leaf 68 is implemented on branch `fix/cq-68-69-fixture-and-control`: both
lint-ratchet sandbox copy lists now fail at a focused static-import closure
assertion before building a sandbox. The lists remain local, the generic
`unmodelled-copy` escape remains accurate, and no fixture framework or parser
was added.
Leaves 56 and 63 were handled on branch `fix/cq-56-63-client-freshness` as
`7df7ce125`/`740873071`/`44dbf450e` and
`e740ee638`/`bfc6d7b77`/`5fd87705c`: leaf 56 gives immutable lists infinite
freshness without unbounded parameterized retention, while leaf 63 now
invalidates the initiating client's whole character-detail family and
deliberately accepts unbounded cross-client staleness rather than adding the
authoritative event. Its unrelated roll-test residue is now closed by leaf 69,
which adds authorized rendered controls for the Strength-check and equipped-
Longsword affordances beside the denial. The optional failed-lookup hook case is
deliberately closed without another test: the library matrix already pins raw
identity for the error state, and the composition suite already asserts both
independent hook calls.

The still-open harness cluster has also landed 18 of 23 slices across nine
deliveries: `2667ee8e0` (H1/H2), `ac3ce2b0f` (H3-H5), `1bfbfc115` (H6/H7),
`e7462ee51` (H8), `bdc120756` (H9/H10), `c6e1be2a2` (H16/H17), `e2dc60cb9`
(H22/H23), `57ef569e5` (H18/H19), and `64a7fac64` (H13/H14). These partial
landings do not close the harness leaves in the open table: H11/H12 await
unlanded 28.1, H15 awaits unlanded 27.3, and optional H20/H21 are unstarted.

**Each landed leaf's own `Status` header carries its branch, merge and recorded
divergences**; the cluster plans carry the per-slice records and their landing
outcomes. Nothing here needs re-reading to schedule the open work.

**Where an implementation diverged from its leaf's `## Proposed direction`, the
divergence is a recorded decision, not an oversight, and must not be
re-scheduled from the leaf.** Durable rulings are in
[CONSTRAINTS.md](./CONSTRAINTS.md).

## Constraints on future proposals

Moved to [CONSTRAINTS.md](./CONSTRAINTS.md): 38 rulings on changes that look
attractive from the outside and are wrong here, plus the three landed plans these
leaves re-enter. Check it before proposing scope, and before overturning a
recorded refusal.

The durable concurrency corrections live in [CONSTRAINTS.md](./CONSTRAINTS.md),
`packages/server/src/utils/serializable-isolation.test.ts`, `docs/CONCURRENCY.md`
and ADR-0007 — do not re-derive them.

## Coverage

Moved to [AUDIT-SUMMARY.md](./AUDIT-SUMMARY.md#coverage): what was audited in
full, what was sampled, and what was never looked at. Absence of a leaf in an
out-of-scope area is not evidence that it is clean.
