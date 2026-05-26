# Path Policy Inventory

Status: Done
Order: 13

## Context

Path and file-surface policy is duplicated across `lint-changed.sh`,
`lint-config-sensors.sh`, `lint-shell.sh`, pre-commit source relevance,
`verify-metadata.sh`, `lint-agent-changed.sh`, format scripts, and
script-smoke selection. These callers have different runtime semantics, so a
single shared classifier would be too easy to overfit.

## Scope

- Inventory the duplicated path policies and note the behavior each caller
  owns: staged/base/untracked/deletion handling, NUL safety, full-scan
  triggers, and output contract.
- Identify which parts are shared data versus caller-specific semantics.
- Produce a short implementation note for `14-path-policy-data-model.md`.

## Definition Of Done

The next task can build the shared data model without rediscovering caller
contracts.

## Verification

- Documentation-only verification with `bunx prettier --check --ignore-unknown`
  for edited markdown
- No code gate required unless scripts change

## Inventory

### `scripts/lint-changed.sh`

- Path/surface policy: ESLint changed-file surface is existing
  `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs`, `*.json`, and
  `*.jsonc` files. Lint-affecting full-scan triggers are `bun.lock`,
  `package.json`, `eslint.config.*`, `tsconfig*.json`, `.yamllint.yml`,
  `packages/*/package.json`, `packages/*/tsconfig*.json`, and
  `eslint-rules/*`. The caller also delegates shell and config surfaces to
  `lint-shell.sh` and `lint-config-sensors.sh`.
- Staged/base/untracked/deletions: resolves the base argument from local
  `main` or `origin/main` by default. It rejects source-relevant unstaged or
  untracked files through `musi_changed_gate_fail_if_unstaged`, then reads
  branch changes from `git diff "$BASE"...HEAD` and staged changes from
  `git diff --cached`, both with `--diff-filter=ACMRD`. Deletions can trigger a
  full scan when they match a full-scan trigger, but deleted lintable files are
  not passed to ESLint because the caller requires `[ -f "$f" ]`.
- NUL safety: changed-file collection uses `git diff -z` and
  `read -r -d ''`; selected files are stored in an array. The inherited
  unstaged/untracked rejection gate is newline-delimited.
- Full-scan triggers: missing base ref, or any staged/base path matching the
  lint-affecting trigger list. Full scan runs full ShellCheck, full config
  sensors, and `eslint .`.
- Output contract: emits a no-op message when no ESLint files are selected,
  otherwise prints the selected count and runs checks through
  `parallel-runner.sh`. It does not output a reusable file list; its contract is
  lint output plus an aggregated exit code.

### `scripts/lint-config-sensors.sh`

- Path/surface policy: workflow files are `.github/workflows/*.yml` and
  `.github/workflows/*.yaml` at max depth 1. Maintained YAML is
  `.yamllint.yml`, `docker-compose.yml`, `.devcontainer/docker-compose.yml`,
  those workflow files, and `.codex/skills/*/agents/openai.yaml` with one skill
  path segment. Maintained TOML is `bunfig.toml` and `.codex/config.toml`.
  Maintained Dockerfile is `.devcontainer/Dockerfile`; the local reference
  Dockerfile is `docs/refs/5e-database/Dockerfile`. Most surfaces exclude
  `node_modules`, `worktrees`, and `.playwright-cli`.
- Staged/base/untracked/deletions: in `--changed` mode it uses the shared
  unstaged/untracked rejection gate, resolves `main` then `origin/main`, and
  collects `"$BASE"...HEAD` plus staged paths with `--diff-filter=ACMRD`.
  Untracked source-relevant files are rejected rather than selected. Existing
  file checks skip deleted sensor inputs, but deleted or changed infra paths can
  still trigger the full sensor set.
- NUL safety: changed mode uses `git diff -z`; full mode uses
  `find ... -print0 | sort -z`; both are read with `read -r -d ''`. The
  inherited unstaged/untracked rejection gate is newline-delimited.
- Full-scan triggers: normal mode is always full. Changed mode falls back to
  full when the base ref is missing or when `package.json`, `bun.lock`,
  `.yamllint.yml`, or `scripts/lint-config-sensors.sh` appears in the changed
  set.
- Output contract: runs actionlint, yamllint, taplo, and hadolint only for
  non-empty selected arrays. It prints skip/count messages and exits with the
  first failing sensor under `set -e`, except actionlint aggregates per-file
  failures before returning.

### `scripts/lint-shell.sh`

- Path/surface policy: maintained shell files are `scripts/*.sh`,
  top-level `.husky/*`, top-level `.codex/hooks/*.sh`,
  top-level `.claude/hooks/*.sh`, and top-level `.devcontainer/*.sh`.
  Exclusions include `node_modules`, `worktrees`, `.playwright-cli`, and
  `.husky/_/*`.
- Staged/base/untracked/deletions: in `--changed` mode it rejects
  source-relevant unstaged or untracked files, resolves `main` then
  `origin/main`, and collects base plus staged paths with
  `--diff-filter=ACMRD`. Deletions are observed but skipped by the existing
  file check. Untracked files are rejected when source-relevant, not selected.
- NUL safety: changed mode uses `git diff -z`; full mode uses
  `find ... -print0 | sort -z`; both are read with `read -r -d ''`. The
  inherited unstaged/untracked rejection gate is newline-delimited.
- Full-scan triggers: normal mode is always full; changed mode falls back to
  the full maintained shell set only when the base ref is missing.
- Output contract: emits no-op or count messages, resolves a system
  `shellcheck` while avoiding a stale `node_modules/.bin/shellcheck`, then
  `exec`s ShellCheck with the selected file array. Exit code is ShellCheck's
  exit code or `1` when ShellCheck is unavailable.

### `.husky/pre-commit` Source Relevance

- Path/surface policy: staged source relevance is a grep regex over
  `.husky/`, `.claude/hooks/`, `.claude/settings.json`, `.codex/hooks/`,
  `.codex/hooks.json`, `.codex/config.toml`,
  `.codex/skills/[^/]+/agents/openai.yaml`, selected `.devcontainer` files,
  `.github/workflows/[^/]+.ya?ml`, `.playwright/cli.config.json`, `packages/`,
  `e2e/`, `scripts/`, `eslint-rules/`, root package/config files,
  `lint-ratchet.baseline.json`, `harness.controls.json`,
  `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`, and root
  `eslint`, `commitlint`, `stryker`, `knip`, `playwright`, `prisma`,
  `tsconfig`, and `vitest` config patterns.
- Staged/base/untracked/deletions: it first rejects source-relevant unstaged or
  untracked work through `musi_changed_gate_fail_if_unstaged`. Its source-skip
  decision then looks only at staged paths from
  `git diff --cached --name-only --diff-filter=ACMRD`; there is no base
  comparison in this section. Staged deletions are included so deletion-only
  source changes still run the gate.
- NUL safety: not NUL-safe; the staged source-skip check uses newline-delimited
  `git diff --name-only` piped to `grep -qE`.
- Full-scan triggers: this section does not run a full scan itself. A
  source-relevant staged path starts the changed verification slots; a fresh
  success marker can short-circuit the run.
- Output contract: exits `0` with a no-source-changes skip message when no
  staged source-relevant paths match. Otherwise it runs parallel verification
  slots, writes run metadata and success markers, and exits with the aggregate
  pre-commit result.

### `scripts/verify-metadata.sh`

- Path/surface policy: `musi_changed_gate_relevant_path` recognizes root
  package/config files, ratchet and harness metadata, selected agent and
  devcontainer config files, selected package-level package/tsconfig/vitest and
  Prisma configs, hook scripts, workflow YAML, `.codex/config.toml`,
  `.codex/skills/*/agents/openai.yaml`, and broad `.husky/*`, `packages/*`,
  `e2e/*`, `scripts/*`, and `eslint-rules/*` prefixes. Pre-commit
  fingerprinting broadens tracked relevance to all `.claude/*` and `.codex/*`.
  The staged script classifier treats `.husky/*` and `scripts/*` deletions as
  script-smoke deletion triggers.
- Staged/base/untracked/deletions: the changed gate inspects unstaged tracked
  files from `git diff --name-only --diff-filter=ACMRD` and untracked files
  from `git ls-files --others --exclude-standard`; it does not inspect staged
  files. `ai_staged_fingerprint` hashes staged `ACMRD` diff content.
  `ai_precommit_fingerprint` hashes staged diff content plus relevant
  worktree/untracked file contents and records deleted relevant paths.
  `musi_classify_staged_script_input` reads staged `ACMRD` and staged `D`
  lists.
- NUL safety: mostly not NUL-safe for path classification. The changed gate,
  pre-commit fingerprint path loops, and staged script classifier are
  newline-delimited. `ai_worktree_fingerprint` uses
  `git ls-files -z | xargs -0` only for its untracked hashing step.
- Full-scan triggers: none directly. It returns policy decisions that callers
  interpret, including changed-gate failure and staged script classifier return
  code `1` for `.husky/*` or `scripts/*` deletions.
- Output contract: exposes shell functions. The changed gate prints actionable
  diagnostics and returns non-zero on relevant unstaged/untracked work.
  Fingerprint functions print hashes. The staged script classifier communicates
  through return codes plus `MUSI_STAGED_SCRIPT_ALL` and
  `MUSI_STAGED_SCRIPT_DELETED`.

### `scripts/lint-agent-changed.sh`

- Path/surface policy: lintable agent files are existing `*.ts`, `*.tsx`,
  `*.js`, `*.jsx`, `*.mjs`, and `*.cjs` files. Full-scan triggers are
  `bun.lock`, `package.json`, `eslint.config.*`, `tsconfig*.json`,
  `packages/*/package.json`, `packages/*/tsconfig*.json`, and
  `eslint-rules/*`.
- Staged/base/untracked/deletions: resolves the optional base ref from local
  base or `origin/<base>`, and also verifies the base shares history with HEAD.
  It collects `"$BASE"...HEAD`, staged, unstaged, and untracked paths. It does
  not reject unstaged work. Deletions are present in the git diff streams and
  can trigger a full scan, but deleted lintable files are skipped by the
  existing file check.
- NUL safety: uses `git diff -z`, `git ls-files -z`, `read -r -d ''`, and an
  argv array for selected files.
- Full-scan triggers: missing base ref, no merge base between base and HEAD, or
  any full-scan trigger path in the changed set.
- Output contract: with `--print-files`, prints `FULL_SCAN`, `EMPTY`, or one
  selected file per line for smoke tests. In normal mode, full-scan and
  selected-file paths `exec bun scripts/lint-agent.ts`; the empty path emits a
  schema-valid harness diagnostics envelope via `harness-emit-envelope.ts`.

### Format Callers

- Path/surface policy: there is no `scripts/format-check.sh` in this checkout.
  `format:check` is `prettier --check .`, so file support is Prettier's own
  parser surface combined with `.prettierignore`. `format:changed` is
  `scripts/format-changed.sh`; it passes all selected existing files to
  `prettier --write --ignore-unknown`, delegating extension support to
  Prettier.
- Staged/base/untracked/deletions: `format:check` has no changed-file
  semantics. `format:changed` resolves `main` then `origin/main`, then collects
  `"$BASE"...HEAD`, unstaged tracked, and staged paths with
  `--diff-filter=ACMR`. It excludes untracked files and excludes deletions both
  through the diff filter and an existing file check.
- NUL safety: `format:check` delegates traversal to Prettier. `format:changed`
  uses `git diff -z`, `read -r -d ''`, and an argv array.
- Full-scan triggers: `format:check` is always full repo. `format:changed`
  falls back to `prettier --write --ignore-unknown .` when the base ref is
  missing.
- Output contract: `format:check` emits Prettier check output and exits with
  Prettier's status. `format:changed` exits `1` if `prettier` is unavailable,
  prints a no-op message when no files are selected, or prints a count and
  `exec`s Prettier in write mode.

### `scripts/test-scripts.sh` / `test:scripts:changed`

- Path/surface policy: full mode runs the ordered `SMOKE_NAMES` list. Changed
  mode selects from the `SMOKE_SUBJECTS` table using exact path matches or
  prefix matches for subjects ending in `/`; there are no shell globs in the
  matcher. Subjects cover script/test pairs, hook directories and hook config,
  codemod directories, fixtures, generated-doc inputs, lint-ratchet inputs,
  harness metadata, package and TypeScript config files, workflow/config
  directories, and selected shared schema files.
- Staged/base/untracked/deletions: direct `--changed` mode resolves `main` then
  `origin/main`, reads branch changes from `"$ref"...HEAD`, and reads tracked
  staged plus unstaged work from `git diff HEAD`, both with
  `--diff-filter=ACMRD`. It excludes untracked files. If
  `MUSI_SCRIPTS_CHANGED_FILES` is set, that newline-delimited env value
  replaces git changed-file discovery. If `MUSI_SCRIPTS_DELETED_FILES` is set,
  it replaces deletion discovery; if only the changed env is set, deletion
  discovery is skipped for backward compatibility.
- NUL safety: not NUL-safe; git reads and env overrides are newline-delimited.
- Full-scan triggers: non-changed mode is always full. Changed mode runs the
  full smoke suite when the base ref is missing and no env override is present,
  or when a deleted `.husky/*` or `scripts/*` path is detected. Callers such as
  pre-commit and `verify --changed` intentionally invoke direct changed mode
  without env for staged `.husky/*` or `scripts/*` deletions so this fallback
  can run.
- Output contract: no selected smokes prints
  `test:scripts: no script smoke tests selected by changed file set.` and exits
  `0`. Selected smokes run sequentially when `MUSI_SCRIPTS_CONCURRENCY=1` or in
  parallel otherwise, with per-smoke logs, OK/FAILED summaries, failing log
  tails, and an aggregate exit code.

### Script-Smoke Callers In `pre-commit` And `verify --changed`

- Path/surface policy: both callers use `musi_classify_staged_script_input` to
  decide whether to pass the staged path universe into `test:scripts:changed`.
  The deletion-sensitive class is `.husky/*` or `scripts/*`.
- Staged/base/untracked/deletions: when the classifier returns `0`, callers set
  `MUSI_SCRIPTS_CHANGED_FILES` to all staged `ACMRD` paths and
  `MUSI_SCRIPTS_DELETED_FILES` to staged `D` paths before invoking
  `test:scripts:changed`. When it returns `1`, they invoke
  `test:scripts:changed` without env so the script can fall back
  conservatively. `verify --changed` also runs the shared unstaged/untracked
  rejection gate.
- NUL safety: not NUL-safe; the staged classifier and env transport are
  newline-delimited.
- Full-scan triggers: staged `.husky/*` or `scripts/*` deletion causes the
  direct no-env handoff, which lets `test:scripts:changed` run its full smoke
  suite fallback.
- Output contract: no file list is produced. These callers either skip the
  script-smoke slot, run it with env-scoped staged paths, or run it directly;
  the visible output and exit code come from the surrounding verify/pre-commit
  wrapper plus `test:scripts`.
