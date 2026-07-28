# HARNESS-CLUSTER-PLAN. The eight remaining harness leaves: substrate verdict and scheduling plan

Status: Planned — supersedes the Proposed direction in
[`29-bash-to-ts-cores.md`](./29-bash-to-ts-cores.md),
[`30-cli-arg-substrate.md`](./30-cli-arg-substrate.md),
[`31-harness-shared-helpers.md`](./31-harness-shared-helpers.md),
[`32-git-hook-shims.md`](./32-git-hook-shims.md),
[`33-env-var-prefixes.md`](./33-env-var-prefixes.md),
[`35-code-intel-internals.md`](./35-code-intel-internals.md),
[`36-lint-ratchet-vocabulary.md`](./36-lint-ratchet-vocabulary.md) and
[`49-path-policy-fixture-analyzer.md`](./49-path-policy-fixture-analyzer.md)

Date: 2026-07-26 · Area: harness · Source leaves: 29, 30, 31, 32, 33, 35, 36, 49

Cross-model planning session: `consult cursor` (Grok, "is bash-to-TS the right
direction at all") and `consult codex` (multi-angle, synthesized). Disagreements
and the calls made are recorded in
[Consult disagreements](#consult-disagreements-and-how-they-were-called); see
also the [Method note](#method-note) on the two runs' independence.
Companion plans: [`27-PLAN.md`](./27-PLAN.md), [`28-PLAN.md`](./28-PLAN.md).

## Substrate verdict

**The substrate question is not open, and treating this cluster as a
bash-to-TypeScript programme is the mistake to avoid.** `docs/ai-harness.md:255`
holds a signed-off Substrate Ruling (`b7c2ce73`) that already decides every
question these eight leaves reopen:

- **Repo-local gate orchestration stays bash, sharing engine libraries** — and
  the ruling names `scripts/verify.sh`, `.husky/pre-commit`, `scripts/land.sh`
  and `scripts/ai-hooks/` explicitly, with "must share extracted engine libs
  rather than duplicating blocks" as the obligation.
- **Anything analytical lives in TS**, reachable from bash via `bun` entrypoints.
- **Duplicates across the boundary are defects.**
- Plus a recorded exception (2026-07-19) keeping three hook- and CLI-local
  `jq`/`awk` readers outside the TypeScript codec, and a recorded rejection of a
  full Bun rewrite of `agent-run.sh` under the copyability lens.

Read with `scripts/README.md:11-30,42-44`, the shape that follows is: **stable
top-level commands and facades, implementation under owner directories, small
shared helpers under `scripts/lib/`, and a deliberately polyglot tree** — bash
owning process glue (hooks, locks, traps, atomic filesystem operations, git and
process composition), TypeScript owning cohesive parsing, comparison, reporting
and transformation behind *batched* interfaces.

Applied honestly to this cluster, the ruling does not authorise a migration; it
**deletes work**:

| The leaf's frame | What the ruling actually decides |
|---|---|
| Leaf 29 "bash-to-ts-cores" | Duplicated bash codecs are the defect the ruling's "share extracted libs" clause targets. Fix them **in bash**. TS cores only where analysis concentrates — see the measured bar below. |
| Leaf 32 "hooks hold work that is not hook wiring" | `.husky/pre-commit` is named in the ruling as bash gate orchestration, and it is already a *policy adapter*, not inline mechanics (see below). Moving the file is navigation, not substrate. |
| Leaf 30 "CLI substrate adoption" | Already TypeScript. `arch-plans-2026-07/02-harness-cli-parse-spec.md` S6 already classified every remaining parser as migrated or intentionally bespoke. |
| Leaves 31, 33, 35, 36, 49 | Not substrate questions at all. |

**The measured bar for a TS core, and why `worktree-db.sh` fails it.**
`arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md` is the only
application of the analytical-TS clause, and its S2 record prices it: a bare
codec spawn ~21 ms against a `jq` spawn ~16 ms; `musi_persist_run_meta_history`
went 18 ms → 130 ms; `verify-history.sh`'s 20-row listing went near-instant →
~2.8 s. It ported **one concentrated hand-rolled codec** whose sed/awk
extractors were provably wrong, then stopped and recorded `jq` as an allowed
exception. Re-measured live: `scripts/worktree-db.sh` is 2,526 lines with **123
top-level functions**, **28 non-comment `jq` lines, 6 `sed`, and zero `awk`**,
spread across seven concerns — the opposite of concentration, and its `jq` is a
real parser, not a defect-class hand-roll. The correctness argument that
justified the 05 port is simply absent here. So leaf 29 step 5 is the escape
hatch that plan wrote down ("drop the cluster rather than bend the ruling"), and
it is dropped.

**The one genuinely open policy question in the cluster** is the argv-offset
stance at `scripts/lib/process-argv.ts:8` ("Existing CLIs converge
opportunistically; new CLIs import it"). It is open because it is measurably
failing: the constant exists to end respellings, and re-measured live there are
**33 declaration sites under seven spellings** (up from the leaf's 32; the newest
is `scripts/suppression-ledger.ts:14`, landed 2026-07-25). That is decided in
slice H4 and nowhere else.

**The generalised form of that decision, applied twice in this plan.** Where a
shared helper exists and adoption has stalled, the answer is *not* a full sweep
and *not* silence: take the free or densest half, and amend the written policy to
"a file being edited for any reason converges". H4 does this for the argv offset;
H7 does it for `errorMessage`. A tree-wide lint rule is the escalation if a new
respelling lands afterwards, not the opening move.

### What this plan is, then

Not a substrate programme. **Apply a ruling that already exists, take the small
correctness wins the leaves surfaced, and refuse the gate-path items the index
warned about.** Twenty-three slices survive out of the eight leaves' roughly
forty proposed steps, and two of them (H20, H21) are optional.

## Per-leaf disposition

| Leaf | Disposition | Why |
|---|---|---|
| **29** | **Shrink.** Keep steps 1–2 (H1, H2). Drop step 3. Shrink step 4 to a **single seam plus the `worktree-seed` move** (H11, H12). **Drop step 5.** | Steps 1–2 fix real drift including one live defect. Step 5 fails the 05 plan's own measured bar (above). Step 4 is a bash split, which the ruling wants — but seven seams through live DB/port/Redis provisioning is not a scheduling unit; one proven seam plus the move `28-PLAN.md:163` assigns here is. Step 3 is optional by the leaf's own text. |
| **30** | **Shrink hard.** Keep step 1 (H3). Decide step 2 **in this plan** and execute the free half (H4). From step 4, keep exactly one migration (H5). **Drop step 3's remaining sweep and the rest of step 4.** | Step 4 re-opens a closed classification: **8 of the leaf's 19 "hand-rolled argv walkers" are already ruled** by `02-harness-cli-parse-spec.md` S6 — seven intentionally bespoke with reasons, and `sensor-knip-unused-exports-core.ts` recorded as a mechanical follow-up with no blocker. That last one is the only scheduled migration; the other eleven get classified when touched. |
| **31** | **Split into three, as the leaf demands — and merge its third part into leaf 49.** 31A = steps 1–3 (H6, H7, H8). 31B = steps 4–8, 10 (H9, H10). 31C = steps 9, 11–13, **merged into the leaf-49 work item** (H13–H15). | The leaf says "must be split before it is scheduled". Its steps 9 and 11–13 all edit `scripts/path-policy/`, which is exactly the directory leaf 49 documents, and **both leaves flag the collision**. One owner removes it instead of sequencing around it. **Step 1 also carries a defect — see [Corrections](#corrections-to-the-pack).** |
| **32** | **Shrink to one slice plus two written rulings.** Keep step 1 (H16). **Close step 2 as won't-do.** **Do not schedule steps 4–5.** Fold step 6 into H17. | See [Operational risk](#operational-risk-the-commit-gate). The leaf's own diagnosis is discoverability, not correctness, and the discoverability fix is 27-PLAN slice 27.3, which is test-only. |
| **33** | **Keep step 1 only**, merged with leaf 32 step 6 into one docs slice (H17). Drop steps 2–3. | The leaf itself rates steps 2–3 optional and forbids a rename. Two one-paragraph harness-doc rulings are one commit, not two work items. |
| **35** | **Keep, shrunk.** Steps 1–3 as one slice (H18), step 5 as one (H19). Step 4 (H20) and step 6a (H21) **optional**. **Drop step 6b.** | Steps 1–3 are compiler-verified and land together. Step 6b needs an alternating-warm-daemon measurement nobody has taken, and the leaf says so. Not a substrate leaf; do not glue it to 29/32. |
| **36** | **Shrink.** Keep step 1 (H22) and step 2 (H23). **Drop step 3. Drop step 4 to its own future leaf.** | `LintRatchetConfig.repairKind` re-verified live: declared `config-types.ts:19,49`, zero readers. **Step 3 is wrong**: `allowEmpty` is documented adopter-facing registry contract (`docs/guides/lint-ratchet-adoption.md:140`, `lint-ratchet-reference.md:239`), so it belongs in the kernel config type even though only Musi's adapter implements the check today. Step 4 is a ~170-occurrence rename that is *compiler-clean into* a strict-Zod debt-log trap the leaf documents, on a path wired into every verify slot. |
| **49** | **Keep steps 1–2 and make it the owner of `scripts/path-policy/`** — absorbing leaf 31's steps 9 and 11–13 (H13–H15). **Drop step 3.** | Two leaves editing one gate-feeding directory is the duplicate ownership this pack exists to reduce. **Both consults independently declined the test split**: it moves assertion seams without adding coverage or improving changed-mode selection, and the leaf's own caveats already forbid converting the cross-file cases. |

## Slices

Each slice is one agent session and lands on its own. Flags: **[G]** changes
generated harness/subject/doc output — regenerate and commit in the same slice;
**[C]** touches a config surface and so triggers a full-scan lint.

| # | Slice | Done when | Verify |
|---|---|---|---|
| H1 | **`worktree-db.sh` state-codec primitive** (leaf 29 step 1). Write the two missing writer tests first (`tombstone_write`, `template_tombstone_write`), modelled on the existing `allocation_write` cases in `scripts/tests/test-worktree-db.sh`. Then extract one `state_json_read`/`state_json_write` pair and route `tombstone_*` (`scripts/worktree-db.sh:2092`, `:2099`), `template_tombstone_*` (`:2161`, `:2168`) and `allocation_*` (`:2212`, `:2221`) through it. **Only the write mechanics are duplicated** — the read schemas and validation genuinely differ, so keep the two unvalidated tombstone reads and the validated allocation read as explicit arguments. **Move `:2104-2107` verbatim**; it records why the temp file must be created on the target filesystem. | Three pairs share one write body; new writer tests pass against the old code first | `bash scripts/tests/test-worktree-db.sh` |
| H2 | **`stop-policy.sh` write-path hoist** (leaf 29 step 2). Add `ai_stop_write_kv_file <path> KEY=VAL...` (mkdir → mktemp → printf → `mv -f` → cleanup-on-failure) and route all four writers — `ai_stop_write_marker` (`:85`), `ai_stop_e2e_write_counter` (`:214`), `ai_stop_async_write_counter` (`:377`), `ai_stop_verify_write_counter` (`:512`). Verified live: `:214` is still the only one of the four with no `mkdir -p "$dir" \|\| return 1` (the others have it at `:94`, `:386`, `:522`), so this closes a real defect. Write half only; **do not** attempt the read half. | All four writers share one body; the e2e counter creates its directory | `bash scripts/ai-hooks/test-stop-policy.sh`; `bash scripts/tests/test-dependency-freshness.sh` |
| H3 | **code-intel usage and option-descriptor ownership** (leaf 30 step 1a–c). Add `def`/`exports`/`overview` usage helpers beside the existing `refsUsage`/`dependentsUsage`/`testsUsage` in `scripts/code-intel/cli-help.ts` and compose the global block from them. Hoist `LIMIT_OPTION`/`PROJECT_OPTION`/`DEPTH_OPTION`; share the `--limit`/`--project` zod transforms but **not** `--depth`'s. Declare `HELP_TOPICS` once and derive `HelpTopic` (`scripts/code-intel/types.ts:17`) from it. **Add exact-equality assertions for the unpinned `dependents` and `tests` short forms first.** Leave the parser throws' terser strings byte-identical; leave `parseSingleFileArgs` and its comment alone. Skip step 1d (the parser skeleton). | Every usage line has one owner; all pinned byte assertions green | `bun run test:scripts:file -- scripts/code-intel/cli-args.test.ts`; `bun run test:scripts:file -- scripts/code-intel/cli-main.test.ts`; `bash scripts/tests/test-code-intel.sh` |
| H4 | **The argv-offset ruling, and the free half of the sweep** (leaf 30 step 2, decided; step 3 first batch). Amend `scripts/lib/process-argv.ts:3-8` from "Existing CLIs converge opportunistically" to **"a file being edited for any reason converges its offset; new CLIs import it"**, and record in the same comment that the remaining bulk sweep is deliberately not scheduled. Then convert the ten files that already `import … from "./lib/process-argv.js"` for `isCliEntrypoint` and still declare their own constant, plus the two local `isCliEntrypoint` copies at `scripts/suppression-ledger.ts:16-19` and `scripts/sensor-blob-size.ts:317-320`. **Do not touch `scripts/lib/verify-metadata-core.ts:45`** — its no-sibling-imports contract (`:16-18`) is load-bearing. | Policy reads "converge on touch"; the ten free sites import the shared constant; the seven-spelling grep drops to ~22 sites | `bun run test:scripts:file -- scripts/lib/process-argv.test.ts`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run harness:check` |
| H5 | **The one open `parseCli` follow-up.** Migrate `scripts/sensor-knip-unused-exports-core.ts` onto `parseCli` — the only entry in `02-harness-cli-parse-spec.md`'s S6 table recorded as "migratable … no blocker recorded", left undone solely to keep that slice doc-only. Same shape as the landed near-duplicates proof: help sentinel, `--baseline` in both forms, exit-2 `ERROR:` prefix. Preserve those three exactly. **Do not touch any other parser** — the rest are ruled bespoke. | The one open S6 follow-up is closed; S6's table can be marked complete | `bun run test:scripts:file -- scripts/sensor-knip-unused-exports.test.ts`; `bun run sensor:knip-unused-exports -- --help`; `bash scripts/tests/test-lint-ratchet.sh` |
| H6 | **Finish adopting `scripts/lib/records.ts`** (leaf 31 step 1, **corrected**). Convert **six** local declarations, not seven: `sensor-knip-unused-exports-baseline.ts:32`, `sensor-near-duplicates-baseline.ts:26`, `suppression-ledger-baseline.ts:33` (private, plain swaps); `drift-ai/config-readers.ts:10` and `code-intel/json-utils.ts:27` (exported — re-export under the existing names so importers do not churn); `logs-audit/logs-audit-redaction.ts:56`. **`scripts/lib/verify-metadata-core.ts:58` is exempt and must keep its private copy** — see [Corrections](#corrections-to-the-pack). Choose `isRecord` vs `isObjectLike` per call site; do not create a second guards module. | Six declarations become re-exports or imports; the codec keeps its private guard | `bun run test:scripts:file -- scripts/lib/records.test.ts`; `bun run test:scripts:file -- scripts/drift-ai/config-readers.test.ts`; `bun run test:scripts:file -- scripts/suppression-ledger-baseline.test.ts`; `bash scripts/tests/test-verify.sh` |
| H7 | **`errorMessage`: the dense half plus a converge-on-touch rule** (leaf 31 step 2, shrunk). 45 non-test ternaries live under `scripts/` including the helper's own body at `scripts/lib/error-message.ts:11`, so 44 candidates. Convert only the densest files — `mutation-survivors.ts`, `db-status.ts`, `harness/registration-generated-checks.ts` (three each) and `drift-ai/config.ts` (two) — and add the converge-on-touch sentence to the helper's docstring, mirroring H4. Skip any caller needing a `stderr`/`stdout` payload or structured fallback and say so in the commit body. **Do not** touch `scripts/codemods/lib/fixture-runner.test-helper.ts:151` — same name, different behaviour on non-`Error` input. `tools/lint-ratchet/` is out of scope (sealed package boundary). | The four densest files import the shared helper; the docstring states the rule | `bun run test:scripts:file -- scripts/mutation-survivors.test.ts`; `bun run test:scripts` |
| H8 **[G]** | **The shell harness-finding helper** (leaf 31 step 3). Add `scripts/lib/harness-finding.sh` exporting `emit_harness_finding` with `control`/`severity`/`why`/`howToFix` required and `path`/`line`/`messageId` optional, mirroring `scripts/doctor.sh:82`'s existing defaults and numeric-`line` validation, and preserving the "line requires `path`" invariant `harnessFindingSchema` enforces. Source it from `doctor.sh`, `verify-logs.sh`, `migration-safety-scan.sh`, `generate-module-index.sh`. The justification is correctness, not tidiness: `generate-module-index.sh:82,84` builds findings as **raw JSON string literals with no `jq` at all**, so it can emit a document the schema rejects. **Function definitions only, no source-time side effects** — `scripts/lib/` is sourced by `scripts/verify.sh` and the hooks at runtime. **Register the new file as a smoke subject and regenerate**, or the fixture copy-set gate fails. | One producer shape; the two raw-JSON literals are gone; envelope still validates | `bash scripts/tests/test-doctor-json.sh`; `bash scripts/tests/test-verify-logs.sh`; `bash scripts/tests/test-migration-safety-scan.sh`; `bash scripts/tests/test-generate-module-index.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| H9 | **`drift-ai` local clean-ups** (leaf 31 steps 4, 5, 8). Delete `SOURCE_LIKE_EXTS` in favour of `BUILT_IN_SOURCE_EXTENSIONS`; drop the `ghost-files-tokens.ts` pass-through; move `changedFilesFromScope` beside its inverse in `scope.ts`. Flip `readPath` to `(value, flag)` to match its four siblings and rename the unrelated CSV `readPath` in `dolos-output.ts:142`. Fold `coverage-unused-correlation.ts`'s three identical "unavailable" results onto one factory. | One extension set, one `readPath` name per meaning, one unavailable factory | `bun run test:scripts:file -- scripts/drift-ai/arg-readers.test.ts`; `bun run test:scripts:file -- scripts/drift-ai/ghost-files.test.ts`; `bun run drift:ai -- --help` |
| H10 | **`drift-triage`, code-intel server-cli, and the dead tail** (leaf 31 steps 6, 7, 10). Delete the duplicate `CLONE_CHECKS`; add a pure `uniqueLocations` beside the mutating `mergeUniqueLocations` (**keep the mutator** — one genuine merge-into-existing caller). Add `daemonResult(exitCode, message)` in `code-intel/server-cli.ts` supporting all **three** shapes, not two. Delete `finalizeRecord`, `definitionNameMissHint`, the dead `.sort()` at `lint-message-eval/evaluator.ts:214` and its single-caller `setHasEvery`; unify `armFor`/`armIterations` on one lookup with an explicit missing-arm policy. | Dead helpers gone; three result shapes expressible | `bun run test:scripts:file -- scripts/drift-triage/triage-report.test.ts`; `bun run test:scripts:file -- scripts/code-intel/server-cli.test.ts`; `bun run test:scripts:file -- scripts/lint-message-eval.test.ts` |
| H11 **[G]** | **Create `scripts/worktree-db/` with one seam** (leaf 29 step 4, shrunk). Move the tombstones/allocations/state-codec cluster H1 just cleaned into `scripts/worktree-db/state.sh`, sourced unconditionally at top level from the `scripts/worktree-db.sh` facade. Give the part an `__MUSI_WTDB_STATE_SOURCED` guard and **forbid part-to-part sourcing** — the `readonly` block at `scripts/worktree-db.sh:88-138` aborts if a part is reachable by two sourcing paths. Do **not** move the merge-driver installers: `scripts/tests/test-lint-ratchet.sh:2125` reads `scripts/worktree-db.sh` by hardcoded path and matches column-0-anchored regexes, and would fail with "installers differ", not a sourcing error. Add the new part to the `# smoke-subjects:` header of `scripts/tests/test-worktree-db.sh` and regenerate. **Stop after one seam**; further seams are opportunistic, not scheduled. | Facade sources the part; all four sourcing consumers still resolve every callee; installers untouched | `bash scripts/tests/test-worktree-db.sh`; `bash scripts/tests/test-lint-ratchet.sh`; `bun run test:scripts:subjects`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| H12 **[G]** | **Move the `worktree-seed` family** into `scripts/worktree-db/`, discharging the disposition `28-PLAN.md:163` assigned to leaf 29. Five non-test modules plus two tests. `scripts/worktree-db.sh:433` resolves the checker relative to `${BASH_SOURCE[0]}`'s directory behind the `MUSI_SEED_IMPORT_CLOSURE_CHECKER` env seam — update the default path with the move. Flip the inventory rows if 28.4 has landed. | Family lives under the owner directory; the env seam default resolves | `bun run test:scripts:file -- scripts/worktree-db/worktree-seed-import-closure.test.ts`; `bash scripts/tests/test-worktree-db.sh`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| H13 | **`scripts/path-policy/MODULE.md` + README row** (leaf 49 steps 1–2). Follow `docs/guides/add-module-doc.md`, modelled on `scripts/drift-triage/MODULE.md`. Record the pass order, the sole external export `validateFixtureShellDependencies` (`fixture-shell-dependencies.ts:242`) and its non-obvious precondition role at `smoke-subject-headers.ts:177`, the `# fixture-closure:` annotation vocabulary, the scope-plus-root keying rule, and the entry-path blind spot — **pointing at the source comments, not restating them**. Disambiguate from `scripts/harness/fixture-closure-check.ts`. Update `scripts/README.md`'s directory row to name both concerns. | MODULE.md exists; index regenerated in the same commit | `bun run module:index`; `bun run module:index:check`; `bun run format:check` |
| H14 | **Unify `scripts/path-policy/`'s vocabulary** (leaf 31 step 9), refreshing H13's Data Flow paragraph in the same commit. One smoke-file pattern module exporting **both** meanings — the repo-relative `/^scripts\/tests\/test-[^/]+\.sh$/u` at `path-policy-query-core.ts:132` and the bare-basename `/^test-.+\.sh$/u` used three times — as a basename predicate plus a directory-qualified wrapper. **Do not collapse them**; the path policy feeds the commit gate. Point the two unaware `normalizePath` copies (`smoke-subject-headers.ts:24`, `path-policy-query-core.ts:36` `normalizeComparablePath`) at the exported owner at `fixture-copy-expressions.ts:65`, and fold `fixture-helper-calls.ts:46-60`'s private `stripQuotes`/`capture` onto the exported pair. | Two meanings preserved; three normalisers become one; doc refreshed | `bun run test:scripts:file -- scripts/path-policy/fixture-shell-dependencies.test.ts`; `bun run test:scripts:file -- scripts/path-policy/smoke-subject-headers.test.ts`; `bun run test:scripts:subjects:check`; `bun run harness:check` |
| H15 | **Path-policy dead data, the constant-true predicate, and lazy discovery** (leaf 31 steps 11–13). Delete `PATH_POLICY.directoryPrefixSubjects.sourceRelevant` (`path-policy.ts:256-264`) and its type field at `:79`, keeping `.scriptSmoke`, which `path-policy.test.ts:264-265` asserts on; hoist the duplicated `excludedDirectoryNames`. Resolve `matchesFormatCheckCandidate` (`path-policy-query-core.ts:115-118`) — delete it, or keep the runtime check with a comment saying it guards a future non-prettier `parserSurface`. A `: string` widening annotation with no explanation must not survive. Make `SCRIPT_SMOKE_TEST_NAMES` (`path-policy-smoke-subjects.ts:21`) a memoised function and update the three reads at `path-policy-query-core.ts:141-158`. | Dead field gone; discovery lazy; the predicate is deleted or explained | `bun run test:scripts:file -- scripts/path-policy/path-policy.test.ts`; `bun run test:scripts:file -- scripts/path-policy/path-policy-query.test.ts`; `bash scripts/tests/test-test-scripts.sh`; `bun run harness:check` |
| H16 | **Move the Markdown projection out of `hook-wiring-schema.ts`** (leaf 32 step 1). Cut `formatOutputs`, `formatCommandDetails`, `formatHarnessLine`, `formatHookWiring` (`:373-412`) into `scripts/harness/hook-wiring-doc.ts` and repoint the single import in `scripts/harness/generate-harness-controls.ts:28`. Mechanical; no behaviour change. | The `*-schema.ts` name is truthful; generated docs byte-identical | `bun run test:scripts:file -- scripts/harness/generate-hook-wiring.test.ts`; `bun run docs:harness-controls:check`; `bun run harness:check` |
| H17 | **Two written harness rulings, one commit** (leaf 33 step 1 + leaf 32 step 6). Add an env-var naming rule to `docs/ai-harness.md`. Recommended taxonomy, to be adopted or deliberately overruled — **the rule is chosen, not derived**: `HARNESS_` for cross-tool protocol surfaces a producer and consumer must agree on (`HARNESS_DIAGNOSTICS_OUTPUT` is already exactly this, `docs/ai-harness.md:222-236`); `MUSI_` for repo-local operator and CI knobs; `AI_` for hook implementation and test controls; existing unprefixed names frozen. Exempt test-only fakes (`AI_BUN_FAKE_STARTED`, `AI_FAKE_NOW`, `AGENT_FAKE_*`) explicitly rather than treating them as user knobs. In the same commit state whether git hooks are in or out of the shim convention `scripts/harness/hook-shims.ts:1-11` documents. No rename, no inventory, no enforcement. | Both rules stated where the next author looks | `bun run backlog:lint`; `bun run format:check`; `bun run harness:check` |
| H18 | **code-intel result narrowing** (leaf 35 steps 1–3). Add `Extract<IntelResult, { kind: … }>` aliases beside the existing `DefinitionResult` (`types.ts:60`); narrow `queryDefinition`/`queryExports`/`queryDependents`/`queryTests` and `ReferencesQueryResult.results`. Then retype the seven formatters (`format.ts:219-255`) to their specific arm and delete each opening unreachable `throw`, and pass the kind into the empty-line path instead of `header.startsWith` sniffing (`format.ts:202-209`). Compiler-verified throughout. | No formatter opens with an impossible throw; no header sniffing | `bun run test:scripts:file -- scripts/code-intel/format.test.ts`; `bun run test:scripts:file -- scripts/code-intel/query-executor.test.ts`; `bun run typecheck` |
| H19 | **Move logs-audit's core types out of the executable** (leaf 35 step 5). New `scripts/logs-audit/logs-audit-types.ts`; repoint the five production back-edges; delete the three duplicate `JsonObject` declarations and the derived alias at `logs-audit-format.ts:14`; remove the apologetic comment at `logs-audit-diagnostics.ts:21-23` once it is false. `logs-audit/logs-audit.test.ts:20` imports runtime symbols from the entrypoint and stays as it is. Either rename `logs-audit-checks.ts` to match its contents or make it a real barrel; inline `parseJsonLine`. | No production `import type … from "../logs-audit.js"` remains | `bun run test:scripts:file -- scripts/logs-audit/logs-audit.test.ts`; `bun run typecheck` |
| H20 | **Optional: reshape `CodeIntelContext`** (leaf 35 step 4). Replace the seven-optional bag (`source-project.ts:15-23`) with command-specific context types or a resolver object constructed once. Acceptance: `query-executor.ts` stops reading a different optional field per command, and a context missing its command's dependency is a type error rather than a silent full-workspace rebuild. **All four daemon fills must still type-check**, and `graphProject`-without-`sourceFiles` is valid, not invalid. Keep the from-disk fallbacks reachable but explicit at the call site. Do only if someone is already in this tree. | The bag is gone; daemon fills compile; `graph-cache.ts:152`'s deliberate `{}` call still works | `bun run test:scripts:file -- scripts/code-intel/query-executor.test.ts`; `bun run test:scripts:file -- scripts/code-intel/daemon-query.test.ts`; `bash scripts/tests/test-code-intel.sh` |
| H21 | **Optional: `ManifestGatedCache<TEntry>`** (leaf 35 step 6a, structural only). Extract the shared manifest gate from `GraphCache`/`ProjectCache` and fold the two full-workspace `Project` constructions onto one helper. Keep both entry shapes, both rebuild functions, and the injectable `computeManifest`/`rebuild` seams the tests depend on. Record the graph-vs-symbol routing reason (`daemon-query.ts:46-55`) in the module doc. **Do not merge the cached payloads** — that is step 6b and needs a measurement nobody has. | One gate implementation, two entry types, invalidation granularity unchanged | `bun run test:scripts:file -- scripts/code-intel/graph-cache.test.ts`; `bun run test:scripts:file -- scripts/code-intel/daemon-query.test.ts` |
| H22 | **Delete `LintRatchetConfig.repairKind`** (leaf 36 step 1). Remove `config-types.ts:19` and `:49`, then strip the write sites: 17 registry entries in `scripts/lint-ratchet/lint-ratchet-config.ts`, two factories in `registry-builders.ts`, the two governance probe configs, `propose.ts`'s scaffold template and its field-list comment, the test fixtures, and `scripts/lint-ratchet/output.test.ts`'s fixture source text. **Do this by type, never by `rg repairKind`** — three unrelated fields share the name and the other two typecheck fine if removed. Hand-edit the four guide examples and `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts:41` (separate workspace, no typecheck script, so a miss surfaces only in its smoke). | The field is gone from the kernel config; the rule-docs and harness-finding `repairKind`s are untouched | `bun run test:scripts:file -- scripts/lint-ratchet/output.test.ts`; `bun run test -- tools/lint-ratchet/src/governance/propose.test.ts`; `bun run lint:ratchet:check-registry`; `bun --filter lint-ratchet-demo smoke`; `bun run harness:check` |
| H23 | **Move the scripts-tsconfig inference to the Musi adapter** (leaf 36 step 2). Move the `ratchet.files.every(p => p.startsWith("scripts/"))` → `"./tsconfig.scripts.json"` default out of `tools/lint-ratchet/src/kernel/eslint-config.ts:108-119` into `scripts/lint-ratchet`, keeping the kernel honouring an explicit `typeAwareProject` and keeping the explanatory comment with the logic wherever it lands. **Leave `allowEmpty` in the kernel** — leaf 36 step 3 is dropped; see the disposition table. | The kernel carries no Musi-registry convenience; ratchet results unchanged | `bun run test -- tools/lint-ratchet/src/kernel/eslint-config.test.ts`; `bun run test:scripts:file -- scripts/lint-ratchet/check-registry.test.ts`; `bun run lint:ratchet:check-baseline`; `bash scripts/tests/test-lint-ratchet.sh` |

Out of scope for this plan, with the ruling recorded: leaf 29 steps 3 and 5;
leaf 30 step 3 (bulk) and the rest of step 4; leaf 31 step 1's
`verify-metadata-core.ts` target and the bulk of step 2; leaf 32 steps 2, 4 and
5; leaf 33 steps 2–3; leaf 35 step 6b; leaf 36 steps 3 and 4; leaf 49 step 3.

## Dependency edges

Re-derived, and **two edges recorded in the leaves are corrected**:

- **`H1 → H11` (hard).** The state-codec primitive must exist before its cluster
  moves into a part file, or the move and the dedup get debugged together. This
  is the leaf's own step-1-before-step-4 ordering, kept.
- **`28-PLAN.md` slice 28.1 → H11, H12 (hard).** Unchanged from
  `28-PLAN.md:156-161`: leaf 29 creates a `scripts/<topic>/` owner directory and
  needs the written position first. 28.4 before H12 is preferred, not blocking —
  if H12 lands first, the new rows are simply declared when 28.4 seeds the
  inventory.
- **`H11 → H12`.** The directory must exist before the family moves into it.
- **`H13 → H14 → H15`.** The doc names the seams H14 unifies. H14 refreshes the
  doc's Data Flow paragraph in its own commit.
- **`27-PLAN.md` slice 27.3 → H15 (hard, and narrowed).** `00-index.md` and leaf
  31 both record the edge as `27 and 32 → 31 step 13`. **Leaf 32 no longer adds
  a smoke file** — its step 4 is not scheduled — so the surviving edge is
  `27.3 → H15` alone. 27.3 lands the last new `scripts/tests/test-*.sh`
  registration before H15 changes how `path-policy-smoke-subjects.ts` discovers
  names.
- **`H18 → H20` (soft).** Both edit `query-executor.ts`; landing the narrowing
  first makes the context reshape a smaller diff. **`H20 → H21`** if both are
  done. Both are optional and droppable.
- **`H6 → H7` (soft).** Both are `scripts/`-wide adoption slices; landing the
  guards first keeps the two diffs separable in review.
- **H2, H3, H4, H5, H8, H9, H10, H16, H17, H22, H23 are independent** of
  everything and of each other. H16 and H17 are the cheapest useful work here.
- **The `31 ↔ 49` edge is dissolved, not sequenced.** Merging leaf 31's
  path-policy third into leaf 49 (H13–H15) removes the concurrency hazard both
  leaves flag rather than scheduling around it.
- **Dropping leaf 29 step 4's full decomposition and leaf 32 step 4 removes the
  cluster's only hard upstream blockers on other people's work.** The
  `27.2 → 27.3 → 32.4` edge remains correct *for that rejected operation*;
  nothing in this schedule waits on it.

## Operational risk: the commit gate

**This section is the reason leaf 32 steps 4–5 are not scheduled.**

### Why the premise is weaker than the leaf states

`.husky/pre-commit` does not "implement the commit gate inline". Lines
`:419-461` declare `PRECOMMIT_GATE_POLICY`, a 40-key associative array, and hand
it by name to `musi_verify_run_gate` (`scripts/lib/verify-engine.sh:755`), which
owns lock, marker, bridge, log, signal, slot dispatch, aggregation, metadata and
finalization. `scripts/verify.sh:188-227` is the **same shape** — a policy map
plus provider functions plus one `musi_verify_run_gate` call — and
`docs/guides/verify-gate-lifecycle.md:33-41` documents precisely this seam. What
the hook holds is *policy*, which the ruling and that guide both say it should
own. The mechanics are already extracted.

So the leaf's headline ("900 lines of gate orchestration inline") measures lines,
not layering, and its own diagnosis concedes the consequence is
**discoverability, not correctness** (`32-git-hook-shims.md:22-31`). The
discoverability defect is that the gate's tests are filed under
`test-dependency-freshness.sh`. That is `27-PLAN.md` slice 27.3, which is
test-only and already scheduled.

### Four hazards the leaf does not name

1. **`harness:check` statically parses the hook's source, and would fail.**
   `scripts/harness-check.ts:128` does
   `readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8")` and passes it to
   `scripts/harness/registration-preflight-wiring.ts`, which matches **literal
   source fragments** — `REGISTRATION_ADMISSION_HOOK='musi_precommit_registration_admission'`,
   `musi_precommit_snapshot_fast_mode() {\n`, and a list of body strings — and
   asserts their relative ordering. A dispatcher empties that file, and the check
   fails with "pre-commit does not bind registration admission and provenance to
   one under-lock fast-mode snapshot" (`:69`, `:78`, `:85`, `:99`) — messages
   that point at gate policy, not at the refactor that broke them. This alone is
   a re-plumbing job the leaf does not budget for.
2. **`[wrapper_command]="$0"` (`.husky/pre-commit:424`).** The value is written
   into run metadata (`verify-engine.sh:904`, `:918`) and read back by history
   and log tooling. Exec'ing a body file silently changes that identity.
   `scripts/verify.sh:192` uses an explicit `$WRAPPER_COMMAND` variable for
   exactly this reason.
3. **Husky's stub is fail-open.** `.husky/_/h:6` is `[ ! -f "$s" ] && exit 0` —
   if `.husky/pre-commit` is absent, **there is no gate and git reports success**.
   A dispatcher adds a second file that can go missing; it would have to fail
   closed itself (`exec` of a missing file exits nonzero — it must not be wrapped
   in `|| true`).
4. **Merges never run it.** `.husky/` has no `pre-merge-commit` hook, and
   `scripts/land.sh:287` additionally runs one merge under
   `-c core.hooksPath=/dev/null`. A broken `.husky/pre-commit` therefore **lands
   on `main` through the normal integration path without ever executing**, and
   first bites every worktree's next direct commit.

### The blast radius, re-measured

Larger than the leaf's "six sandboxes". Verified live: **27 `cp`/`copy_precommit_fixture`
call sites across `scripts/tests/*.sh`**, 61 referencing lines in
`test-dependency-freshness.sh` alone, plus a **second copier the leaf misses** at
`scripts/tests/test-verify-history.sh:176`, which carries its own
`# smoke-subjects: .husky/pre-commit` header at `:27` and execs
`sh .husky/pre-commit` at `:211`. Add the two generated declarations at
`scripts/path-policy/path-policy-smoke-subjects-data.ts:86`, `:123`.

That last point cuts against the leaf's own instruction. Leaf 32 step 4 says to
"update the smoke subject registration so the new body, not the dispatcher, is
the declared subject". **`.husky/pre-commit` would have to remain a declared
subject regardless** — otherwise an edit to the dispatcher alone stops selecting
its own coverage in changed mode.

### The rollback procedure, if someone does it anyway

Better than the leaf implies, and worth writing down. Git executes the
**working-tree** `.husky/pre-commit` (via `core.hooksPath=.husky/_` and the
`.husky/_/h` shim, which resolves `$s` from the checkout). So a broken gate is
recovered without any bypass:

```
git checkout <last-good-sha> -- .husky/pre-commit scripts/hooks/
# the gate works again immediately; now commit the revert
git revert --no-edit <bad-sha>
```

This must be done **per worktree**, and anyone who already pulled the bad commit
is blocked until they run it. Agents cannot take the usual escape hatch:
`--no-verify` and `HUSKY=0` are blocked by the repo's own command policy
(`.husky/pre-commit:29-30`, enforced at `scripts/ai-hooks/policy.sh:672-687`,
pinned by `scripts/ai-hooks/test.sh:420-437`). `.husky/_/h:14` still honours
`HUSKY=0` at the git level — the block is the agent policy, not git. So the leaf's
"including the commit that would fix it" overstates the trap, but the absence of
a sanctioned bypass is real, and recovery is a manual per-checkout restoration.

### Conditions under which leaf 32 step 4 would be reconsidered

Not "never", but not on discoverability alone. All five:

1. 27-PLAN slice 27.3 has landed and the gate's tests have carried their own name
   long enough that the findability complaint is still live.
2. A second consumer needs the body — a CI job or a second hook that should run
   the same adapter. Today there is exactly one.
3. `registration-preflight-wiring.ts` has been re-pointed at the new file, with
   its ordering assertions rewritten and green, **before** the move.
4. The dispatcher sets `wrapper_command` explicitly, fails closed on a missing
   body, and keeps `.husky/pre-commit` a declared smoke subject — all three
   pinned by tests written first.
5. It lands alone, on its own branch, verified by making real commits in a
   secondary worktree (`docs/guides/per-worktree-dev.md`), never combined with
   27.3.

### Other operational risks in this plan

1. **Every file move triggers a full 52-suite smoke run on its own commit.**
   `scripts/path-policy/path-policy.ts:283-287` marks any deleted path under
   `scripts/` or `.husky/` smoke-sensitive and `scripts/test-scripts.sh:196-214`
   falls back to the full suite. H8, H11, H12, H16 and H19 each pay this once.
   Budget it; do not treat a slow gate as a failure.
2. **H11 is the most dangerous scheduled slice.** `worktree-db.sh` provisions
   real databases, ports and Redis DBs for every worktree; a mistake breaks
   `bun run dev` for everyone. Three specific traps: the `readonly` block at
   `:88-138` aborts if a part is reachable by two sourcing paths; the
   `declare -F compute_fingerprint`/`compute_slug` probes in `scripts/dev.sh:8`,
   `scripts/worktree-new.sh:28` and `scripts/worktree-drift-hook.sh:22` pass on a
   split that drops any *other* callee; and `scripts/tests/test-lint-ratchet.sh:2125`
   reads the file by hardcoded path. Keep
   `bash scripts/tests/test-worktree-db.sh` green on every commit — it sources
   all four consumers and is the only cheap defence.
3. **H8 and H14/H15 change gate-feeding code.** `scripts/lib/` is sourced by
   `scripts/verify.sh` and the hooks at runtime, and `scripts/path-policy/` feeds
   the changed-file classification `verify:changed` and pre-commit use. Run
   `bun run harness:check` before committing either.
4. **Do not wire anything new into registration admission.** `.husky/pre-commit`
   runs `harness:registration:check` under a hard 5-second timeout before
   cached-marker reuse on every source-relevant commit.
5. **Generated surfaces fail structurally for everyone if committed partially.**
   `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
   `scripts/fixtures/test-scripts/all-smoke-tests.txt` are generated and reject
   hand edits; regenerate with `bun run test:scripts:subjects` and commit both in
   the same slice.
6. **Do not reach for fast-commit to escape these gates.** Its marker lives in
   the shared git common dir, so one agent's toggle affects every sibling
   worktree, and it skips exactly the test and scripts slots under refactor here.

## Corrections to the pack

Re-measured live; the leaves' claims hold in shape, and these are the deltas.
Apply them when the leaf rows are next reconciled.

- **Leaf 31 step 1 contradicts leaf 30's own caveat and must not be followed as
  written.** It lists `scripts/lib/verify-metadata-core.ts:58`'s private
  `isJsonObject` as a conversion target, but `:16-18` records that the file is
  "deliberately self-contained (node builtins only): shell tests copy it into
  sandbox repos next to verify-metadata.sh, so it must run from any directory
  with no sibling imports" — and its only import is `node:fs`. Leaf 30 exempts
  the same file for the argv-offset constant for the same reason. H6 converts six
  sites, not seven.
- **Leaf 36 step 3 is wrong.** `allowEmpty` is documented adopter-facing registry
  contract (`docs/guides/lint-ratchet-adoption.md:140`,
  `docs/guides/lint-ratchet-reference.md:239`), not a Musi-only leak. It stays in
  the kernel config type; only the `scripts/`-prefix tsconfig inference moves.
- **Leaf 29's counts.** `scripts/worktree-db.sh` has **123** top-level function
  definitions, not 126 (plus three nested inside `write_worktree_env`). Of the 30
  `jq` tokens, two are in comments. Six `sed`, zero `awk` — confirmed. No `jq`
  appears in fingerprinting, so naming fingerprinting as a likely TS-core cluster
  is unsupported by the file.
- **"Seven copies of the same codec" overstates leaf 29.** The *write* mechanics
  duplicate; the read schemas and validation behaviour genuinely differ
  (`worktree-db.sh:2092-2235`; `stop-policy.sh:61-83`, `:187-212`, `:351-375`,
  `:482-510`). H1 and H2 share the write halves only, which is why the read-half
  step is dropped rather than deferred.
- **Leaf 30's 19 walkers are not 19 candidates.** Eight are already classified by
  `02-harness-cli-parse-spec.md` S6; `code-intel/lifecycle-probe.ts` scans another
  process's command line rather than its own argv; the client-isolation runner is
  a pass-through filter. The one scheduled migration is `sensor-knip-unused-exports-core.ts`.
- **Leaf 30's offset count has grown**: 33 declaration sites under seven
  spellings, not 32.
- **Leaf 32 undercounts its own blast radius** (27 copy sites plus a second
  copier suite) and omits the `harness-check.ts` static source parser entirely.
- **Leaf 36's `testId` spread** is ~170 non-test occurrences across kernel and
  adapter; the 35 committed JSONL keys are correct.
- **Leaf 49's arithmetic** is now 5,109 lines / 1,851 test lines, and
  `fixture-loop-bindings.ts` is not purely string-based — glob expansion reaches
  `readdirSync`. Both are reasons the test split buys less than the leaf claims.
- **The 05 plan's S2 latency numbers are historical measurements** and were not
  re-taken here. They are used as the recorded cost of the pattern, not as a
  current benchmark.

## Rejected alternatives + why

| Rejected | Why |
|---|---|
| Treat this cluster as a bash→TypeScript migration programme | The boundary is already ruled at `docs/ai-harness.md:255`, signed off, with recorded exceptions and a recorded rewrite rejection. A new position would be a re-litigation; applying the existing one deletes work rather than authorising it. Both consults reached this independently. |
| Extract `scripts/worktree-db/*-core.ts` siblings (leaf 29 step 5) | Fails the 05 plan's own measured bar: 28 non-comment `jq` lines, 6 `sed`, 0 `awk` across seven concerns is the opposite of the concentrated hand-rolled codec that plan ported; its `jq` is a real parser used fail-closed, not a defect class; and a bun codec spawn (~21 ms) costs more than the `jq` it would replace (~16 ms). |
| Rewrite `.husky/pre-commit` or `scripts/doctor.sh` in TypeScript | The ruling names both classes as bash by design; `agent-run.sh`'s rewrite was already rejected under copyability, and gate glue is traps, locks, markers and watchdogs. |
| Split the `.husky/pre-commit` body behind a dispatcher (leaf 32 step 4) | Buys discoverability that 27.3 already buys, in the one file that can block every commit in every worktree, with no sanctioned agent bypass and four unnamed hazards — chief among them that `harness:check` statically parses the hook's source and would fail with a message about gate policy. Both consults said do not schedule it. |
| Replace `generate-hook-wiring.ts`'s JSON scanner with `jsonc-parser` (leaf 32 step 2) | Verified: no `jsonc-parser` or equivalent exists in any manifest, so this adds a dependency to a generator whose entire job is byte-preserving a co-owned, prettier-ignored file that Claude Code itself rewrites. 101 working lines with ~95 lines of pinned contract tests are not worth it. The leaf sanctions won't-do; recorded as such rather than left open. |
| Re-triage `parseCli` adoption across 19 argv walkers (leaf 30 step 4) | S6 already classified 8 of the 19 with reasons. Re-opening a closed classification that has a live owner is duplicated work. H5 takes the single entry S6 left explicitly open; the rest are classified when touched. |
| Sweep all 32 argv-offset re-declarations (leaf 30 step 3) | The ten free sites are one commit; the remaining ~22 each need a new import line for symbol-search benefit only. H4 takes the free half and amends the policy so the count cannot grow silently. |
| Keep the opportunistic-convergence policy unchanged (leaf 30 step 2b) | Cursor's and codex's pick. Rejected on measurement: the constant exists to end respellings and the count has *grown* to 33, the newest landing 2026-07-25. A policy producing the thing it was written to stop is not one to preserve verbatim — but the consults' cost objection is honoured by sweeping only the free ten. |
| Add a lint rule banning new local argv-offset constants | The honest enforcement answer, and the escalation if a new respelling lands after H4 — but it fires across the tree, so it must land through the ratchet (`docs/guides/lint-ratchet.md`), which is more machinery than a comment amendment plus ten one-line edits. Recorded as the named follow-up, not scheduled. |
| Sweep all 44 `errorMessage` ternaries (leaf 31 step 2) | Codex called the full sweep churn and was right about the tail. H7 takes the four densest files and applies the same converge-on-touch rule as H4, so the plan treats both stalled-adoption cases identically. |
| Drop the shell finding helper (leaf 31 step 3) | Codex's position; rejected. `generate-module-index.sh:82,84` builds findings as raw JSON string literals with no `jq`, so it can emit a document `harnessFindingSchema` rejects. That is a correctness seam, not tidiness, and `scripts/lib/` is the documented home. |
| Schedule leaf 31's thirteen steps as one item | The leaf itself forbids it ("must be split before it is scheduled; the L rating is per-part"). |
| Point `verify-metadata-core.ts`'s guard at `scripts/lib/records.ts` (leaf 31 step 1) | Breaks the file's self-containment contract at `:16-18`; six sandbox suites copy it next to `verify-metadata.sh`. Leaf 30 exempts the same file for the same reason — the two leaves contradict each other and leaf 30 is right. |
| Sequence leaf 31's path-policy steps around leaf 49 | Both leaves flag the concurrency hazard and neither can own the directory alone. Merging them (H13–H15) dissolves it, and lets the MODULE.md be written once rather than written and immediately made stale. |
| Split `fixture-shell-dependencies.test.ts` (leaf 49 step 3) | **Both consults declined it independently.** Moving 30 cases changes assertion seams without adding coverage or improving changed-mode selection, the leaf's own caveats forbid converting the cross-file cases, and one of the four "pure string" modules reaches `readdirSync` anyway. H13's doc is the part that pays. |
| Finish the `testId` → `ratchetId` rename (leaf 36 step 4) | ~170 live occurrences across a sealed package, its adapter, both test suites, shell fixtures and guides, on a path where the natural fix to the compile error silently breaks strict parse of every committed debt-log row — and the historical rows are read from git at the base ref, so a data migration does not help. The readers are wired into every verify slot set. Belongs in the same versioned leaf as the baseline `tests` key. |
| Move `allowEmpty` to the adapter (leaf 36 step 3) | It is documented adopter-facing contract in two guides. Removing it from the kernel config type would contradict them and the standalone demo. |
| Merge `GraphCache` and `ProjectCache` payloads (leaf 35 step 6b) | One request touches exactly one cache (`daemon-query.ts:46-55`), so a merge only helps an alternating warm-daemon workload and *hurts* single-kind workloads. The leaf requires a measurement first; nobody has taken it. |
| Inventory or enforce env-var prefixes now (leaf 33 steps 2–3) | The rule can be written without an inventory — that is the leaf's own point — and enforcement needs read-site detection to avoid firing on the twelve `HARNESS_*` identifiers that are not environment reads at all. |
| Do the whole cluster as proposed | Cursor's strongest push-back, largely adopted: roughly forty proposed steps reduce to twenty-three slices (two optional), and every gate-path item is dropped or reduced to one seam. |

## Consult disagreements and how they were called

- **Whether the substrate question is open.** Both said no, independently, and
  both cited `docs/ai-harness.md:255` and the 05 plan's measured stop. Adopted
  without change; it is this plan's spine.
- **Leaf 32 step 4.** Both said do not do it. Called their way. Codex supplied
  the decisive evidence neither the leaf nor cursor had — `harness-check.ts:128`
  statically parsing the hook body — which is verified above and promoted to
  hazard 1. The rollback procedure is this plan's, not either consult's.
- **Leaf 29 step 4.** Codex said drop the decomposition entirely; cursor said
  "maybe later, after 28.1". Called between them: **one seam plus the
  `worktree-seed` move**, because `28-PLAN.md:163` assigns that move to leaf 29
  and dropping step 4 outright would leave a landed plan's disposition dangling.
- **Leaf 30 step 2.** Both consults said keep the opportunistic policy. Called
  against both, on the re-measured count — but only the free ten sites are swept,
  which is their cost objection honoured.
- **Leaf 30 step 4.** Codex found the one entry S6 left open
  (`sensor-knip-unused-exports-core.ts`); cursor would have dropped the whole
  step. Codex's version adopted — closing an explicitly-open follow-up is
  strictly better than leaving it.
- **Leaf 31 steps 2 and 3.** Codex said drop both; cursor said keep both. Split:
  step 2 shrunk to the dense half (codex right about the tail), step 3 kept
  (cursor right that the raw-JSON producer is a real defect).
- **Leaf 35 step 4.** Codex said drop; cursor kept steps 1–5. Kept as **optional**
  (H20) — codex's stated reason was about the cache routing, which does not bear
  on the context bag.
- **Leaf 49 step 3.** Both declined the test split. Called their way; this is the
  clearest two-model agreement against a leaf's own proposal in the cluster.
- **Leaf 36 step 3.** Codex alone caught that `allowEmpty` is documented adopter
  contract. Verified against both guides and adopted.

## Method note

The `consult cursor` run was dispatched and completed before any draft of this
file existed. The `consult codex` run overlapped the drafting: it read part of an
early draft inside the shared worktree before the wrapper's drift check removed
it. Codex's answer nonetheless diverges from that draft on seven dispositions and
supplied four findings the draft lacked (the `harness-check.ts` source parser, the
`verify-metadata-core.ts` contradiction, the `allowEmpty` documentation, and the
corrected function/`jq` counts), so it is treated as a genuine second opinion —
but where it merely agrees with a position the draft already stated, it is
recorded above as corroboration rather than independent confirmation.
