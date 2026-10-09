# 27-PLAN. Shell smoke suites: scheduling plan

Status: Planned — 27.1 (the two-tier test contract in `scripts/README.md`)
**landed** in merge `e3229c38c` (implementation `a5f74a7c6`, `d17769ecc`,
`0f529a88a`); 27.2 (the assertion kernel `scripts/tests/lib/test-assertions.sh`)
**landed** in merge `5ecb2c860` (implementation `eb047c08c`, `913147a72`,
`5210a45f8`, `4452b7dcd`); 27.3 (the `test-pre-commit.sh` extraction)
**landed** in merge `72db8987f` (implementation `654f3cb91`); next slice 27.4;
supersedes the Proposed direction in
[`27-shell-test-substrate.md`](./27-shell-test-substrate.md)

Date: 2026-07-26 · Area: harness · Source leaf: 27 (XL)

Re-validated 2026-09-03 against `eecef70bc`. Every `path:line`, count and cited
test below was re-resolved against the live tree, and the drifted pins are
corrected in place. 27.1-27.3 were still unimplemented at that sha (all three
have since landed — see `Status:`) and every premise still holds. Line pins in
[`27-shell-test-substrate.md`](./27-shell-test-substrate.md) are frozen at the
2026-07-25 audit snapshot and are **not** re-validated — read the pins from this
plan, not from the leaf.

Cross-model planning session: `consult codex` (four internal angles, synthesized)
and `consult cursor` (Grok, "is this the right approach at all"). Both were asked
independently; where they disagreed, the call and the reason are recorded in
[Rejected alternatives](#rejected-alternatives--why).

## Reconciled scope decision

**The leaf's headline diagnosis is a symptom, and its prescription is aimed at
the wrong lever.** Both consults reached this independently, and the arithmetic
settles it: ~40 lines of preamble across ~50 files is roughly 2,000 of the
36,000 lines under `scripts/tests/`. Deduplicating `fail()`/`ok()`/`PASS=0`
addresses about 5% of the mass and none of the operational cost. Five weeks
later (`c69ce720` is 2026-07-26, `eecef70bc` 2026-09-02) it is ~2,400 of the
38,450 lines in `scripts/tests/test-*.sh` — 6.2%, still a rounding error
against the operational cost.

The operational cost is **subject ownership**. Changed-mode selects whole suites
by exact or directory-prefix subject (`scripts/path-policy/path-policy-query-core.ts:121-148`;
`scripts/test-scripts.sh:181-216`), so a suite that has accreted unrelated
behaviour drags its full line count into every commit that touches any of its
declared subjects. `test-dependency-freshness.sh` is the clean example: the
freshness assertions end at `:302`, hook orchestration runs `:304-2836`, and the
file declares `.husky/pre-commit` and `.husky/post-commit` at `:34-35`.
`test-lint-ratchet.sh` declares 53 subjects across a dozen systems (`:3-55`).

This plan therefore **reframes leaf 27 from "build a substrate and migrate 52
suites" to "fix subject ownership, and cap growth"**, and drops the migration as
a completion criterion. Verified live at `c69ce720`: 52 suites, 35,991 lines,
`fail()` in 44, `ok()` in 39, `PASS=0` in 38, `mktemp -d` in 49, `new_repo()` in
15, `scripts/tests/lib/` holding exactly two files — where "lines" counts
`scripts/tests/test-*.sh` only. **Re-verified 2026-09-03 at `eecef70bc`: 59
suites, 38,450 lines in `scripts/tests/test-*.sh` (38,982 counting every file
under `scripts/tests/`, including `lib/` and a generated manifest), `fail()` in
50, `ok()` in 43, `PASS=0` in 43, `mktemp -d` in 51, `new_repo()` in 15,
`scripts/tests/lib/` holding three files** (`test-git-env.sh` and
`test-lint-ratchet-edit-check-fixtures.sh` from 2026-06-10, plus
`test-tmpdir.sh` added 2026-08-30). The suite count grew by seven and the mass by 6.8% on the
like-for-like measure; nothing in the reframing changes.

### Kept from the leaf

- Step 1, the assertion kernel — cheap, and slice 27.3 needs it to exist.
- Step 5, the `test-pre-commit.sh` extraction — the highest-value item in the
  leaf and the one that unblocks leaf 32.
- Step 6, the ai-hooks extraction — but **relabelled as navigation work**, not
  changed-mode work. `scripts/tests/test-ai-hooks.sh:20` declares the whole
  `scripts/ai-hooks/` directory prefix as a subject, so extracting a family does not make it
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
   at `scripts/test-support/tmp-repo.test-helper.ts` (still the only file in that
   directory). There are already 282 `*.test.ts` files under `scripts/` (225 at
   the 2026-07-26 pin), so this tier is the established majority, not a new
   proposal.
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
| 27.1 | Write the two-tier test contract into `scripts/README.md`'s existing `## Smoke Tests` section (`:67-99`), appended after `:99` and before `## Generated Files` at `:101` — **the old `:68-81` pin is occupied, not empty**, and writing there would overwrite the changed-mode selection paragraph at `:77-87`. State the TS-first boundary, `scripts/test-support/`, the new-suite-over-extension rule, and the `scripts/ai-hooks/` colocation paragraph (nine colocated `test-*.sh` suites plus `test-support.sh` and the aggregate runner `test.sh`; the directory subject is aggregate-only). `:74-75` already says `scripts/tests/lib/` helpers are not standalone smoke subjects — reference it, do not restate it. No runtime change. | README states all four; no code touched | `bun run format:changed:check` |
| 27.2 **[G]** | Add `scripts/tests/lib/test-assertions.sh` — one definition of `fail()`, `ok()` and the pass counter. **Only `fail()` can be lifted from `scripts/ai-hooks/test-support.sh` (`:9-12`); that file is 86 lines total and defines neither `ok()` nor `PASS`.** Take `assert_contains`/`assert_not_contains`/`assert_no_output` (`:14-38`) with it, and source `ok()`/`PASS=0` from the dominant `scripts/tests/` idiom instead — `ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }` — 39 suites carry that one-line shape (21 of them byte-verbatim) and four more use a multi-line equivalent, which is the 43 that define `ok()` at all. **Leave `assert_hook_json`/`assert_hook_continue_json` (`:40-52`) behind with the two shim builders (`:54-86`)** — they are hook-JSON contract assertions, not generic. Have `scripts/ai-hooks/test-support.sh` source the new file. Migrate exactly **one** small ordinary suite as proof: `scripts/tests/test-check-fast-uri-override.sh` (78 lines, two subjects, canonical idiom, one plain EXIT trap, its contents copied into no fixture — only its *name* appears in the generated `scripts/fixtures/test-scripts/all-smoke-tests.txt:4` and the subject registry, as every suite's does — and named in no multi-smoke `expected=` literal in `test-test-scripts.sh`). Declare `scripts/tests/lib/test-assertions.sh` as a `# smoke-subjects:` line in that suite **and** in `scripts/tests/test-ai-hooks.sh` (its `scripts/ai-hooks/` directory subject at `:20` covers files *inside* that directory and cannot cover `scripts/tests/lib/test-assertions.sh`; `scripts/tests/test-mutation-run.sh` is the live counter-example — it sources `test-git-env.sh` at `:17-18` and declares no subject for it), and regenerate — 27.2 adds no smoke *file*, so only `path-policy-smoke-subjects-data.ts` changes and `all-smoke-tests.txt` stays as it is (precedent: `git show --stat 9ef28a675`, which added `scripts/tests/lib/test-tmpdir.sh`). **Do not add a routing case to `scripts/tests/test-test-scripts.sh`**: the single-smoke helper case at `:1028-1032` already exercises a `scripts/tests/lib/` helper routing to its declaring suites, the router does not distinguish one declaring suite from two, and the registry fact is guaranteed by `test:scripts:subjects:check` and proved directly by the query in this row's Verify column. **Freeze the API here.** | Kernel exists, ai-hooks support sources it, one suite migrated, exit/output behaviour byte-identical, changing the kernel routes to exactly the two declaring smokes | `printf 'scripts/tests/lib/test-assertions.sh\0' \| bun scripts/path-policy/path-policy-query.ts script-smoke-tests` (the direct proof of the Done-when, 18 ms); `bash scripts/tests/test-check-fast-uri-override.sh`; `bash scripts/ai-hooks/test.sh`; `bash scripts/tests/test-test-scripts.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.3 **[G]** | **Extract `scripts/tests/test-pre-commit.sh`.** The file is now **2837 lines**, not 2386, and every pin below is re-resolved. Move `:304` (`hook_repo="$TMP_ROOT/hook-repo"`, a plain variable and an inline fixture — **there is no `hook_repo` function**) through `:2836` as a pure move — the last case ends at `:2835` and `:2836` is blank — keeping the trailer `printf` at `:2837` in each file with its own wording; leave the freshness cases `:237-302` and `assert_status` (`:103`) behind. **Move — do not hoist — the eight hook-only helpers in `:87-235`, which is two cuts, not one: `assert_status` (`:103-109`) sits inside that range and stays behind.** The eight are `generated_step_names` `:87`, `write_live_memory_reservation` `:95`, `copy_verify_steps_fixture` `:111`, `copy_precommit_fixture` `:125`, `init_bridge_repo` `:173`, `write_marker_with_ts` `:191`, `seed_prior_verify_evidence` `:205`, `assert_prior_verify_evidence` `:219`: **no surviving freshness case calls any of them**, so `scripts/tests/lib/` would gain a single-consumer file, which the plan's own false-reuse ruling forbids. **Move 33 of the 35 declared subjects, and declare `scripts/dependency-freshness.sh` (`:3`) in *both* files — the partition is not disjoint.** The header declares 35 subjects at `:3-37`, and the freshness cases at `:237-302` exercise exactly one production script — `dependency-freshness.sh`, sourced at `:63` and driven through `musi_dependency_status`/`_message`/`_digest`/`_write_marker`. But the moved block also *copies* that script into six sandboxes (`:129` inside `copy_precommit_fixture`, then `:306`, `:753`, `:983`, `:1192`, `:1672`), and `collectSmokeMetadataFailures` (`scripts/path-policy/fixture-shell-dependencies.ts:97-115`) fails any suite whose `# smoke-subjects:` headers omit a path it copies — so a `test-pre-commit.sh` that only inherits the moved subjects fails `bun run test:scripts:subjects:check` in this row's own Verify column. The new file therefore ends with **35** header lines (33 moved + `scripts/dependency-freshness.sh` + its own self-subject) and the remainder with **2**. Nothing else flips: no `expected=` literal in `test-test-scripts.sh` names `scripts/dependency-freshness.sh`. Everything else, including all eleven `scripts/lib/verify-*.sh` subjects, the five `scripts/path-policy/` subjects, `scripts/verify/*`, `.husky/pre-commit` (`:34`), `.husky/post-commit` (`:35`) and `scripts/tests/lib/test-git-env.sh` (`:36`), has coverage only in the moved block or in the moved helpers. `scripts/lib/verify-metadata.sh` is sourced at `:65` and used only by the hook cases; move it. Move the `:43-44` `test-git-env.sh` source and the `:51-52` calls with it, and the three other hook-only preamble seams: `:54-60` (`unset FORCE_VERIFY`/`MUSI_CAPTURE_TEST_TIMINGS`, consumed only at `:464` and `:825`+), `:67-74` (`MUSI_PATH_POLICY_QUERY`/`_BUN`, `MUSI_VERIFY_META_CORE`/`_BUN`) and `:79-82` (`MUSI_VERIFY_MEMORY_STATE_ROOT`, consumed only at `:915`/`:960`) — `scripts/dependency-freshness.sh` reads none of them. Give the new file `# smoke-order: 075` (free between `070` dependency-freshness and `080` pre-push; `assertUniqueOrders`, `smoke-subject-headers.ts:97-109`, rejects a duplicate). Rewrite the single-line docstring at `:38`. **This is a pure move of the cases, but it is not a self-contained one: `scripts/tests/test-test-scripts.sh` hard-codes the routed set and must be updated in the same slice.** Nine `expected=` literals (`:361`, `:394`, `:416`, `:525`, `:545`, `:577`, `:677`, `:684`, `:1106`) name `test-dependency-freshness`, and every one of their triggering paths (`steps.generated.sh`, `.husky/pre-commit`, `.husky/post-commit`, `path-policy-query.ts`, `smoke-test-files.ts`, `test-git-env.sh`, `parallel-step.sh`, `verify-metadata.sh`, `output-filter.sh`) is a subject 27.3 moves, so each flips to `test-pre-commit` — that fails loudly and is recoverable. **The one that fails silently is `direct_fixture_git_smokes` (`:583-608`):** it still lists `"test-dependency-freshness.sh"`, and `:610-619` runs each entry under `MUSI_TEST_ASSERT_GIT_HOOK_ENV_CLEARED=1`, relying on the `:52` `musi_exit_after_git_hook_env_assertion_if_requested` call to exit with the assertion's status. Once `:51-52` move out, that entry runs the whole freshness suite and asserts nothing while still exiting 0 — the surviving cases at `:237-302` run no `git` at all. **Replace that entry with `test-pre-commit.sh`; do not add alongside it.** No production hook edits, no behavioural cleanup, no sub-division by topic. | Both suites green; freshness file is only freshness; the remainder declares two subjects; subjects regenerated | `printf '.husky/pre-commit\0' \| bun scripts/path-policy/path-policy-query.ts script-smoke-tests` (proves the routing flip in 18 ms, before the ~2-minute suites); `bash scripts/tests/test-dependency-freshness.sh`; `bash scripts/tests/test-pre-commit.sh`; `bash scripts/tests/test-test-scripts.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.4–27.7 | Continue the ai-hooks extraction, **one family per session**, copying the existing delegation idiom exactly (including discarding stdout so the aggregate keeps its single success line). Re-derive boundaries with `rg -n '^# --- ' scripts/ai-hooks/test.sh` — do not trust recorded ranges. Families: the `L8` command-policy block, `backlog-note-lint`, the `L1`–`L7` commit/worktree/queue block, and `failure-guidance`/output-filter. New scripts must stay on per-suite `mktemp` roots or `test-protected-files-marker.sh`'s tripwires fail the suite. | Each family runs standalone and through the aggregate with unchanged aggregate output | `bash scripts/ai-hooks/test-<family>.sh`; `bash scripts/tests/test-ai-hooks.sh`; `bun run test:scripts:subjects:check` |
| 27.8+ **[G]** | Split `test-lint-ratchet.sh` **one coherent subject cluster per session** — merge-driver/git-rail, then governance/config, then the remaining kernel/CLI behaviour. Each extraction takes narrower subjects and leaves a runnable remainder. Stop when the clusters stop being coherent; line count is not the criterion. | Each new suite owns a disjoint subject set; remainder still green | old and new suites directly; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| 27.9 **[G]** | **Contract work before any skill-dispatch split.** Widen the single-valued `smokeTest` field at `harness.controls.json` to a list and teach `addSmokeSubjects` (`scripts/harness/skill-artifact-projection.ts:117-127`) to route each subject to the right file. No shell relocation in this slice. | Routing contract accepts multiple smoke files; projection test covers it | `bun run test:scripts:file -- scripts/harness/skill-artifact-projection.test.ts`; `bun run harness:skills:check`; `bun run harness:check` |
| 27.10 **[G]** | Split `test-skill-dispatch-wrappers.sh` by independently routable skill/backend group. The generated block at `:3-21` (`# BEGIN`/`# END` markers, 17 subject lines at `:4-20` — 8 under `.claude/skills/agent-cli/` and 9 under `.codex/skills/agent-cli/`, which carries an extra `agents/openai.yaml` with no `.claude` counterpart; `:22-24` is a hand-authored comment and the hand-registered subjects start at `:25`) is regenerated by `harness:skills:refresh` and must never be hand-edited; `renderSkillSmokeSubjectBlock` inserts a block into a declared file that lacks one, so new files need no hand-written header. | Split lands and survives a refresh unchanged | new suites directly; `bun run harness:skills:refresh`; `bun run harness:skills:check`; `bun run test:scripts:subjects:check`; `bun run harness:check` |

Out of scope for this leaf: the 52-suite migration sweep, the cleanup registry,
the generic git-fixture layer, `test-test-*` renames, and the Stop-policy
assertion rewrite.

**Landing bookkeeping.** Unlike
[`HARNESS-CLUSTER-PLAN.md`](./HARNESS-CLUSTER-PLAN.md#slices) this table has no
`State` column, so a landing lane records the slice in this document's `Status:`
header line and in [`00-index.md`](./00-index.md)'s leaf-27 row, then reruns
`bun run docs:backlog-catalog` — `bun run harness:check` fails on a stale
`CATALOG.md`. The H13/H14 lane split that work in two: `8dd146af7` before the
merge (implementation shas, leaf statuses, cluster counts) and `a979c9066` after
it (merge shas, index rows, `../README.md` counts).

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
- `27.3 → H15` (leaf 31 step 13, now owned by
  [`HARNESS-CLUSTER-PLAN.md`](./HARNESS-CLUSTER-PLAN.md#slices)). Land 27.3's
  regenerated subject data before H15 reworks smoke-subject discovery in
  `scripts/path-policy/path-policy-smoke-subjects.ts`, or the two changes get
  debugged together. **Re-validated 2026-09-03: the edge is kept.** Its
  mechanism, the two slices' file sets, the discovery semantics and the
  rename's coordinate cost are stated once, in
  [`HARNESS-CLUSTER-PLAN.md`'s dependency edges](./HARNESS-CLUSTER-PLAN.md#dependency-edges);
  read them there rather than transcribing them here. Leaf 31 step 13's
  coordination with leaf 49 (`31 ↔ 49`) is dissolved, not sequenced — both now
  live in H13-H15.
- `27.9 → 27.10` (hard: the split cannot land against a single-valued field).
- 27.4–27.7 and 27.8+ are independent of each other and of 27.3.

## Operational risk

Pre-commit's scripts slot is **changed-selected** — `pre_commit:scripts` runs
`bun run test:scripts:changed` at `scripts/verify/steps.generated.sh:224-225`,
as does `verify_changed:scripts` at `:123-124` — not the full suite, so the
leaf's "suites gate commits" framing overstates the routine cost. Full verify
and CI do run all 59 (`verify:scripts` at `steps.generated.sh:75-76`,
`verify_parallel:scripts` at `:175-176`).

1. **The full-suite deletion fallback exists, but no scheduled 27.x slice can
   trigger it — do not budget for one.** `scripts/path-policy/path-policy.ts:293-298`
   classifies any deleted path under `scripts/` or `.husky/` as smoke-sensitive,
   and `scripts/test-scripts.sh:205-211` prints "unmapped script deletion
   detected — running full smoke suite" (`:208`) and runs **all 59** via
   `discover_smoke_tests` (`:135-143`). But
   `script_sensitive_deletion_without_smoke_owner` (`:112-133`) fires only for a
   path that is **deleted** *and* selects **zero** smokes, and in a real commit the deleted set
   comes from `--diff-filter=D` (`read_deleted_files`, `:165-179`). Every
   27.x slice as specified adds a file and moves content between files — 27.2
   adds `test-assertions.sh`, 27.3 adds `test-pre-commit.sh` and shrinks the
   freshness file, 27.4–27.7, 27.8+ and 27.10 extract into new files — so there
   are no `D` entries and the branch is unreachable. Even a genuine smoke-file
   deletion selects a suite, because `isScriptSmokeTestPath` routes any
   `scripts/tests/test-*.sh` path to `test-harness-check`
   (`path-policy-query-core.ts:140-145`) whatever the subject headers say
   (`printf 'scripts/tests/test-doctor-json.sh\0' | bun
   scripts/path-policy/path-policy-query.ts script-smoke-tests` returns two
   suites), so it does not fall back either. **The real cost of a [G] slice is
   the regenerated registry**, which routes to eight suites:
   `printf 'scripts/path-policy/path-policy-smoke-subjects-data.ts\0' | bun
   scripts/path-policy/path-policy-query.ts script-smoke-tests` returns
   `test-tool-memory-admission`, `test-verify-history`, `test-format-changed`,
   `test-lint-changed`, `test-lint-dist-preflight`, `test-lint-shell`,
   `test-lint-config-sensors`, `test-test-scripts`. Any slice that also adds a
   `scripts/tests/test-*.sh` selects `test-harness-check` on top, via
   `isScriptSmokeTestPath` → `SMOKE_METADATA_FRESHNESS_TEST_NAME`
   (`path-policy-query-core.ts:140-145`); `scripts/tests/lib/` paths do not
   trip it. Budget for those eight, `test-harness-check` where a suite is
   added, and the suites the slice itself touches — not for 59.
2. **27.3 is the single most dangerous slice here.** It relocates the only
   coverage of the pre-commit gate. Land it in a quiet serial window, run both
   suites green before merging, and **never combine it with leaf 32's
   `.husky/pre-commit` body split** — that is a production hook change and is
   more globally dangerous than this test-only move.
3. **Do not wire anything new into registration admission.**
   `.husky/pre-commit:365-369` (`musi_precommit_registration_admission`, wired
   at `:439`) runs `harness:registration:check` under a hard timeout before
   cached-marker reuse — but **only on a fast-commit run**, because
   `[pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'`
   (`.husky/pre-commit:478`) gates it and `scripts/lib/verify-engine.sh:347-362`
   skips the hook whenever that condition returns non-zero. The budget is **45
   seconds**, not five — `MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT` at
   `scripts/lib/verify-state-paths.sh:69`, defaulted at `.husky/pre-commit:306` and
   validated by the `case` at `:307-313` — and the exact invocation string is
   pinned by the regex at
   `scripts/harness/registration-preflight-wiring.ts:189` (`:84`, `:92`, `:178`
   and `:186` pin the timeout default and its validation), so rewording the
   command breaks `harness:check`.
4. **Partial generated-surface changes fail structurally for everyone.**
   `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
   `scripts/fixtures/test-scripts/all-smoke-tests.txt` are generated and reject
   hand edits; regenerate with `bun run test:scripts:subjects` and commit both in
   the same slice.
5. **Editing the shared kernel after adoption fans out** to every suite that
   declares it as a subject — `matchesSmokeSubject`
   (`path-policy-query-core.ts:121-125`) and the selection loop at `:130-148`.
   `scripts/tests/lib/test-git-env.sh` is the live warning: **24** suite headers
   declare it, so `test-test-scripts.sh:575-580` has to pin a 24-smoke expected
   set — the routed set is exactly the declaring set, one subject in, 24 suites
   out. This is why 27.2 freezes the API after one proof consumer rather than
   after fifty.
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
| Treat ai-hooks extraction as a changed-mode win | `test-ai-hooks.sh:20` declares the whole directory prefix as a subject; extraction improves navigation only. |
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
