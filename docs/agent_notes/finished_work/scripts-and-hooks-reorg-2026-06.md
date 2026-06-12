# Scripts & AI-Hooks Reorganization Plan (2026-06)

Status: COMPLETE — Phases 0-5 landed on
`feat/scripts-hooks-reorg-impl`. Phase 2's Codex apply_patch wiring defect
called out in the review note below was fixed in `6321b70e`; Phase 3 landed in
`7609d6ea`; Phase 4 landed in `cd26687f` plus stale-reference cleanups
`5d38e7c7`/`fd99d3ed`; Phase 5 added `scripts/README.md`, updated
`docs/ai-harness.md`, and moved this note to `finished_work/`. The durable
contract is now in `scripts/README.md`; this file remains as the rationale and
handoff history for the reorg.

## Context

Two independent reviews (Claude, Codex CLI) of `scripts/` and the
`.claude`/`.codex` hook layer converged on the same findings:

- The core architecture is sound: shared hook logic in `scripts/ai-hooks/`
  with harness adapters, and subdir facades (`code-intel.ts`, `drift-ai.ts`,
  `lint-ratchet.ts`). Do not restructure those.
- `scripts/` top level is a 139-file flat namespace. `package.json` currently
  references 44 script files in total, only 36 of them directly at `scripts/`
  top level. The `lint-ratchet-*.ts` (22), `logs-audit-*.ts` (5),
  `path-policy*` (6), and most `harness-*` files are internal modules, not
  package entrypoints (verified against `package.json`).
- `scripts/verify.sh` and `.husky/pre-commit` hand-maintain the same step
  set; `harness-wrapper-slot-parity.ts` exists only to check the copies agree
  with root `harness.controls.json` `slots` entries. Parity-checking two copies
  should become consumption of one source.
- Three Claude adapters (`bun-run-quiet.sh` 249 lines,
  `git-commit-quiet.sh` 156, `no-direct-db.sh` 26) still own harness-side
  orchestration that belongs in `scripts/ai-hooks/` executables or shared
  helpers. Some core logic is already shared (`policy.sh`, `cache.sh`,
  `commit-output.sh`), so the move should preserve harness-specific payload
  translation at the edge rather than duplicating it.
- Codex lacks `protected-files`, `doc-length`, `prisma-generate` wiring even
  though those bodies already live in `scripts/ai-hooks/` and Claude only has
  5-line shims. Nothing records which remaining harness gaps are deliberate.

Explicit non-goals (decided during review, do not relitigate without cause):

- No shell-to-TypeScript rewrite of `policy.sh` / `cache.sh` /
  `stop-policy.sh` — ~3.4k lines of tests encode hard-won behavior. New
  contract logic may go in TS; existing shell stays.
- No restructuring of `codemods/` (fixture-heavy by design), `drift-ai/`,
  `code-intel/`, or the facade pattern.
- No `scripts/bin/` move of script entrypoints; the rule is "top level =
  entrypoints only", enforced by docs + review, not relocation.

## Phase 0 — Trivial cleanups (any time, single commit each)

1. Point the scripts Vitest cache out of `scripts/node_modules/`: set
   `cacheDir` in `scripts/vitest.config.ts` (e.g. root
   `node_modules/.cache/vitest-scripts`), delete `scripts/node_modules/`
   (gitignored Vite cache only — verified).
2. Merge the remaining legacy fixture roots into owner-specific subdirs under
   `scripts/fixtures/`: `scripts/test-fixtures/lint-ratchet/` (2 files) and
   `scripts/__fixtures__/` (2 files). Keep existing
   `scripts/fixtures/generate-*` directories as precedent and update the
   referencing tests.

Verify: `bun run test:scripts` + scripts vitest suite.

## Phase 1 — Single verify step definition (highest value)

Goal: `scripts/verify.sh` and `.husky/pre-commit` consume one manifest-backed
step definition instead of hand-writing two. This should increase the checked
surface, not just deduplicate shell: today's parity check sees only slot
name + `bun run` script, so args/env/conditional behavior can drift invisibly.

Layout decision (2026-06-10, resolves the question parked at Phase 4 item 3):
the new internal files are born in a new `scripts/verify/` directory; no
existing file moves. The top-level `verify*.sh` files are all `package.json`
entrypoints (`verify`, `verify:async:*`, `verify:history`, `verify:logs`) and
stay top-level per the Phase 5 contract, matching the existing facade
precedent (`code-intel.ts` + `scripts/code-intel/`, `drift-ai.ts` +
`scripts/drift-ai/`). `verify-metadata.sh`, `parallel-runner.sh`, and
`parallel-step.sh` are shared infrastructure (sourced by the lint wrappers
and `ai-hooks/cache.sh`), not verify-owned, so grouping them is a separate
Phase 4 question. Cost pulled forward into Phase 1: this is the first `.sh`
family subdir, so `lint-shell.sh` discovery, path-policy classification, and
the smoke-subject lists must handle `scripts/verify/*.sh` paths now rather
than in Phase 4.

Source of truth: the `slots` arrays already present on the relevant root
`harness.controls.json` entries (kind `hook` / `verify-wrapper`). Current
verify/pre-commit slots are: `lint`, `ratchet`, `zero-baseline`,
`coverage-map`, `format-check`, `typecheck`, `test`, and `scripts`. The
per-mode script variants are already represented by separate control entries
(`verify-wrapper/verify`, `verify-wrapper/verify-changed`,
`verify-wrapper/verify-parallel`, `hook/pre-commit`), so no mode-keyed slot
schema is needed. Extend the slot shape only to cover today's lossy parts:

- env wrappers (`HARNESS_DIAGNOSTICS_OUTPUT=...` on ratchet)
- extra args (coverage-map `-- --staged`, test timings reporters,
  pre-commit's `MUSI_CAPTURE_TEST_TIMINGS` toggle)
- conditional steps (pre-commit's staged-script classification gating
  `test:scripts:changed`, plus the `MUSI_SCRIPTS_CHANGED_FILES` /
  `MUSI_SCRIPTS_DELETED_FILES` env injection when classification succeeds)

Design decision: use declarative command data plus named dynamic resolvers, not
a JSON shell-semantics DSL and not generator-emitted policy branches.

- Slot shape becomes `{name, script, args?, env?, dynamic?, condition?}`.
  `condition` stays human-readable documentation. `dynamic` is the
  machine-readable escape hatch and must validate against an allow-list of
  resolver ids/functions.
- `args` and `env` are shell-array data. Env/arg values may reference runtime
  wrapper variables such as `$LOG_DIR` and `$TIMINGS_FILE` because the generated
  file is sourced after the wrapper initializes them. The generated header must
  document this contract and fail loudly with `: "${LOG_DIR:?}"`-style guards
  for required runtime variables.
- Dynamic behavior lives in a small static shell library,
  `scripts/verify/steps-lib.sh`. A single resolver contract,
  `musi_resolve_slot_cmd <consumer> <slot>`, populates a resolved command array
  and returns either success or a distinguished "skip this slot" rc. Do not
  return raw command strings or require `eval`.
- Dynamic resolvers reuse generated base command arrays; they should branch
  only on behavior. The generated manifest data remains the source of the
  underlying `bun run` script, args, and default env.
- Initial dynamic cases are limited to the two current conditionals: the
  pre-commit `MUSI_CAPTURE_TEST_TIMINGS=1` reporter toggle, and the staged
  script classifier. For the classifier, rc 0 injects
  `MUSI_SCRIPTS_CHANGED_FILES` / `MUSI_SCRIPTS_DELETED_FILES`, rc 1 runs the
  base `test:scripts:changed` command, and rc 2 preserves the current consumer
  asymmetry: pre-commit skips the slot, while `verify:changed` runs the base
  command. Full and parallel verify run `test:scripts` unconditionally.

Mechanism: a generator (extend `generate-harness-controls.ts` or a sibling
`generate-verify-steps.ts`) emits a checked-in
`scripts/verify/steps.generated.sh` defining the `*_CMD` arrays, per-step
metadata, and ordered step list per consumer. `verify.sh` and
`.husky/pre-commit` source it plus the static resolver library and keep only
orchestration (locks, watchdog, source-relevant preflight, pre-commit's
advisory warn steps for lockfile/schema/doc-length, marker bridge, meta
breadcrumbs, summary). Do NOT generate at hook runtime — generate at dev time,
enforce freshness with a `--check` mode wired where the parity check runs today
(`harness-check-validation.ts`, exercised by `test-harness-check.sh`).

TDD: write generator unit tests first (fixture manifest → expected generated
shell). Include fixture cases for the classifier rc 2 asymmetry and the
pre-commit test-timings toggle, because those fail first if the schema is too
naive. The existing `test-verify*.sh` smoke tests cover the wrappers.

Risk: breaking pre-commit blocks all commits. Mitigation: run both wrappers
standalone against env-overridden state dirs (`MUSI_VERIFY_*`) before
committing. Landing order:

1. Schema + generator + generated file, with fixture tests, while the wrappers
   still use the current hand-written commands.
2. Switch both consumers to the generated data/resolver path AND wire the
   freshness `--check` into `harness:check` in the same commit. The old parity
   machinery cannot bridge this step: `harness-wrapper-slot-parser.ts`
   regex-parses the literal `*_CMD=(...)` assignments inside the wrappers'
   `case "$MODE"` block, so it breaks the moment the command definitions move
   into the sourced generated file. Same commit, no gap.
3. Delete `harness-wrapper-slot-parity.ts`, `harness-wrapper-slot-parser.ts`,
   and the parser-specific harness-check coverage (pure deletion; the
   freshness check from step 2 already covers the surface).

Smoke-subject bookkeeping (`scripts/path-policy-smoke-subjects.ts`,
`SCRIPT_SMOKE_SUBJECTS`) — Phase 1 touches path-policy files even though
moves wait for Phase 4:

- Add `verify/steps.generated.sh` and `verify/steps-lib.sh` to the
  `test-verify*` and harness-check subject lists in the same commit that the
  consumers start sourcing them, or edits to step definitions will not
  trigger the verify smoke tests under `test:scripts:changed` — exactly the
  silent-drift class this phase exists to close.
- Step 3's deletion must also drop the parser/parity files from the subject
  lists where they appear today.

## Phase 2 — Thin the thick Claude adapters; close cheap test gaps

1. Move the remaining bodies of `.claude/hooks/bun-run-quiet.sh`,
   `git-commit-quiet.sh`, and `no-direct-db.sh` into `scripts/ai-hooks/`
   executables or shared helpers (pattern: existing
   `scripts/ai-hooks/tidy-edited-file.sh`). Adapters shrink to repo-root
   resolution + exec where possible. Payload-shape translation and Claude-only
   response shaping are the only logic allowed to remain adapter-side.
2. Extend the `ai-hooks` test suite (`scripts/ai-hooks/test.sh` family) to
   cover the moved logic where feasible: bun-command classification,
   background-block, lock-deny paths, and commit summary dispatch. Much is
   already covered via
   `policy.sh`/`cache.sh`/`commit-output.sh` and the current aggregate hook
   tests; add seams for behavior that today is only exercised through the
   thick Claude adapters.
3. Expand focused tests for the already-shared `prisma-generate.sh`,
   `protected-files.sh`, and `doc-length.sh` paths while wiring them into
   Codex. Current coverage exists in `scripts/ai-hooks/test.sh`; the missing
   part is parity across harness payload shapes and state overrides.
4. While in `prisma-generate.sh`, replace the hardcoded
   `/tmp/musi-prisma-generate.*` paths with env-keyed defaults matching the
   rest of `cache.sh`.
5. Wire `protected-files`, `doc-length`, and `prisma-generate` shims into
   `.codex/hooks.json` (decision made: these gaps were accidental). The
   quiet-wrapper family and `no-direct-db` remain Claude-only deliberately
   (Codex's aggregator model handles Bash policy via `pre-tool-use.sh`).

Process gotcha: `protected-files.sh` only advises today, but this phase edits
policy-bearing hook files. Treat `.claude/hooks/`, `.codex/hooks/`, and
`scripts/ai-hooks/` changes as review-sensitive even if the local harness does
not hard-block the edit.

Verify: `bash scripts/ai-hooks/test.sh`, `bash scripts/test-ai-hooks.sh`,
plus a manual session exercising one wrapped `bun run` and one commit.

### Review note (2026-06-10, post-Phase-2, branch review at `c7ee8c5e`)

Items 1, 2, and 4 verified done (the three body moves are byte-for-byte
identical from the payload read onward, with only the
`HOOK_LIB`-via-`BASH_SOURCE` / `git -C` header resolution changed;
prisma state paths are env-keyed and test-covered). All suites green:
`scripts/ai-hooks/test.sh`, `scripts/test-ai-hooks.sh`, `harness:check`,
full `test:scripts`.

**DEFECT (RESOLVED in `6321b70e`) — the item-5 Codex wiring was inert.** The three new shims
(`.codex/hooks/{prisma-generate,doc-length,protected-files}.sh`, commit
`3ccc3d75`) exec shared bodies that extract the edited file via
`ai_payload_file_path` (`.tool_input.file_path`). Codex `apply_patch`
payloads have no `file_path`; they carry the patch envelope in
`.tool_input.command` with `tool_name: "apply_patch"` (see the
`scripts/ai-hooks/edited-paths.sh` header). So under Codex all three
hooks read an empty path and emit `{"continue":true}` unconditionally —
verified empirically by piping an `*** Update File:
packages/server/prisma/schema.prisma` envelope through
`.codex/hooks/protected-files.sh`. The "accidental Codex gap" this chunk
claimed to close is still open, now hidden behind wiring that looks
closed. Claude behavior is unaffected (`Edit|Write` payloads do carry
`file_path`). This is exactly the "parity across harness payload shapes"
test coverage item 3 called for and the part that was not done.

Fix (small, pattern exists in-repo): in the three bodies, source
`edited-paths.sh` after `common.sh` and iterate
`ai_edited_payload_paths` — precedent `lint-coverage-check.sh:162` and
`ratchet-regression-check.sh:149`, the two bodies whose Codex wiring
predates this phase and works.
- `prisma-generate.sh`: trigger when ANY edited path matches
  `*/prisma/schema.prisma` (relative patch paths still match the glob).
- `doc-length.sh` / `protected-files.sh`: today they emit-and-exit on the
  first file; aggregate advisories across all edited paths into one
  `additionalContext` message (follow `lint-coverage-check.sh`).
- Add a Codex-payload-shape test per body to `scripts/ai-hooks/test.sh`
  (an `apply_patch` envelope piped through each `.codex/hooks/` shim; the
  schema.prisma protected-files case above is a ready-made fixture).

Minor observations from the same review (no action required now):
- Hook order differs between harnesses for the shared PostToolUse bodies
  (Claude: prisma, doc-length, tidy, lint-coverage, ratchet; Codex: tidy,
  lint-coverage, ratchet, prisma, doc-length). Harmless today, but
  Phase 3's generator must pick one canonical order — expect one side's
  wiring to be reordered in the first generated commit.
- Nothing automated validates `.codex/hooks.json` (valid JSON, referenced
  files exist, shims executable) until Phase 3's `--check`/smoke lands;
  the three new shims currently have zero test coverage as files.
- The full header comments on `.claude/hooks/{bun-run-quiet,git-commit-quiet}.sh`
  are duplicated verbatim in their `scripts/ai-hooks/` bodies — drift
  risk. Phase 5 can declare the body canonical and shrink adapter headers
  to one line.
- `scripts/ai-hooks/` now mixes harness-neutral bodies with deliberately
  Claude-only ones (`bun-run-quiet`, `git-commit-quiet`, `no-direct-db`
  emit Claude-specific `updatedInput` shapes). Phase 5's
  `scripts/README.md` should record which bodies are safe to wire into
  Codex so nobody closes a "gap" that is intentional.

## Phase 3 — Generate hook wiring from the controls manifest

Depends on Phase 2 (hook set stabilized).

1. Extend `harness.controls.json` hook entries with wiring fields:
   `event`, `matcher`, `timeout`, `harnesses: ["claude", "codex"]`, and any
   harness-specific command/status-message text needed for generated config.
2. Generator emits the `hooks` key of `.claude/settings.json` and the whole
   `.codex/hooks.json`. For `settings.json` (which also holds permissions,
   env, plugins) do a targeted in-place replacement of the `hooks` key only,
   with a `--check` freshness mode wired into `harness-check`.
3. Per-harness flags in the manifest now *are* the documentation of
   deliberate gaps; add one line per intentional omission in the entry's
   `principle` or a dedicated omission field rendered into
   `docs/generated/harness-controls.md`.

Risk: malformed `settings.json` disables the safety hooks silently. The
`--check` mode plus a smoke test that parses both emitted files
(`jq empty`) and asserts every referenced hook file exists guards this.

Note: the in-place `hooks`-key replacement will likely reformat the whole
`settings.json` on the generator's first run; expect (and tell reviewers to
expect) formatting churn in that first generated commit.

### Phase 3 completion note (2026-06-10, `7609d6ea`)

Done. The manifest is now the single source of truth for hook wiring;
`scripts/generate-hook-wiring.ts` (+ `scripts/hook-wiring-schema.ts`) emits
the `.claude/settings.json` `hooks` key (targeted in-place) and the whole
`.codex/hooks.json`, with a `--check` mode wired into `harness:check`
alongside the verify-steps freshness check (the Phase 1 helper was
generalized to `checkGeneratedFreshness`).

Outcome vs. the note above: the targeted replacement produced **zero**
churn in `settings.json` — it was byte-for-byte unchanged and is absent from
the commit diff, so the anticipated reformatting did not occur. Only
`.codex/hooks.json` changed, and only by the deliberate reorder.

Canonical shared `PostToolUse` order (applied to both harnesses, following
Claude's existing order): `prisma-generate` → `doc-length` →
`tidy-edited-file` → `lint-coverage-check` → `ratchet-regression-check`.
Codex's apply_patch group was reordered to match; that single reorder is the
only `.codex/hooks.json` change.

Deliberate per-harness gaps are modeled in the manifest and **enforced**: the
schema rejects any control that omits a harness without a `notes.<harness>`
explanation, and those explanations render into
`docs/generated/harness-controls.md` as "deliberately not wired: …". Modeled
gaps: Claude-only `no-direct-db`/`git-commit-quiet`/`bun-run-quiet` (Codex
folds these into its PreToolUse/PostToolUse Bash aggregators); Codex-only
`codex-pre-tool-use`/`codex-post-tool-use` aggregators (Claude uses direct
Bash adapters).

Safety guard (the malformed-`settings.json` risk above): the ai-hooks smoke
test now `jq empty`s both generated files and, for every `command` it finds
(both the `$CLAUDE_PROJECT_DIR` and `$(git rev-parse)` shapes), asserts the
referenced hook file exists and is executable — failing on any unrecognized
command shape rather than skipping it.

Verified green: `bun run harness:check`, `generate-hook-wiring --check`
(idempotent regen, zero diff), `jq empty` both files, `bash
scripts/test-ai-hooks.sh`, `scripts/generate-hook-wiring.test.ts`,
`test-harness-check.sh` (new `stale-hook-wiring` failure case),
`test-generate-harness-controls.sh`, `test-test-scripts.sh`, and the
`harness-controls.md` doc `--check`.

## Phase 4 — Mechanical file moves (last; pure churn)

1. Helper modules into family subdirs, keeping only `package.json`-referenced
   facades at top level:
   - `lint-ratchet-*.ts` + `.test.ts` → `scripts/lint-ratchet/`
   - `logs-audit-*.ts` + tests → `scripts/logs-audit/`
   - `path-policy*` → `scripts/path-policy/`
   - `harness-*` helpers (not `harness-audit.ts`/`harness-check.ts` facades,
     and not `harness-emit-envelope.ts` unless its import graph is moved too)
     → `scripts/harness/`
   Update relative imports (mechanical; `bun run code:intel -- dependents`
   to enumerate, typecheck to verify) and `scripts/vitest.config.ts` globs.
2. Smoke wrappers `test-*.sh` → `scripts/tests/`, switching
   `test-scripts.sh` discovery from path-policy metadata to a directory glob
   after preserving changed-test selection behavior. Replace the
   `scriptSmoke.names` registry in `path-policy.ts` (consumed by
   `path-policy-query-core.ts` / `path-policy-smoke-subjects.ts`) with a
   directory-derived list. Update path-policy classification rules + tests
   for the new paths — pre-commit's changed-file classification depends on
   them, so this is the one move with behavior attached.
3. RESOLVED 2026-06-10 (see Phase 1 layout decision): there is no verify
   family to move. The top-level `verify*.sh` files are all `package.json`
   entrypoints and stay put; Phase 1's new internal files are born in
   `scripts/verify/`. The remaining question here is different and
   separable: whether the shared sourced helpers (`verify-metadata.sh`,
   `parallel-runner.sh`, `parallel-step.sh` — used by the lint wrappers and
   `ai-hooks/cache.sh`, not verify-owned) get a `scripts/lib/`-style home or
   stay top-level. Decide that here, with the other mechanical moves.

Verify: full `bun run verify` + `bun run test:scripts` (not just
`:changed`) since discovery itself changed.

### Phase 4 completion note (2026-06-10, `cd26687f` + `5d38e7c7` + `fd99d3ed`)

Done. All three sub-items landed:

- Families moved into `scripts/{lint-ratchet,logs-audit,path-policy,harness}/`;
  facades (`harness-audit.ts`, `harness-check.ts`, `harness-emit-envelope.ts`,
  `lint-ratchet.ts`, `logs-audit.ts`) stayed top-level. Imports, vitest
  coverage globs, and `tsconfig.scripts.json` includes were repointed (glob
  forms like `scripts/lint-ratchet/**/*.ts`).
- Smokes moved to `scripts/tests/` (helper-only `test-git-env.sh` and the
  ratchet edit-check fixtures to `scripts/tests/lib/`). Discovery is now a
  directory model on BOTH sides: `test-scripts.sh`'s full-suite run globs
  `scripts/tests/test-*.sh` (`discover_smoke_tests`), and the TS
  `SCRIPT_SMOKE_TEST_NAMES` is derived from the same dir
  (`discoverScriptSmokeTestNames()`, subject-map order then extras, with a
  fallback). `--changed` selection stays subject-driven via the
  `script-smoke-tests` path-policy query, so changed-test selection and
  path-policy classification are behavior-preserved. The old
  `scriptSmoke.names` registry is gone.
- Shared sourced helpers (`verify-metadata.sh`, `parallel-runner.sh`,
  `parallel-step.sh`) → `scripts/lib/`; `.husky/pre-commit` and `verify.sh`
  source the new paths.

Executable verification (re-run independently, all green): `harness:check`,
`lint`, `typecheck`, and the FULL `test:scripts` (37 smokes, all OK — proves
glob discovery resolves every moved test). Relied on Codex's `bun run verify`
pass for the app-suite portion, which the script moves do not touch.

Known residue: full-run smoke discovery uses alphabetical directory order while
changed-mode ordering follows subject-map order; this is accepted because the
set is pinned by the parity test and ordering only affects parallel scheduling.

**Review finding — gate-invisible stale references.** Mechanical moves leave
references that NO lint/typecheck/test gate validates: prose path mentions in
docs and "covered by …" code comments. The move commit missed a batch of
these; the two follow-up commits swept and fixed them:
`5d38e7c7` repointed `docs/guides/{lint-ratchet,lint-ratchet-adoption,
biome-lint-adoption}.md` (flat `scripts/lint-ratchet-*.ts` →
`scripts/lint-ratchet/…`, `scripts/path-policy.ts` →
`scripts/path-policy/…`) plus two stale smoke-test comment headers;
`fd99d3ed` repointed `scripts/test-*.sh` smoke references (moved to
`scripts/tests/`) across in-code comments and prose in `docs/ai-harness.md`,
`docs/roadmap`, and the module/ratchet guides — guarding the
`test-scripts`/`test-changed`/`test-slow` facades that stayed top-level.
A repo-wide sweep across all moved families is now clean. **Lesson for future
moves: after a relocation, `rg` the whole tree (minus planning notes) for the
old flat paths and fix prose/comment refs — they will not fail any gate.**

## Phase 5 — Write the layout contract

`scripts/README.md` (precedent: `scripts/drift-ai/README.md`):

- the rule: top level = `package.json` entrypoints + facades; families live
  in subdirs; smoke tests in `scripts/tests/` named `test-<subject>.sh`
- generated files live beside the static library that interprets them, in
  the owning family's subdir (precedent: `scripts/verify/steps.generated.sh`
  + `steps-lib.sh`)
- the smoke-test convention for new scripts
- pointer to `docs/ai-harness.md` for hook architecture; update that doc's
  adapter section to reflect Phases 2-3 (thin adapters, generated wiring,
  manifest-documented gaps).

## Parked (backlog candidates, not scheduled)

- `AI_*` vs `MUSI_*` env prefix unification (needs back-compat fallback
  reads; touches operator muscle memory — low value until it bites).
- `.claude/skills` / `.codex/skills` drift (5 `playwright-cli` files +
  `ts-graph/SKILL.md` differ): either a sync-check smoke test or generation
  with per-harness overlays.
- `scripts/drift/` (locator-usage only) fold-in or rename — check history
  before touching.

## Sequencing summary

Phase 0 anytime; 1 and 2 independent of each other; 3 after 2; 4 after 1-3
(moves last to avoid rebase churn in the substantive diffs); 5 lands with or
immediately after 4. Worktree copies under `worktrees/` (e.g.
`worktrees/exploration/harness.controls.json`) are excluded from all
generators and moves.
