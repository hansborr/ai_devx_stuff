# Scripts & AI-Hooks Reorganization Plan (2026-06)

Status: PLANNED — no implementation started. Each phase is an independent
`feat/`/`fix(scripts)`/`refactor(scripts)` branch verified by
`bun run verify:changed` plus the phase-specific checks listed below.

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

Goal: `scripts/verify.sh` and `.husky/pre-commit` consume one declarative
step list instead of hand-writing two; delete the parity machinery.

Source of truth: the `slots` arrays already present on the relevant root
`harness.controls.json` entries (kind `hook` / `verify-wrapper`). Current
verify/pre-commit slots are: `lint`, `ratchet`, `zero-baseline`,
`coverage-map`, `format-check`, `typecheck`, `test`, and `scripts`. Extend the
slot shape as needed to cover today's real differences:

- per-mode script variants (`lint` vs `lint:changed`, `format:check` vs
  `format:changed:check`, `test` vs `test:changed`, etc.)
- env wrappers (`HARNESS_DIAGNOSTICS_OUTPUT=...` on ratchet)
- extra args (coverage-map `-- --staged`, test timings reporters,
  pre-commit's `MUSI_CAPTURE_TEST_TIMINGS` toggle)
- conditional steps (pre-commit's staged-script classification gating
  `test:scripts:changed`, plus the `MUSI_SCRIPTS_CHANGED_FILES` /
  `MUSI_SCRIPTS_DELETED_FILES` env injection when classification succeeds)

Mechanism: a generator (extend `generate-harness-controls.ts` or a sibling
`generate-verify-steps.ts`) emits a checked-in
`scripts/verify-steps.generated.sh` defining the `*_CMD` arrays, per-step
metadata, and ordered step list per mode. `verify.sh` and `.husky/pre-commit`
source it and keep only orchestration (locks, watchdog, source-relevant
preflight, marker bridge, meta breadcrumbs, summary). Do NOT generate at hook
runtime — generate at dev time, enforce freshness with a `--check` mode wired
where the parity check runs today (`harness-check-validation.ts`, exercised by
`test-harness-check.sh`).

Then delete `harness-wrapper-slot-parity.ts`,
`harness-wrapper-slot-parser.ts`, and the parser-specific harness-check
coverage; replace the `harness-check` validation with the freshness check.

TDD: write generator unit tests first (fixture manifest → expected generated
shell); the existing `test-verify*.sh` smoke tests cover the wrappers.

Risk: breaking pre-commit blocks all commits. Mitigation: run both wrappers
standalone against env-overridden state dirs (`MUSI_VERIFY_*`) before
committing; land generator + generated file first, switch consumers in a
second commit.

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
3. Optional, decide at implementation time: group the verify family
   (`verify*.sh`, `parallel-*.sh`) into `scripts/verify/` while touching it
   in Phase 1 instead, to avoid moving it twice.

Verify: full `bun run verify` + `bun run test:scripts` (not just
`:changed`) since discovery itself changed.

## Phase 5 — Write the layout contract

`scripts/README.md` (precedent: `scripts/drift-ai/README.md`):

- the rule: top level = `package.json` entrypoints + facades; families live
  in subdirs; smoke tests in `scripts/tests/` named `test-<subject>.sh`
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
