# Ready Queue 2026-07 — Task Pack

Status: Task index
Created: 2026-07-19
Updated: 2026-07-29

Source: 2026-07-19 whole-backlog readiness sweep, drained through 2026-07-20.
Standalone ready notes were **moved into this pack** (leaves 01–10);
pack-resident ready leaves **stay in their source packs** and this index is
the single tracking surface for them.

**2026-07-25 owner rulings.** The old D section is cleared: the
restricted-syntax builder and the suppression ledger were both approved and
queued (`F5`, `F6`); the ai-hooks marker race was scoped to the `REPO_ROOT`
consistency fix (`F7`); the join page gets an explicit confirmation rather than
auto-join (`F8`); and propose-mode registry validation was trimmed. C3's
promotion question was sized by a scoping pass and ruled extract-then-promote,
so it too is now a §1 row. That emptied section 4, which has since taken
**two** calls: `D1`, filed when `F3` landed, and the one the **2026-07-25 C8
plan review** raised — who owns the shared edited-path resolver, C8 S3 or the
approved-P1 edit-hook work (§4). All four of `F5`–`F8` have since landed in the
wave-1 integration; see the close-outs below.

**2026-07-25 `F3` close-out.** ADR expansion pass 2 landed
(`c79fbeb4`, `08474de9`, `c9a38ecb`, `ffb41eaf`, `19385a38`, plus the pre-land
review fixes). The row is trimmed from §1 and archived in the drain record; its
one deferred decision — how to retire the three `decisions-*.md` source notes —
is `D1` in §4.

**2026-07-25 `F2` close-out.** The git-exec seam drain landed (`463246c1`,
`8ed201b4`, `4b1e308d`, `334a9ce3`, `59555874`); its own branch carried no
bookkeeping commit, so the row is trimmed from §1 and archived in the drain
record here.

**2026-07-25 `B5` close-out.** The TS/JS-entry import-closure guard landed
(`1656c76a`, review fixes `cc1f8a86`, `bb6ea97a`, `c8b27f49`, wave-1 merge
`b5d49f2c`, plus the post-merge memoization `b07e769d` / `5f973df3`).
`scripts/path-policy/fixture-import-closure.ts` now closes every copied
`scripts/**` TS/JS entry over its import graph, so the row is trimmed from §1
and archived in the drain record.

**2026-07-25 `B22` close-out.** Typed harness-controls parser phase 2 landed
(`2500fd63`, `56240a02`, `afa09568`, `17edc7de`, `bf07da81`, docs `6a529018`,
`b20a081a`, review fixes `c63c7071`, `5394835d`, wave-1 merge `a2fcd3b0`, plus
the cross-branch correction `e41dcfa4`). The `reader-pending-migration` class in
`MANIFEST_DIRECT_READERS` is empty and the owed guide is
`docs/guides/harness-manifest-parser.md`; the row is trimmed from §1 and
archived in the drain record.

**2026-07-25 `F6` close-out.** The suppression identity ledger landed
(`264d565e`, `0f17ad0f`, `6e2692eb`, `fb2e2bf1`, `fd998b2c`, review fixes
`db2ffc23`, `8507d374`, `29d04525`, wave-1 merge `8220ec4f`).
`suppression-ledger.json` is committed and the `suppression-ledger` slot runs in
all four slot sets, so the row is trimmed from §1 and archived in the drain
record.

**2026-07-25 `F7` close-out.** The ai-hooks `REPO_ROOT` consistency fix landed
(`1fe5b424`, wave-1 merge `fec03ab7`) — it rode in on
`fix/commit-landing-guard-attribution` rather than a branch of its own.
`scripts/ai-hooks/protected-files.sh:11` now defaults instead of overwriting and
the marker-dependent coverage moved to `test-protected-files-marker.sh` with a
parallel-run regression; the row is trimmed from §1 and archived in the drain
record.

**2026-07-25 `C3` part-landing — the row stays open.** Extraction steps 1–4
landed (`b08f5f6f`, `8973351b`, `10dd8706`, `ed43a999`, review fixes `a816d722`,
`8d20e70a`, wave-1 merge `7b3e8a84`), taking the exact tier from 589 to 168
identities. **Step 5 is untouched** — `includeExactTokens` is still `false` at
`scripts/sensor-near-duplicates-core.ts:68` — so the §1 row below is rewritten
down to step 5 alone. Do not redispatch steps 1–4.

**2026-07-25 pre-land review round.** Every branch in the wave-1 integration
went through a Codex fan-out review, several also through a Grok review, and a
fix pass before merging; the per-row review-fix shas are recorded in the drain
record.

**2026-07-25 re-verification.** Six parallel agents re-checked every row
against HEAD `2595a48b`. The 41 closed rows (plus 2 partials) were trimmed to
[`../../finished_work/ready-2026-07-drain.md`](../../finished_work/ready-2026-07-drain.md),
which keeps their landing shas. Every surviving row below was re-read against
the live tree: seams re-verified, drifted claims corrected in place, and three
rows moved because their recorded state was wrong — **C3 already landed**, **C4
is in flight, not unstarted**, and **C8's blocker is its own design forks, not
C7**. Four follow-ups (`F1`–`F4`) were re-filed out of trimmed rows that had
carried residual scope.

**2026-07-29 C8 ownership decision.** The owner carved the immediate
producer-footer Bash compatibility repair out of the C8 rider as
[`../pain-points-2026-07-29/02-parallel-verify-lane-isolation-plan.md`](../pain-points-2026-07-29/02-parallel-verify-lane-isolation-plan.md).
C8 S4 remains the later typed command-policy owner of target classification
and adapter state-path propagation; when it eventually lands, it must preserve
the producer-authoritative failure-evidence behavior leaf 02 establishes
rather than reintroducing hook-checkout defaults.

## Working model

- Sections are ordered by **dispatch state**, not size. §1 can go out today
  as written. §2 is already running. §3 has had its plan-review round and is now
  partially dispatchable. §4 is where owner questions go; it currently holds two
  — `D1` and the C8 edited-path resolver call.
- Each §1 row's "Dispatch notes" column carries the re-verified entry point and
  the corrections a delegate needs; the linked leaf is the spec, but where the
  two disagree, **this table is newer**.
- Re-verify `file:line` seams before editing. They were verified 2026-07-25 and
  drift fast — the last sweep found ~30 drifted refs in six days.
- Items are independent unless a row says otherwise. §1 is down to one row after
  the wave-1 integration — C3 step 5, whose three parts are sequenced and want
  one lane between them; §2/§3 want one dedicated lane each.
- When an item lands, record it in the drain archive **and** its source pack's
  index in the same commit.

## 1 — Ready to dispatch now

| # | Task | Source | Size | Dispatch notes (verified 2026-07-25) |
|---|---|---|---|---|
| C3 | Near-duplicates exact tier, **step 5 only**: detector fix, residual drain, then the gate flip | lint-review-followups-2026-07 / 02 | M, sequenced internally | **Steps 1–4 landed 2026-07-25 (`7b3e8a84`) — do not redispatch them.** The four extractions (`eslint-rules/ast-helpers.js` −81, shared `isRecord` −196, `isCliEntrypoint` −91, `errorMessage` −53) took the exact tier 589 → 168 identities / 65 groups; the fuzzy/gated baseline is unchanged at 27. What remains, in order: **(a)** the detector fix, not a baseline entry — skip function-likes that are object-literal property values inside a call argument, i.e. the `valueOptions` callbacks whose shape `parseSubcommandArgs` forces (~84 of the 168; the single largest group is `--top` at 66 identities, still 66 at this tip). **(b)** Hand-drain the ~84 that survive it; extraction candidates the four landed steps newly surfaced are `hasErrorCode` ×4, `round2`/`roundScore` ×4, and the four `run*MergeCli` wrappers. **(c)** Only then flip `includeExactTokens` to `true` in `scripts/sensor-near-duplicates-core.ts:68` — full/parallel `verify` demands an exact whole-repo baseline match (`scripts/verify/steps.generated.sh:49`) and `--update` refuses to grow, so a partial drain buys nothing. **Do not raise `minLines`** — it deletes the most extractable groups and keeps boilerplate; full sensitivity table in the leaf. Re-measure before dispatching (`bun scripts/drift-ai.ts --check near-duplicates --scope current`): the residual moves with every merge, and leaf 02's 2026-07-25 banner carries the per-step accounting plus the reason a rename can *reveal* new groups. |

## 2 — In flight (do not restart)

| # | Task | Source | Size | State |
|---|---|---|---|---|
| C4 | EV-1 codebase-grounded golden-task eval harness | harness-research-followups-2026-06 / 03 | L | **In flight on `feat/golden-task-eval`** (`ad60abec`, 45 commits / 6.1k lines ahead, 65 behind), clean in the live worktree `/home/node/lanes/lane-harness`. Built: runner, workspace isolation, agent adapter, grader, scoring, reporter, `bun run eval:golden`, a 137-line guide, full harness registration, 85 green unit tests, and 1 admitted calibrated fixture. **Read the branch copy of the leaf, never main's** — the branch copy is a 292-line ledger of five cross-model review rounds (findings #1–#27; 19 fixed, 8 owner-classified deferrals, no known blockers). Remaining: (a) rebase — only `package.json` conflicts — and re-verify the adapter's `backend-pid` trailer against the rewritten `agent-run.sh`; (b) **one real live-agent run — every run so far is controller-mode, so the harness's headline claim is unproven**; (c) 4 more admitted fixtures, plus a call on the abandoned, unrecorded `spell-result-projection` prototype; (d) recalibrate the pilot (its `evaluationRef` is 42 commits old). Environment: a stale `.musi-golden-task-eval` allocation is still registered in the primary worktree list — clear it with `bun run worktree:drop <exact-path>`, never `rm -rf`. |

## 3 — Plan review done; partially dispatchable

| # | Task | Source | Size | State after the review round |
|---|---|---|---|---|
| C8 | [Command-policy TS core](./13-command-policy-ts-core.md) — five-slice port of `policy.sh` + the `common.sh` lexer | this pack | L | **Plan review complete 2026-07-25 (Codex ruling + adversarial Grok review, verdict "dispatch with amendments"); the leaf carries the amended plan. S1 and S2 are dispatchable now as one dedicated lane, re-branched per slice. S3 is HELD — see §4 — and S4/S5 sit sequentially behind it.** What the review settled: **(1)** parity is a **land-time dual-run proof** against working-tree Bash, then a frozen corpus that permanent tests read without ever executing Bash — *amended*: S1 dual-runs only its own lexer/target/heredoc/protocol rows plus the rider's target overrides, because S1 emits no policy verdicts; policy and stash rows are frozen as `deferredDomain` with no S1 TS expectation. **(2)** "Real hook-log traffic" is struck — no such log exists and none will be built (no S0 logging slice); the corpus is harvested from the existing `scripts/ai-hooks/test.sh` + `test-copilot-wiring.sh` matrices instead. **(3)** The pre-code perf baseline is `scripts/command-policy-perf.ts`, built and run **as the C8 lane's first commit** — six scenarios across the real Codex and Claude adapters; *amended*: `reports/` is gitignored, so the committed artifact is the baseline SHA + summary, not the JSON. **(4)** Latency gate — **the two reviewers disagree and the leaf records both**: Codex wants a hard `delta95 <= 50 ms` sign-off gate, Grok wants 50 ms soft and only `> 100 ms` hard-reverting, arguing full-adapter p95 noise will reinstate the sign-off fights. Default is soft-50/hard-100; it only bites if a measurement lands in between. Also settled: smoke registration goes on the `test-verify-metadata.sh` pattern, **not** `test-ai-hooks.sh` (which would bill every core edit to the 3.7k-line hook suite), and the perf script is not a smoke subject; module layout pinned to `scripts/lib/verify-metadata-core.ts`; S4's "remainder" enumerated as 31 named + 12 inline predicates (**not exhaustive** — S3's write-path extractors are outside it). Two sizing corrections to respect: `ai_strip_noncommand_text` is a 288-line awk heredoc engine (`policy.sh:262-549`), and the resolved/implicit/indeterminate model is a **redesign** of `ai_target_dir_from_cmd`'s any-`$()` whole-command fail (`common.sh:216-218`), not a line-faithful port. Drifted refs were re-verified at `0bb5c206` and corrected in the leaf — including six ranges the Codex ruling itself got wrong, all fixture ranges a corpus harvester would have used. |

## 4 — Blocked on an owner decision

**Two open calls.** The 2026-07-19 D section is fully cleared as of 2026-07-25.
Five of its six calls were ruled directly — four became `F5`–`F8` in §1, and
`lint-deep-dive-2026-07 / 14` (propose-mode registry validation) was closed as
trim. The sixth, C3's gate promotion, was sized by a scoping pass and ruled
extract-then-promote; it is now a sequenced row in §1. Two questions have been
raised since: `D1`, filed when `F3` landed, and the C8 edited-path resolver
call, escalated by the C8 plan review (both reviewers independently reached the
same conclusion).

| # | Question | Source | Size | What the owner must choose |
|---|---|---|---|---|
| D1 | How to retire the three `decisions-*.md` notes that `F3`'s ADRs now cover | [`04-archgate-adr-plan.md`](./04-archgate-adr-plan.md) "Retiring `decisions-*.md` Sources" | S-M | `F3` promoted ADR-0002/0004/0005/0006 and retired none of their source notes: the plan's step 3 says "delete, don't stub", but each of `decisions-auth.md` (2 entries), `decisions-schemas.md` (3), and `decisions-build.md` (6) carries unrelated decisions the ADR does not absorb, so deleting the file would fail the plan's own parity check. Choose **per-entry extraction** (the ADR absorbs its entry, that entry is removed, the file survives) or **rehome the orphans first, then delete**. `docs/agent_notes/README.md:11` deep-links an anchor inside `decisions-build.md`, and `DECISIONS.md`'s index sub-bullets need the matching edit under either choice. Until this is ruled, the four ADRs and their source notes both stand — a reader may find the rationale twice, which is the cost of the deferral, not a bug to "fix" by deleting a note. |

**C8 S3 vs the approved-P1 edit-hook work — who owns the shared edited-path
resolver?** Approved-P1
[`../ai-harness-audit-2026-07-21/05-edit-hook-target-worktree.md`](../ai-harness-audit-2026-07-21/05-edit-hook-target-worktree.md)
moves target resolution into `edited-paths.sh`, adds
same-repository/unrelated/invalid classification, groups multi-root payloads, and
changes `.allow-protected-edits` from repository-wide to **target-worktree-local**
(`:18-48`; its first slice migrates Prisma and protected-files at `:32-38`).
C8 S3 claims the same protected-file target/path resolution. Two approved plans
cannot both own it, which is why this is owner-only — it reassigns scope between
two already-approved plans. Choose:

- **(a) Land the approved P1 first, then refresh C8 S3** against its
  target-local marker and shared edited-path resolver contract. *This is the
  review's recommendation, and the default until ruled otherwise.* Cost: C8's
  sequential S3→S4→S5 campaign waits on a P1 that is itself unstarted.
- **(b) Explicitly supersede or amend the approved P1** so C8 S3 owns the shared
  resolver and P1 consumes it. Cost: reopening an approved P1 and folding its
  worktree-local marker decision into a slice whose primary job is the policy
  port — a larger, riskier S3.

The tradeoff is sequencing delay (a) against re-scoping an approved plan and
enlarging S3 (b). **S1 and S2 are unaffected either way** and can be dispatched
today; only S3 — and the sequential S4/S5 campaign behind it — is held.

Route new owner questions here rather than blocking a lane.

## Retained closed leaves

These landed and are archived in the drain record, but their files stay in the
pack because open work still reads them, or because they carry a ruling or a
limitation the landed code does not state on its own:

- [`03-fixture-copy-set-import-graph-guard.md`](./03-fixture-copy-set-import-graph-guard.md)
  — closed with `B5`; its "Known limitations" section is live guidance for
  anyone adding a fixture copy set or a `scripts/**` leaf module.
- [`04-archgate-adr-plan.md`](./04-archgate-adr-plan.md) — its
  "Retiring `decisions-*.md` Sources" section carries the parity evidence
  behind `D1`.
- [`11-harness-controls-typed-parser.md`](./11-harness-controls-typed-parser.md)
  — closed with `B22`; it holds the two `sanctioned-reader` rulings that keep
  `generate-harness-controls.ts` and `check-registry.ts` off the typed loader.
  The agent-facing seam doc is `docs/guides/harness-manifest-parser.md`.
- [`12-verify-gate-lifecycle-seam.md`](./12-verify-gate-lifecycle-seam.md) —
  `:92-96` carries the C8 ordering constraint.
- [`14-envelope-emission-kernel.md`](./14-envelope-emission-kernel.md) — closed
  with `B23`; it records the two deliberate deviations in envelope routing.
- [`15-git-exec-seam-consolidation.md`](./15-git-exec-seam-consolidation.md) —
  holds the phase-1 caller inventory `F2` drained, and the eligibility ruling
  that says which callers keep their own adapters.
- [`16-merge-cli-table-and-argv-offset.md`](./16-merge-cli-table-and-argv-offset.md)
  — holds the re-open trigger for the rejected `runCliMain` kernel.

## Promotion rules

1. Pull from §1, plus C8 **S1/S2 only** from §3 (its review round is done). §2
   is owned; C8 S3–S5 and §4 need the owner.
2. Mark landings in `../../finished_work/ready-2026-07-drain.md` and the source
   pack index in the same commit.
3. Follow the repo Workflow (TDD, conventional commits, commit-gate
   verification); §2/§3 items get a plan review before code.
