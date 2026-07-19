# Sequential Drain 2026-07 — Task Pack

Status: Task index
Created: 2026-07-15
Source: 2026-07-15 whole-backlog actionability sweep (four explorer reports
over every pack and standalone note) followed by a per-leaf adversarial
verification pass against HEAD `ab318d05`. Verification evidence, the list of
stale "open" leaves that turned out to be already landed, and the exclusion
verdicts live in
[`01-verification-record.md`](./01-verification-record.md) — read that before
proposing anything from the source packs that is not listed here (it may
already be shipped or deliberately excluded).

## Working model

This pack is drained **sequentially, one leaf at a time, on stacked
branches** — each leaf's branch is cut from the previous leaf's branch so
every review diff is exactly one leaf. No parallel lanes. Review and land
(merge the stack into `main`) at phase boundaries so the stack never grows
past one phase deep.

Leaves live in their source packs; this index is the ordering and status
authority for the drain. When a leaf lands, mark it Done **here and in its
source pack's index**. Re-verify `file:line` seams before editing — they were
verified 2026-07-15 and drift fast.

## Task list

Phases follow the owner's priority: worktree/dispatch pain points first, then
ratchet residue, then hooks/gate machinery, then sensors and test quality,
then the discretionary tail. Within a phase, drain top to bottom.

### Phase 0 — index hygiene (do first, no code)

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 0.1 | [Reconcile stale statuses across source packs](./02-reconcile-stale-source-pack-statuses.md) | this pack | S | Done — reconciled 2026-07-15 against `01-verification-record.md`; `backlog:lint` index-leaf drift cleared |

### Phase 1 — worktree & dispatch pain points

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 1.1 | Per-worktree test-scripts log dir | harness-explore-2026-07 / 07 | XS | Done |
| 1.2 | Reflink-clone lane dependencies in worktree:init | worktree-provisioning-2026-07 / 01 | M | Done |
| 1.3 | worktree:new failure recovery | worktree-provisioning-2026-07 / 02 | S | Done |
| 1.4 | worktree:drop full teardown (`--remove`) | worktree-provisioning-2026-07 / 03 | M | Done |
| 1.5 | Worktree-aware commit guards (items 1/3/4) | harness-sweep-2026-07 / 45 | M | Done — item 1 already landed via 008029e2 (pinned with new lane commit-guard tests); item 3 tidy hook now resolves per-file worktree root; item 4 marker-vanish tripwire added |
| 1.6 | agent-cli dispatch UX fixes | standalone note | M | Done |

### Phase 2 — ratchet residue & merge-driver exercise

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 2.1 | Upgrade-churn classification, half (a) only | harness-review-2026-07 / 18 | S | Done |
| 2.2 | Merge-driver field exercise | standalone note | L | Done — adversarial real-merge validation; findings in `merge-driver-field-exercise-findings.md` (removed 2026-07-19; git history); driver sound across all classes + rebase/cherry-pick; sharding stays won't-do; filed low-pri driverless-window leaf |
| 2.3 | Split the lint-ratchet guide | harness-explore-2026-07 / 21 | S | Done — merge runbook split out; old anchor preserved |
| 2.4 | lint-ratchet module renaming | harness-explore-2026-07 / 20 | M | Done |

### Phase 3 — hooks & gate machinery

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 3.1 | SubagentStop stop-policy adapter | harness-review-2026-07 / 52 | S | Done — adapter + manifest entry landed (`f58262ac`); systemMessage output rationale recorded (`4285af0f`). Follow-up resolved 2026-07-16: stop-family nudges stay off pending an attribution mechanism (owner decision — see [`03-phase3-review-followups.md`](./03-phase3-review-followups.md) item 4); adapter kept as reference wiring |
| 3.2 | Salt the lint-agent ESLint cache | harness-explore-2026-07 / 03 | S | Done |
| 3.3 | Name the gate timing constants | harness-explore-2026-07 / 04 | S | Done — constants placed in `scripts/lib/verify-metadata.sh` rather than `gate-env.sh` (all consumers already source it) |
| 3.4 | Generated-surface staleness regex from manifest | harness-explore-2026-07 / 05 | S | Done |
| 3.5 | Doctor-check manifest parity | harness-explore-2026-07 / 06 | S | Done |
| 3.6 | Shared changed-file collection | harness-explore-2026-07 / 08 | M | Done |
| 3.7 | Changed-scope suppression scanners | harness-explore-2026-07 / 09 | M | Done |
| 3.8 | Hook trio dedup | harness-explore-2026-07 / 11 | S | Done — deduped 4 merge-driver installs (verification-record correction); `worktree-db.sh` wrappers deliberately left |
| 3.9 | Suppression policy as data + dead hadolint pin | harness-explore-2026-07 / 12 | M | Done — hadolint pin made effective (`1edc16f3`) + suppression allowlists as data (`761f0d98`) |
| 3.10 | Record gate run mode | harness-explore-2026-07 / 16 | S | Done |
| 3.11 | [CI/local gate parity guard](../ci-local-gate-parity-guard.md) | standalone note | M | Done |
| 3.12 | Porting-knob greppable markers | harness-explore-2026-07 / 19 | M | Done |

### Phase 4 — sensors & test quality

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 4.1 | Near-duplicates baseline truth at integration boundaries | lint-review-followups-2026-07 / 01 | M | Done — blocking pre-push near-duplicates boundary gate (`99fe7815`/`164191b6`/`0cec8cd5`/`2e586eff`); env-failures surface but don't block; truth-up exit-code attribution; `scripts/git/baseline-drivers.sh` registry |
| 4.2 | Near-duplicates gate honors configured thresholds | lint-review-followups-2026-07 / 07 | S | Done — `065266c4` |
| 4.3 | Baseline admission artifact (`--admit`) | lint-review-followups-2026-07 / 03 | M | Done — `4a260e12`; `--admit <identity> --reason`, rename migration, reasons survive merges/truth-up |
| 4.4 | lint-message-eval paired iteration delta | lint-review-followups-2026-07 / 04 | S | Done — `952d67eb`; paired-only delta (real test file is `scripts/lint-message-eval.test.ts`) |
| 4.5 | Compose structural ignore lists in shared-policy | lint-review-followups-2026-07 / 06 | M | Done — `3f2ca4d2`; composed list deliberately gains the server `__type-tests__` glob (strict superset, 0 baseline items affected — owner-approved heal) |
| 4.6 | [Drift provenance contract v2, items 1/3/4](../drift-triage-2026-07-13/REVIEW-FOLLOWUPS.md) | drift-triage-2026-07-13 | M | Done — items 1/3/4 (`e2750f17`/`e9d00a48`/`a5f2dda5`); item 2 already landed via `31ce6e49` |
| 4.7 | [Finish tmp-repo helper adoption](../testsuite-audit/00-index.md) | testsuite-audit / 32 | S | Done — `0fa03a57`/`0dd8c183`/`c639a2f8`/`4762528e`; all 15 remaining hand-rolled drain loops migrated |
| 4.8 | [Coverage-map governance checks A4 + A5 (membership half)](../agent-friction-2026-06/00-report.md) | agent-friction-2026-06 / A4, A5 | M | Done — A4 + A5 membership half (`4ba3e561`); A5 generation half stays open |
| 4.9 | [Codemod-engine dedup for trpc-shared codemods](../drift-ai-current-findings.md) | drift-ai-current-findings / #8 | S | Done — `8454fab4` |

### Phase 5 — discretionary tail

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| 5.1 | [Extend property-based tests beyond character-rules](../harness-research-followups-2026-06/00-index.md) | harness-research-followups-2026-06 / PB-1 | M | Done — `d10d67b9`; spellcasting/armor-class/dice property tests (22 tests) |
| 5.2 | [`executeLongRest` ctx-first reorder](../codebase-audit/00-report.md) | codebase-audit / 09 step 3 | S | Done — `60e08986`; deviation: BOTH rest cores moved to `(ctx, character, input)` to preserve core-signature parity (spec premise that only executeLongRest differed was stale) |

### Post-drain follow-ups

| # | Task | Source | Size | Status |
|---|---|---|---|---|
| F.1 | [Phase 3 review follow-ups](./03-phase3-review-followups.md) | this pack | S | Open — three low-priority residues from the Phase 3 pre-land review (trigger-group sharing, generator-import consistency test, porting-knob scan roots); item 4 (SubagentStop delivery) resolved 2026-07-16 as a keep-off-pending-attribution decision |
| F.2 | [Phase 4/5 review follow-ups](./04-phase45-review-followups.md) | this pack | S | Open — two low-priority residues from the Phase 4/5 pre-land review (derive pre-push scan-trigger extensions from scope source; sibling-worktree hint for the non-HEAD push guard) |

## Promotion rules

1. Drain strictly in table order; one leaf per stacked branch; land the stack
   into `main` at each phase boundary after review.
2. Read [`01-verification-record.md`](./01-verification-record.md) before
   starting a leaf, and the leaf's own source note for the full spec.
3. Reconfirm seams with `rg` / `bun run code:intel` before editing; the
   2026-07-15 verification recorded exact `file:line` evidence but paths
   drift.
4. When a leaf lands, mark its row Done here **and** in the source pack's
   index; durable context goes in the commit.
5. Do not promote anything from the excluded list in
   [`01-verification-record.md`](./01-verification-record.md) without owner
   sign-off — every exclusion has a recorded reason.
