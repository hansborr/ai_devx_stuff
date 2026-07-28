# 27-PLAN. Shell smoke suites: scheduling plan

Status: Planned — supersedes the Proposed direction in
[`27-shell-test-substrate.md`](./27-shell-test-substrate.md)

Date: 2026-07-26 · Area: harness · Source leaf: 27 (XL)

Cross-model planning session: `consult codex` (four internal angles, synthesized)
and `consult cursor` (Grok, "is this the right approach at all"). Both were asked
independently; where they disagreed, the call and the reason are recorded in
[Rejected alternatives](#rejected-alternatives--why).

## Reconciled scope decision

**The leaf's headline diagnosis is a symptom, and its prescription is aimed at
the wrong lever.** Both consults reached this independently, and the arithmetic
settles it: ~40 lines of preamble across ~50 files is roughly 2,000 of the
36,000 lines under `scripts/tests/`. Deduplicating `fail()`/`ok()`/`PASS=0`
addresses about 5% of the mass and none of the operational cost.

The operational cost is **subject ownership**. Changed-mode selects whole suites
by exact or directory-prefix subject (`scripts/path-policy/path-policy-query-core.ts:126-158`;
`scripts/test-scripts.sh:181-215`), so a suite that has accreted unrelated
behaviour drags its full line count into every commit that touches any of its
declared subjects. `test-dependency-freshness.sh` is the clean example: the
freshness assertions end at `:269`, hook orchestration runs `:271-2386`, and the
file declares `.husky/pre-commit` and `.husky/post-commit` at `:19-20`.
`test-lint-ratchet.sh` declares 72 subjects across a dozen systems (`:3-74`).

This plan therefore **reframes leaf 27 from "build a substrate and migrate 52
suites" to "fix subject ownership, and cap growth"**, and drops the migration as
a completion criterion. Verified live at `c69ce720`: 52 suites, 35,991 lines,
`fail()` in 44, `ok()` in 39, `PASS=0` in 38, `mktemp -d` in 49, `new_repo()` in
15, `scripts/tests/lib/` holding exactly two files.

### Kept from the leaf

- Step 1, the assertion kernel — cheap, and slice 27.3 needs it to exist.
- Step 5, the `test-pre-commit.sh` extraction — the highest-value item in the
  leaf and the one that unblocks leaf 32.
- Step 6, the ai-hooks extraction — but **relabelled as navigation work**, not
  changed-mode work. `scripts/tests/test-ai-hooks.sh:3-10` owns the whole
  `scripts/ai-hooks/` directory prefix, so extracting a family does not make it
  independently selectable. The leaf implies otherwise.
- Step 8's splits, **gated on subject coherence** rather than line count.
- Step 9's documentation half (the `scripts/ai-hooks/` colocation paragraph).

### Dropped or downgraded

- **Step 2's `register_cleanup` registry — dropped as scheduled work.** It puts
  string-command quoting, reverse-order teardown and trap-composition semantics
  into a gate-critical shared component, and the leaf's own evidence shows the
  cleanup obligations are not uniform enough to share. Ship `make_sandbox` alone
  if and when a consumer needs it.
- **Step 3's git-fixture layer — deferred as speculative.** The leaf itself
  establishes that the 15 `new_repo()` bodies differ in dependency closure, root
  directory, and even whether they run `git init`. Extract only once three
  touched suites demonstrate an identical seam.
- **Step 4's 52-suite migration — dropped as a completion criterion.** Replaced
  by the growth-control policy in slice 27.1. Retire preamble opportunistically
  when a suite is being edited anyway.
- **Step 7's Stop-policy assertion rewrite — moved out of this leaf.** It is test
  technique, not substrate, and shares no surface with the rest. Schedule
  separately.
- **Step 9's `test-test-*.sh` renames — dropped.** Pure churn across generated
  subject data and docs; the leaf already rates it lowest-value.

### The two-tier test contract (slice 27.1 writes this down)

1. **TypeScript logic** — parsing, registries, data transformation, fixture
   orchestration — goes to the existing `scripts` Vitest project, which already
   discovers `**/*.test.ts` and already has a mature temp-repo lifecycle helper
   at `scripts/test-support/tmp-repo.test-helper.ts`. There are already 225
   `*.test.ts` files under `scripts/`, so this tier is the established majority,
   not a new proposal.
2. **Bash smokes** stay for shell semantics: environment inheritance, signals,
   hook execution, exit codes, command composition, black-box CLI behaviour.
   This coverage exists precisely because no other verify slot execs shell.
3. **New shell cases open a new focused suite** sourcing the kernel, rather than
   extending whichever suite is already open. This is the growth brake that the
   substrate migration was implicitly trying to buy.

Note that `scripts/test-scripts.sh` runs suites with bounded parallelism, one
process per suite, so subject-coherent splitting also improves full-suite
wall-clock. Neither the leaf nor either consult made this argument; it is a
secondary reason to prefer splitting over in-file reorganisation.

## Slices

Each slice is one agent session and lands on its own. Flags: **[G]** changes
generated harness/subject/doc output — regenerate and commit in the same slice;
**[C]** touches a config surface and so triggers a full-scan lint.

| # | Slice | Done when | Verify |
|---|---|---|---|
| 27.1 | Write the two-tier test contract into `scripts/README.md:68-81`: the TS-first boundary, `scripts/test-support/`, the new-suite-over-extension rule, and the `scripts/ai-hooks/` colocation paragraph (ten colocated suites plus `test-support.sh`, and the fact that the directory subject is aggregate-only). No runtime change. | README states all four; no code touched | `bun run backlog:lint`; `bun run format:check` |
| 27.2 **[G]** | Add `scripts/tests/lib/test-assertions.sh` — one definition of `fail()`, `ok()` and the pass counter, taken verbatim from `scripts/ai-hooks/test-support.sh:1-86`. Have `scripts/ai-hooks/test-support.sh` source it and keep only its shim builders. Migrate exactly **one** small ordinary suite as proof. Add the helper-path smoke subjects and a changed-routing case. **Freeze the API here.** | Kernel exists, ai-hooks support sources it, one suite migrated, exit/output behaviour byte-identical | touched suites directly; `bash scripts/tests/test-test-scripts.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.3 **[G]** | **Extract `scripts/tests/test-pre-commit.sh`.** Move `:271` (the `hook_repo` fixture) through EOF `:2386` as a pure move; leave the freshness cases `:204-269` and `assert_status` (`:80`) behind. Hoist the seven hook-only helpers at `:72-202` into `scripts/tests/lib/`. Move `.husky/pre-commit`, `.husky/post-commit`, `scripts/prisma-client-freshness.sh`, `scripts/doc-length-policy.sh` and `scripts/tests/lib/test-git-env.sh` subjects with the cases; `scripts/dependency-freshness.sh` stays. Give the new file its own `# smoke-order:`. Rewrite the `:23` docstring. No production hook edits, no behavioural cleanup, no sub-division by topic. | Both suites green; freshness file is only freshness; subjects regenerated | `bash scripts/tests/test-dependency-freshness.sh`; `bash scripts/tests/test-pre-commit.sh`; `bash scripts/tests/test-test-scripts.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.4–27.7 | Continue the ai-hooks extraction, **one family per session**, copying the existing delegation idiom exactly (including discarding stdout so the aggregate keeps its single success line). Re-derive boundaries with `rg -n '^# --- ' scripts/ai-hooks/test.sh` — do not trust recorded ranges. Families: the `L8` command-policy block, `backlog-note-lint`, the `L1`–`L7` commit/worktree/queue block, and `failure-guidance`/output-filter. New scripts must stay on per-suite `mktemp` roots or `test-protected-files-marker.sh`'s tripwires fail the suite. | Each family runs standalone and through the aggregate with unchanged aggregate output | `bash scripts/ai-hooks/test-<family>.sh`; `bash scripts/tests/test-ai-hooks.sh`; `bun run test:scripts:subjects:check` |
| 27.8+ **[G]** | Split `test-lint-ratchet.sh` **one coherent subject cluster per session** — merge-driver/git-rail, then governance/config, then the remaining kernel/CLI behaviour. Each extraction takes narrower subjects and leaves a runnable remainder. Stop when the clusters stop being coherent; line count is not the criterion. | Each new suite owns a disjoint subject set; remainder still green | old and new suites directly; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.9 **[G]** | **Contract work before any skill-dispatch split.** Widen the single-valued `smokeTest` field at `harness.controls.json` to a list and teach `addSmokeSubjects` (`scripts/harness/skill-artifact-projection.ts:117-127`) to route each subject to the right file. No shell relocation in this slice. | Routing contract accepts multiple smoke files; projection test covers it | `bun run test:scripts:file -- scripts/harness/skill-artifact-projection.test.ts`; `bun run harness:skills:check`; `bun run harness:check` |
| 27.10 **[G]** | Split `test-skill-dispatch-wrappers.sh` by independently routable skill/backend group. The generated block at `:3-23` is regenerated by `harness:skills:refresh` and must never be hand-edited; `renderSkillSmokeSubjectBlock` inserts a block into a declared file that lacks one, so new files need no hand-written header. | Split lands and survives a refresh unchanged | new suites directly; `bun run harness:skills:refresh`; `bun run harness:skills:check`; `bun run test:scripts:subjects:check`; `bun run harness:check` |

Out of scope for this leaf: the 52-suite migration sweep, the cleanup registry,
the generic git-fixture layer, `test-test-*` renames, and the Stop-policy
assertion rewrite.

## Dependency edges

Re-derived, and **one index edge is corrected**:

- The pre-reconciliation dependency list in
  [`00-index.md`](./00-index.md#how-to-use-this-pack) recorded
  `27 steps 1-4 → 27 step 5 → 32 step 4`. Step 5
  needs the assertion kernel to **exist**, not the 52-suite migration to be
  **complete** — and this plan drops that migration entirely. The real edge is
  **`27.2 → 27.3 → leaf 32 step 4`**, which unblocks leaf 32 several sessions
  earlier at no cost. Both consults independently flagged the original edge as
  over-blocking.
- `27.1 → 27.2` (the contract should be written before the kernel it governs).
- `27.3 → leaf 32 step 4`. Leaf 32 writes no gate coverage of its own; 27.3
  refiles what exists. Do not create a second suite under any other name —
  `test-precommit-hook.sh` included.
- `27.3 → leaf 31 step 13`. Land 27.3's regenerated subject data before leaf 31
  reworks smoke-subject discovery in
  `scripts/path-policy/path-policy-smoke-subjects.ts`, or the two changes get
  debugged together. Leaf 31 step 13 also coordinates with leaf 49 (`31 ↔ 49`).
- `27.9 → 27.10` (hard: the split cannot land against a single-valued field).
- 27.4–27.7 and 27.8+ are independent of each other and of 27.3.

## Operational risk

Pre-commit's scripts slot is **changed-selected**
(`scripts/verify/steps.generated.sh:208`), not the full suite — the leaf's
"suites gate commits" framing overstates the routine cost. Full verify and CI do
run all 52 (`steps.generated.sh:68`).

1. **Deletions are the sleeper risk in every relocation slice.**
   `scripts/path-policy/path-policy.ts:283-287` classifies any deleted path
   under `scripts/` or `.husky/` as smoke-sensitive, and
   `scripts/test-scripts.sh:196-214` prints "unmapped script deletion detected —
   running full smoke suite" and runs **all 52**. Every slice that moves or
   splits a file pays this on the authoring commit, and holds the shared commit
   queue while it runs. Budget for it; do not treat a slow gate as a failure.
2. **27.3 is the single most dangerous slice here.** It relocates the only
   coverage of the pre-commit gate. Land it in a quiet serial window, run both
   suites green before merging, and **never combine it with leaf 32's
   `.husky/pre-commit` body split** — that is a production hook change and is
   more globally dangerous than this test-only move.
3. **Do not wire anything new into registration admission.**
   `.husky/pre-commit:341-344` runs `harness:registration:check` under a hard
   5-second timeout before cached-marker reuse on every source-relevant commit.
4. **Partial generated-surface changes fail structurally for everyone.**
   `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
   `scripts/fixtures/test-scripts/all-smoke-tests.txt` are generated and reject
   hand edits; regenerate with `bun run test:scripts:subjects` and commit both in
   the same slice.
5. **Editing the shared kernel after adoption fans out** to every suite that
   declares it as a subject (`path-policy-query-core.ts:141-158`). This is why
   27.2 freezes the API after one proof consumer rather than after fifty.
6. **Do not reach for fast-commit to escape these gates.** Its marker lives in
   the shared git common dir, so one agent's toggle affects every sibling
   worktree, and it skips exactly the test and scripts slots under refactor here.

## Rejected alternatives + why

| Rejected | Why |
|---|---|
| Migrate all 52 suites onto a shared substrate (leaf step 4) | ~2k of 36k lines; no changed-mode improvement; multi-session gate churn on the suites that gate commits. Both consults rejected it independently. |
| Rewrite the shell smokes in Vitest wholesale | Hook and wrapper coverage must exec bash; no other verify slot does. Replaces one large migration with a larger one. |
| Generic `register_cleanup` string-command registry (leaf step 2) | Quoting, evaluation, reverse-order teardown and trap composition inside a gate-critical shared file. The leaf's own evidence shows cleanup obligations are not uniform. |
| Shared `new_repo()` / git-fixture layer now (leaf step 3) | The leaf establishes the 15 bodies are not interchangeable. After 27.3 the hook fixtures have exactly one owner, so hoisting them would be false reuse. Revisit at three proven consumers. |
| Split suites by line count | Bytes do not drive selection; subjects do. A split that leaves subjects bundled buys nothing. |
| Treat ai-hooks extraction as a changed-mode win | `test-ai-hooks.sh:3-10` owns the whole directory prefix; extraction improves navigation only. |
| Keep `27 steps 1-4 → step 5` as an index edge | Blocks leaf 32 behind a migration this plan deletes. Corrected to `27.2 → 27.3`. |
| Stop-policy structural rewrite inside this leaf (step 7) | Different concern (test technique), shares no surface. Its `declare -F` auto-discovery must be kept in any future rewrite — a hand-listed table silently drops the net that catches a new reporter missing loop protection. |
| `test-test-*.sh` renames (step 9) | Churns generated subject data and every doc reference for no navigability gain. |
| Cursor's "cap growth and do almost nothing else" | Right about the substrate; under-weights 27.9/27.10. The skill-routing contract is worth fixing because it currently *forces* a 5,400-line file to stay whole. |

## Consult disagreements and how they were called

- **Sandbox helper.** Cursor kept it as an optional slice; codex refused to
  schedule it. Called for codex — the leaf's own cleanup evidence is the
  strongest argument against a shared trap component.
- **Giant-suite splits.** Cursor said "only if timings force it"; codex said
  split on subject coherence. Called for codex, with cursor's brake applied:
  27.8+ stops when clusters stop being coherent.
- **Vitest boundary.** Both agreed TS-first for new logic; cursor was sharper
  that this must not become a port-everything mandate. Both positions are in
  27.1.
