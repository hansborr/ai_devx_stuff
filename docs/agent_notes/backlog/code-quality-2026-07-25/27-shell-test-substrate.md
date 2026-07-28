# 27. The shell smoke suites re-declare their own test framework per file, so they grow until each one covers many unrelated subjects

Status: Proposed — not promoted
Theme: shell test substrate · Area: harness · Severity: medium · Size: XL

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

There are 52 shell smoke suites under `scripts/tests/`, totalling ~36,000 lines,
and almost every one of them opens by rebuilding the same miniature test
framework: `fail()` is redefined in 44 files, `ok()` in 38, the `PASS=0` counter
preamble in 38, a `mktemp -d` sandbox plus cleanup `trap` in 49, and a `new_repo()`
git-fixture builder in 15. `scripts/tests/lib/` holds only two helpers —
`test-git-env.sh` (23 lines, sourced by 23 of the 52) and
`test-lint-ratchet-edit-check-fixtures.sh` (237 lines, sourced by 2) — and
neither is an assertion library.

That per-file cost is what makes the files large, and size is where the real
damage shows up. Because starting a new suite means writing 40 lines of preamble
first, contributors add cases to whatever file is already open instead. The
result is suites whose name no longer describes their contents:
`scripts/tests/test-dependency-freshness.sh` is 2,386 lines, of which the 2,116
from the `hook_repo` fixture at `:271` to the end drive the pre-commit,
fast-commit and post-commit hooks — `pre-commit`/`post-commit` appear 292 times
against 41 mentions of dependency or Prisma, only `:204-269` calls the freshness
library directly, and the file's own docstring still claims "Pure-shell tests for
dependency freshness diagnostics." `scripts/tests/test-skill-dispatch-wrappers.sh` (5,403
lines) declares 20 smoke subjects; `scripts/tests/test-lint-ratchet.sh` (5,029
lines) declares 72 spanning a dozen implementation areas, from the ratchet kernel
to the git merge drivers to repo-root config; `scripts/ai-hooks/test.sh` is
4,079 lines. Changed-mode selection is subject-based, so a one-line edit anywhere
in those subject lists drags a 5,000-line suite into the run.

The same pressure pushes tests toward cheap-but-wrong assertions. The Stop-policy
suite's `assert_stop_status_reporters_have_loop_protection` discovers reporters
with `declare -F`, then asserts against `declare -f` *function bodies* — pinning
the literal printf format string `'%s\n\n%s'`, the exact phrase
`_disabled "$repo_root" && return 1`, the local variable name in
`rm -f "?\$counter"?`, and `COUNTER_COUNT.*-ge.*MAX_NOTIFY`, with awk line-number
comparisons to enforce ordering. Renaming `$counter` or substituting an
equivalent guard breaks that test while the hook behaves correctly.

The fix is not to invent a convention. `scripts/ai-hooks/test-support.sh` is
already exactly the shared assertion library this calls for, sourced by all ten
ai-hooks suites, and `scripts/ai-hooks/test.sh` is already a coordinator that
delegates nine behaviour families to focused scripts. The work is to finish and
generalize a pattern the repo has already proven.

## Evidence

- `scripts/ai-hooks/test-support.sh:1-86` — the existing shared library: `fail()`, `assert_contains`, `assert_not_contains`, `assert_no_output`, `assert_hook_json`, `assert_hook_continue_json`, plus shim builders. Its header states the intent ("Keep this file scoped to test support only").
- `scripts/tests/lib/` — the only shared code on the `scripts/tests/` side: `test-git-env.sh` (23 lines, sourced by 23 of 52 suites) and `test-lint-ratchet-edit-check-fixtures.sh` (237 lines, sourced by `test-lint-ratchet.sh` and `test-test-scripts.sh`). The sourcing convention exists; the assertion library does not.
- Duplication counts across `scripts/tests/*.sh`: `fail()` in 44 files, `ok()` in 38, `PASS=0` in 38, `mktemp -d` in 49, cleanup `trap` in 49, `new_repo()` in 15 (e.g. `test-test-client.sh:51`, `test-typecheck.sh:72`, `test-format-changed.sh:69`, `test-lint-changed.sh:104`).
- The 15 `new_repo()` bodies are **not** interchangeable. Only the git skeleton repeats (`git init -b main`, `user.email`/`user.name` config, `git add . && git commit -qm base`); each then copies a different dependency closure — `test-typecheck.sh` copies one script, `test-lint-changed.sh` copies ~25 files plus a `node_modules/@musi/lint-ratchet` symlink, `test-land.sh` and `test-pre-push.sh` root the repo at `$TMP_ROOT` rather than `$SANDBOX` and copy `.husky` hooks, and `test-slow-drift-audit.sh:new_repo` does not run `git init` at all.
- `scripts/tests/test-dependency-freshness.sh:23` — docstring says "Pure-shell tests for dependency freshness diagnostics"; `:19-20` already declares `.husky/pre-commit` and `.husky/post-commit` as smoke subjects. The hook coverage is one contiguous block: it opens at `:271`, where the `hook_repo` fixture copies `.husky/pre-commit` and the verify engine into a sandbox, and runs to the last line of the file (`:2386`). All 53 `sh`/`bash .husky/pre-commit` executions sit at or after `:271`. Of the 61 `.husky/pre-commit` and 6 `.husky/post-commit` referencing lines, the only ones that precede it are the `# smoke-subjects:` headers at `:19-20` and the two `cp` lines at `:115-116` inside `copy_precommit_fixture` — a helper this leaf's step 5 hoists to `scripts/tests/lib/` anyway.
- `scripts/tests/test-dependency-freshness.sh` has only nine `# ---` section headers in 2,386 lines (`:233`, then `:1521`, `:1557`, `:1593`, `:1631`, `:1670`, `:1813`, `:1852`, `:1887`), so they do not partition the file. The eight from `:1521` on cover 24 of the 61 `.husky/pre-commit` referencing lines; the other 37 sit earlier, spread from the first execution at `:296` to `:1511` across the doc-length, gate, lock, queue, manifest, config-surface, deletion, cache and bridge fixtures.
- `scripts/tests/test-dependency-freshness.sh:204-269` — the only stretch that drives the freshness library directly, through `assert_status` (`:80`); the last call is at `:262`. `scripts/prisma-client-freshness.sh` and `scripts/doc-length-policy.sh` have no direct case anywhere in the file: they appear only as fixture copies (`:106-107`, `:274-275`, `:678-679`, `:803-804`, `:1003-1004`, `:1474-1475`) exercised through the hook.
- `scripts/tests/test-dependency-freshness.sh:72-202` — seven helpers used only by the hook block: `write_live_memory_reservation` (`:72`, called at `:765`), `copy_verify_steps_fixture` (`:88`), `copy_precommit_fixture` (`:101`), `init_bridge_repo` (`:140`), `write_marker_with_ts` (`:158`), `seed_prior_verify_evidence` (`:172`), `assert_prior_verify_evidence` (`:186`). Small and localized; they belong in `scripts/tests/lib/`. `assert_status` (`:80`) is the exception — every one of its callers is in `:204-269`.
- `scripts/tests/test-skill-dispatch-wrappers.sh:3-23` — a **generated** block, `BEGIN/END GENERATED SKILL SMOKE SUBJECTS (bun run harness:skills:refresh)`, listing 19 subjects; `:24` adds the suite's own hand-written subject and `:25-32` documents the fake `claude`/`codex`/`copilot`/`agent` backends the suite drives.
- `scripts/tests/test-lint-ratchet.sh:3-74` — 72 declared smoke subjects (`:2` is `smoke-order`, not a subject): 10 under `scripts/lint-ratchet/`, 10 under `tools/lint-ratchet/src/{kernel,governance,git-rail}/` and `tools/lint-ratchet/test/support/`, 23 merge-driver, installer and post-merge scripts under `scripts/git/`, three `.husky/` hooks (`post-checkout`, `post-merge`, `post-commit`), helpers in `scripts/lib/`, `scripts/harness/`, `scripts/fixtures/` and `scripts/tests/lib/`, two `docs/guides/` pages, `packages/shared/src/schemas/harness-diagnostics.ts`, and repo-root config: `.gitattributes`, `eslint.config.js`, `eslint-config/`, `eslint-rules/`, `package.json`, `tsconfig.scripts.json`, `lint-ratchet.baseline.json`.
- `scripts/ai-hooks/test.sh` delegates nine already-extracted families — codex-wiring, copilot-wiring, tidy, lint-coverage, ratchet-regression, cache, session-state, stop-policy, protected-files-marker. The first eight carry an identical documented idiom: "Extracted to a focused script so this behavior family can also run on its own … stdout discarded so the aggregate keeps its single success line". Locate them with `rg -n 'SCRIPT_DIR/test-' scripts/ai-hooks/test.sh` (currently `:1733`, `:1864`, `:1870`, `:1876`, `:1882`, `:1888`, `:1894`, `:1900`, `:3840`). The protected-files-marker delegation at `:1728-1733` documents itself in its own words; copy the eight-family idiom, not that one.
- `scripts/ai-hooks/test.sh` — four behaviour families still in-file, ~2,150 lines: the `L8: heredoc bodies are data…` command-policy block (`:1174-1788`, including the heredoc-stripper-hardening and pre-hook work-root subsections), `backlog-note-lint hook` (`:1789-1858`), `L1: commit wrapper…` through `L7: shared commit-queue visibility` (`:2599-3834`), and `failure-guidance hook` (`:3842-4079`). This file moves every wave — re-derive the ranges with `rg -n '^# --- ' scripts/ai-hooks/test.sh` before extracting.
- `docs/agent_notes/finished_work/lint-extract-{cache,lint-coverage,ratchet-regression,stop-policy,tidy}-hook-tests.md` — the extraction program recorded as landed slices.
- `scripts/ai-hooks/test-stop-policy.sh:34-64` — the structural assertion described above; `:337`, `:381-418`, `:526-546`, `:691` — behavioural coverage of kill-switch, `MAX_NOTIFY` bounding and clean-state silence that **already exists** in the same file.
- Naming stutter, six files: `scripts/tests/test-test-all.sh`, `test-test-changed.sh`, `test-test-client.sh`, `test-test-dist-preflight.sh`, `test-test-scripts.sh`, `test-test-slow.sh`.
- `scripts/README.md:68-81` — documents the `scripts/tests/` convention (`test-<subject>.sh`, directory-based discovery, helpers in `scripts/tests/lib/`) and says nothing about the `scripts/ai-hooks/` colocation.
- `scripts/tests/test-ai-hooks.sh:9` declares the directory-prefix subject `scripts/ai-hooks/`, matched by prefix at `scripts/path-policy/path-policy-query-core.ts:126-130` and projected to `scripts/path-policy/path-policy-smoke-subjects-data.ts:157`. Editing any `scripts/ai-hooks/` file — including the ten colocated suites — therefore already selects the `test-ai-hooks` subject, which execs the aggregate `scripts/ai-hooks/test.sh`. The focused scripts have no individual subject and cannot be selected on their own; the generator only reads `# smoke-subjects:` headers from files directly under `scripts/tests/` (`scripts/path-policy/smoke-subject-headers.ts:7,31-35`), so they cannot get one without a `scripts/tests/` entry point. Compare `:123-124`, where `test-dependency-freshness` wires `.husky/pre-commit`/`post-commit` in by exact path.
- Cleanup obligations are **not** uniform, which constrains what the shared library may own: `scripts/tests/test-generate-harness-controls.sh:35-46` moves `docs/generated/harness-controls.md` aside and its `cleanup` must restore it before removing the sandbox; `scripts/tests/test-lint-ratchet.sh:4865-4888` composes an additional trap on top of the file-level one and then restores it; `scripts/tests/test-worktree-db.sh:368`, `:649`, `:895`, `:915` re-register the EXIT trap with a growing list of directories (and re-arm it 11 more times up to `:1804`, plus a `TERM INT` handler at `:919`); `scripts/tests/test-verify.sh:734-735` installs INT/TERM handlers mid-file and `:1121`/`:1160` installs then clears an EXIT trap around a live child process; `scripts/tests/test-test-scripts.sh:74-77` installs and then disarms INT/TERM. The common shape is "one temp root removed on EXIT" (`trap 'rm -rf "$SANDBOX"' EXIT`, ~35 files); the rest layer extra obligations on top.
- `scripts/ai-hooks/test-support.sh:3-7` — the header states the shared file is deliberately "scoped to test support only: pure helper functions with no hook fixtures or stateful setup". Any shared sandbox/trap machinery has to live outside that contract, not inside it.
- `scripts/README.md:74-76` — "Helper-only shell files belong in `scripts/tests/lib/`", so the placement for a new `scripts/tests/` library is already documented; `scripts/lib/` is described at `:61` as shared shell/TS helpers for *script families* (it is sourced by `scripts/verify.sh` and the hooks), not a home for test-only code.

## Proposed direction

Do steps 1-4 (the substrate) before any split. Splitting first multiplies the
boilerplate instead of retiring it.

1. **Extend the ai-hooks library to `scripts/tests/` — assertions only.** Add
   `scripts/tests/lib/test-assertions.sh` holding one definition of `fail()`,
   `ok()` and the pass-counter helpers, taking the assertion set verbatim from
   `scripts/ai-hooks/test-support.sh` rather than re-deriving it. Keep it pure:
   functions and nothing else, matching the contract
   `scripts/ai-hooks/test-support.sh:3-7` already states. To end up with one
   assertion definition shared across both test trees, have
   `scripts/ai-hooks/test-support.sh` source the new file and keep only its
   ai-hooks-specific shim builders locally. The `fail()` definitions in
   `scripts/slow-drift-audit.sh`, `scripts/ai-hooks/check-wiring.sh` and
   `examples/lint-ratchet-demo/smoke.sh` are production scripts, not test
   suites — leave them alone. Do **not** hoist test-only helpers into
   `scripts/lib/`, which is sourced by `scripts/verify.sh` and the hooks at
   runtime.

2. **Ship the sandbox as a composable helper, not a preamble.** Do not put
   `mktemp -d` plus a fixed `trap` into the shared library: suites have different
   restoration obligations (see the Evidence bullet on cleanup shapes), and a
   single canned preamble cannot express them. Instead provide, in a separate
   `scripts/tests/lib/test-sandbox.sh`, (a) `make_sandbox` which mktemps a
   directory and prints its path, and (b) a `register_cleanup <command>` registry
   whose single EXIT trap runs the registered commands in reverse order. That
   covers the ~35 plain `trap 'rm -rf "$SANDBOX"' EXIT` files by replacing the
   trap line, and lets the exceptions register their extra obligation (restore the
   moved generated doc; remove the decoy tree) instead of hand-rolling a composite
   trap. Leave suites that install INT/TERM traps or re-arm traps mid-file
   (`test-verify.sh`, `test-test-scripts.sh`, `test-worktree-db.sh`) on their own
   cleanup and say so in the library header; they are not migration targets.

3. **Share the git-fixture skeleton, not the whole `new_repo()`.** The 15 copies
   differ in their dependency closure, their root directory and even whether they
   run `git init` (see the Evidence bullet), so folding them into one function
   will not work. Extract only the invariant part into `scripts/tests/lib/`
   alongside `test-git-env.sh`: an `init_fixture_repo <dir>` that runs
   `git init -q -b main`, sets the test identity, and a `commit_fixture_base <dir>`
   that stages and commits. Each suite keeps its own `new_repo()` wrapper holding
   its `cp` closure. `test-slow-drift-audit.sh` builds no git repo and is not a
   caller.

4. **Migrate suites in reviewable batches** (say 8-10 files per commit), deleting
   the local preamble as each file starts sourcing the library. Verify each
   touched suite with `bash scripts/tests/<file>.sh`, and run `bun run test:scripts`
   before the batch lands. Do **not** use `bun run test:scripts:file` — that is the
   Vitest `scripts`-project runner (`package.json:57`), it does not accept `.sh`
   paths, and with `--passWithNoTests` it exits 0 having run nothing. Shell smokes
   are discovered and run by `scripts/test-scripts.sh`.

5. **Split the hook cases out of `test-dependency-freshness.sh`.** This leaf owns
   the extraction, the `scripts/tests/test-pre-commit.sh` filename, and the
   smoke-subject regeneration that goes with it. It belongs here because the new
   suite has to source the assertion, sandbox and git-fixture libraries that
   steps 1-3 build, and because the helpers it needs land in `scripts/tests/lib/`
   — both this leaf's surfaces. It also keeps a 2,100-line test relocation off
   the branch that later rewrites the commit gate itself, which is the highest-risk
   change in the pack.

   **The boundary is `:271`, not `:1521`.** Move everything from the `hook_repo`
   fixture at `:271` through the end of the file (`:2386`) into
   `scripts/tests/test-pre-commit.sh`; leave `:204-269`, the freshness-library
   cases, behind. Re-derive it before cutting with
   `rg -n 'sh \.husky/pre-commit' scripts/tests/test-dependency-freshness.sh` —
   the first execution is `:296` — and confirm with
   `rg -n '^hook_repo=' scripts/tests/test-dependency-freshness.sh` that the
   nearest preceding fixture assignment is `hook_repo` at `:271`. Ignore the
   `# smoke-subjects:` headers at `:19-20` and the `copy_precommit_fixture`
   copies at `:115-116`; they precede the boundary and are relocated separately
   by the header and helper-hoist instructions below. Do not cut on the
   `# ---` headers: there are nine in the file, the eight from `:1521` on cover
   24 of the 61 `.husky/pre-commit` referencing lines, and cutting there strands
   more than half the gate coverage in a suite named after a different script —
   the defect this step exists to fix.

   **The fast-commit and post-commit-provenance cases go in the same file**, not a
   third one. They exercise the pre-commit gate and its `post-commit` finalizer as
   one flow — `:1888-1930` runs both hooks against a single fixture — and they
   share `copy_precommit_fixture`, `init_bridge_repo` and
   `seed_prior_verify_evidence` with the plain gate cases. Do not sub-divide the
   moved cases by topic in the same commit either; the relocation has to stay
   reviewable as a pure move.

   Hoist the seven hook-only helpers at `:72-202` into `scripts/tests/lib/` so
   both files source them, leave `assert_status` (`:80`) with the freshness cases,
   and rewrite the `:23` docstring on what remains.

   Move the `# smoke-subjects:` headers with the cases: `.husky/pre-commit` and
   `.husky/post-commit` (`:19-20`), plus every other declared subject whose only
   coverage is inside the moved block. `scripts/prisma-client-freshness.sh` (`:4`)
   and `scripts/doc-length-policy.sh` (`:5`) are two of those — they appear only
   as fixture copies and never in a direct case. Test each remaining header the
   same way before deciding where it lands.
   `scripts/dependency-freshness.sh` (`:3`) stays.
   `scripts/tests/lib/test-git-env.sh` (`:21`) — its only consumers are the
   `:36-37` calls that exist for the hook fixtures; the freshness cases at
   `:204-269` run no git. Move the subject and the `:29` source to
   `scripts/tests/test-pre-commit.sh`, and drop both from the remainder unless a
   surviving freshness case shells out to git. Give the new file its own
   `# smoke-order:` value. `scripts/path-policy/path-policy-smoke-subjects-data.ts`
   and `scripts/fixtures/test-scripts/all-smoke-tests.txt` are generated — do not
   hand-edit them; regenerate with `bun run test:scripts:subjects` and commit both.
   Finish with `bun run harness:check`.

6. **Continue the ai-hooks extraction** for the remaining ~2,150 in-file lines of
   `scripts/ai-hooks/test.sh`, one family per commit, copying the existing
   delegation idiom exactly: the `L8` command-policy block, `backlog-note-lint`,
   the `L1` commit-wrapper/worktree/`L7` commit-queue block, and
   `failure-guidance`/output-filter. Re-derive the boundaries with
   `rg -n '^# --- ' scripts/ai-hooks/test.sh` rather than trusting any recorded
   range; they are `:1174-1788`, `:1789-1858`, `:2599-3834` and `:3842-4079`
   today and the file moves every wave. No smoke-subject bookkeeping is
   needed per extracted script: `scripts/tests/test-ai-hooks.sh:9` declares
   `# smoke-subjects: scripts/ai-hooks/`, a directory prefix, so each new
   `scripts/ai-hooks/test-*.sh` is already selected in changed mode. Only if step 9
   decides the focused suites should be individually selectable does each need its
   own `scripts/tests/` entry point plus a `bun run harness:check` regeneration.

7. **Rework the Stop-policy structural assertion** at
   `scripts/ai-hooks/test-stop-policy.sh:34-64`. **Keep the `declare -F`
   discovery step.** Replace only the `declare -f` body greps: drive each
   discovered `ai_stop_*_status` reporter through a per-family state fixture and
   assert the observable sequence — silence on a clean state, emission on a
   failing state, bounded repetition up to `MAX_NOTIFY`, suppression past it, and
   silence under the kill switch.

8. **Split the two 5,000-line suites**, `test-skill-dispatch-wrappers.sh` and
   `test-lint-ratchet.sh`, along their declared subject groups. For the first, the
   generated block's destination is the single-valued `smokeTest` field at
   `harness.controls.json:2739` — one path per skill. Splitting the suite means
   either widening that field to a list (and teaching `addSmokeSubjects` in
   `scripts/harness/skill-artifact-projection.ts:117-127` to route each subject to
   the right file) or splitting the `agent-cli` skill declaration itself.
   `renderSkillSmokeSubjectBlock` (`scripts/harness/skill-smoke-subject-block.ts:34-48`)
   already inserts a block into a declared file that lacks one, via
   `insertGeneratedBlock` (`:27-31`), so the new files need no hand-written header. Re-run `bun run harness:skills:refresh` and then
   `bun run harness:check`.

9. **Settle the naming.** Either rename the six `test-test-*.sh` files (e.g.
   `test-runner-all.sh`) or leave them and document why, and in the same commit
   add a paragraph to `scripts/README.md:68-81` recording that `scripts/ai-hooks/`
   holds ten colocated shell suites plus `test-support.sh`, why they live there,
   and whether the aggregate-only `scripts/ai-hooks/` directory subject is the
   granularity the repo wants for changed-mode selection.

## Scope / caveats

- **Do not write a new assertion library from scratch.**
  `scripts/ai-hooks/test-support.sh` (86 lines, sourced by all ten ai-hooks
  suites) is already that library. Diverging from its
  `fail()`/`assert_contains`/`assert_hook_json` shape would leave the repo with
  two incompatible mini-frameworks, which is worse than the status quo.
- **Do not put stateful setup into the shared assertion file.**
  `scripts/ai-hooks/test-support.sh:3-7` explicitly reserves that file for "pure
  helper functions with no hook fixtures or stateful setup". A canned `mktemp -d`
  plus fixed `trap` preamble also cannot express the suites' differing cleanup
  obligations (restoring a moved generated doc, composing an extra trap around a
  decoy tree, re-arming EXIT with a growing directory list, installing INT/TERM
  handlers mid-file — see the Evidence bullet). Step 2's `register_cleanup`
  registry exists so the exceptions can extend the sandbox teardown; suites that
  re-arm signal traps stay on their own cleanup. If the registry turns out not to
  cover the ~35 plain cases cleanly, ship step 1 alone — the assertion dedup is
  the larger win and does not depend on step 2.
- **Do not "make `test.sh` a coordinator" — it already is one.** Nine families are
  extracted, eight of them carrying an identical explanatory comment, and the
  `docs/agent_notes/finished_work/lint-extract-*` notes record the program. Step 6
  is continuing a documented in-flight refactor; copy the existing idiom
  (including discarding stdout so the aggregate keeps its single success line)
  rather than inventing a delegation style.
- **Do not replace the Stop-policy structural test with a flat table-driven
  fixture.** Every behaviour that test's grep assertions pin is *already* covered
  behaviourally in the same file (`:337`, `:381-418`, `:526-546`, `:691`). Its one
  unique contribution is auto-discovery: a newly added `ai_stop_*_status` reporter
  that forgets loop protection is caught today because the assertion enumerates
  reporters at runtime. A hand-listed table silently drops that net, which is a
  net loss even though the test itself gets less brittle.
- **The generated block at `test-skill-dispatch-wrappers.sh:3-23` cannot be
  cut-and-pasted.** It is regenerated by `bun run harness:skills:refresh`; a split
  that hand-edits it will be reverted by the next refresh. This is the constraint
  that makes step 8 medium rather than small effort.
- **`scripts/path-policy/path-policy-smoke-subjects-data.ts` and
  `scripts/fixtures/test-scripts/all-smoke-tests.txt` are generated.** Change the
  `# smoke-subjects:`/`# smoke-order:` headers in the owning `scripts/tests/test-*.sh`
  and run `bun run test:scripts:subjects`, committing both generated files. A hand
  edit to either is rejected by the freshness check.
- **Do not justify the split as "the two largest files in the repo"** — they are
  the two largest *shell/code* files. Four seed-data JSON files and the SRD PDF are
  larger (`packages/server/src/seed/data/5e-srd-monsters.json` is 22,876 lines).
- **The `.allow-protected-edits` race is fixed — do not reintroduce it.** The
  ai-hooks suites used to share the checkout's repo-root marker;
  `scripts/ai-hooks/test-protected-files-marker.sh` now evaluates that policy
  against a private probe root under `$TMP_ROOT`, using the `REPO_ROOT` override
  honored by `policy.sh` and `protected-files.sh`. New extractions must stay on
  per-suite `mktemp` roots: that file's tripwires (`:301-317` static marker-path
  check, `:325-330` write/remove check, `:332-377` parallel run plus marker
  watcher) scan every `scripts/ai-hooks/test*.sh` and fail the suite if a new file
  builds a marker path from the checkout root.
- Step 9's rename is the lowest-value item here: it churns
  `scripts/path-policy/path-policy-smoke-subjects-data.ts`,
  `scripts/fixtures/test-scripts/all-smoke-tests.txt`, and every reference in
  docs. Documenting the two conventions is the cheap option and captures most of
  the benefit; take the rename only if it comes free with a split you are already
  doing.
- Everything in this leaf is test-only, so risk is low throughout — but the
  suites gate commits, so a broken split is felt immediately. Run
  `bun run harness:check` after any change to smoke-subject headers, generated
  harness surfaces, or hook wiring, per `AGENTS.md`; `docs/ai-harness.md` is the
  background reading.
- **This is XL and should probably be scheduled as two leaves.** Steps 1-4 are a
  prerequisite for getting real value out of 5, 6 and 8, but 7 and 9 are
  independent and can be taken in any order. Step 7 is a different concern
  entirely (test technique, not substrate size), and steps 8-9 need nothing from
  here beyond the substrate. Splitting 7 and 8-9 into their own leaf is the way to
  get the remainder — substrate plus the two extractions — down to a schedulable
  size, and it is the split to reach for first.
- **Sequencing with leaf 32.** This leaf owns the pre-commit test extraction and
  the `scripts/tests/test-pre-commit.sh` name; leaf 32 (git hook shims) states the
  dependency in one line and carries no second plan. Do not create a second suite
  under any other name, `test-precommit-hook.sh` included. Order: land steps 1-4
  (the substrate) first so the new file sources the shared library instead of
  copying a 40-line preamble, then step 5, and only then leaf 32's step 4
  `.husky/pre-commit` body split, which needs the gate's assertions already filed
  under their own name. Land step 5's regenerated subject data before leaf 31
  reworks smoke-subject discovery in
  `scripts/path-policy/path-policy-smoke-subjects.ts`, or the two changes will be
  debugged together.
- No other sequencing dependency on leaves in this pack.
