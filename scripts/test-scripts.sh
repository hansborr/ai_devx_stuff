#!/bin/bash
# test-scripts.sh — run shell smoke tests for verification scripts.
#
# Default: runs the full smoke suite with bounded parallelism. Set
# MUSI_SCRIPTS_CONCURRENCY=1 for the old sequential, halt-on-first-failure
# debugging view.
# With --changed, only smoke tests whose subjects (or the smoke test files
# themselves) changed vs the base branch run; if no relevant change is
# detected, the wrapper exits 0 with a no-op message — same shape as
# lint-changed/test-changed. If the base branch cannot be resolved, it falls
# back to the full smoke suite.
#
# Why this exists: verify's lint/typecheck/test slots never exercise the
# shell wrappers themselves, so a regression in `scripts/verify.sh` or
# `scripts/migration-safety-scan.sh` slipped past `bun run verify:changed`
# as a "no Vitest-relevant changes" no-op. test:scripts gives verify a
# fourth slot that is loud about script-only edits.
#
# Usage:
#   bash scripts/test-scripts.sh           # run all smoke tests
#   bash scripts/test-scripts.sh --changed # only smoke tests whose subjects
#                                          # changed vs main
#
# Env (tests only):
#   MUSI_SCRIPTS_CHANGED_FILES — newline-separated list of changed files,
#                                supplied by tests in lieu of `git diff`.
#   MUSI_SCRIPTS_RUNNER        — command (single token) used to invoke each
#                                smoke test; default `bash`. Tests use this
#                                to stub execution without running the real
#                                smoke tests.
#   MUSI_SCRIPTS_CONCURRENCY   — selected-smoke concurrency override; default
#                                is min(4, nproc), falling back to 4.
#   MUSI_SCRIPTS_LOG_DIR       — parallel-mode per-smoke log directory;
#                                default /tmp/musi-test-scripts-logs.

set -u

CHANGED=0
case "${1:-}" in
  --changed) CHANGED=1 ;;
  '') ;;
  *) printf 'test:scripts: unknown argument: %s\n' "$1" >&2
     printf 'usage: test-scripts.sh [--changed]\n' >&2
     exit 2 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 1

# Smoke test name → subject paths it covers. A change to any subject (or
# the smoke test file itself) triggers that smoke test in --changed mode.
# Order is selection order; MUSI_SCRIPTS_CONCURRENCY=1 uses it as run order
# and halts at the first failure to mirror verify.sh.
SMOKE_NAMES=(
  test-verify
  test-verify-async
  test-verify-logs
  test-verify-history
  test-worktree-db
  test-dependency-freshness
  test-ai-hooks
  test-eslint-disable-register
  test-suppression-register
  test-codemod-structured-logging-fix
  test-codemod-trpc-shared-input
  test-codemod-trpc-shared-output
  test-code-intel
  test-lint-changed
  test-lint-shell
  test-lint-config-sensors
  test-test-changed
  test-test-slow
  test-generate-module-index
  test-generate-lint-guidance
  test-generate-harness-controls
  test-harness-check
  test-lint-agent
  test-lint-agent-changed
  test-harness-emit-envelope
  test-lint-ratchet
  test-migration-safety-scan
  test-doctor-json
  test-parallel-runner
  test-verify-metadata
  test-test-scripts
)
declare -A SMOKE_SUBJECTS=(
  [test-verify]="scripts/verify.sh scripts/verify-metadata.sh scripts/process-tree.sh scripts/test-verify.sh scripts/ai-hooks/cache.sh scripts/ai-hooks/output-filter.sh"
  [test-verify-async]="scripts/verify-async.sh scripts/test-verify-async.sh scripts/process-tree.sh scripts/verify.sh scripts/verify-metadata.sh scripts/ai-hooks/cache.sh"
  [test-verify-logs]="scripts/verify-logs.sh scripts/test-verify-logs.sh scripts/ai-hooks/cache.sh scripts/ai-hooks/output-filter.sh scripts/harness-emit-envelope.ts packages/shared/src/schemas/harness-diagnostics.ts"
  [test-verify-history]="scripts/verify-history.sh scripts/test-verify-history.sh scripts/verify-metadata.sh .husky/pre-commit package.json"
  [test-worktree-db]="scripts/worktree-db.sh scripts/worktree-new.sh scripts/worktree-drift-hook.sh scripts/dev.sh scripts/test-worktree-db.sh"
  [test-dependency-freshness]="scripts/dependency-freshness.sh scripts/prisma-client-freshness.sh scripts/doc-length-policy.sh scripts/verify-metadata.sh scripts/process-tree.sh scripts/ai-hooks/output-filter.sh .husky/pre-commit scripts/test-dependency-freshness.sh"
  [test-ai-hooks]="scripts/test-ai-hooks.sh scripts/ai-hooks/test.sh scripts/ai-hooks/common.sh scripts/ai-hooks/cache.sh scripts/verify-metadata.sh scripts/ai-hooks/policy.sh scripts/ai-hooks/protected-files.sh scripts/ai-hooks/doc-length.sh scripts/ai-hooks/output-filter.sh scripts/ai-hooks/process-runner.sh scripts/ai-hooks/commit-output.sh scripts/ai-hooks/commit-timeout-status.sh scripts/ai-hooks/stop-policy.sh scripts/ai-hooks/stop-reminder.sh .claude/hooks/ .codex/hooks/pre-tool-use.sh .codex/hooks/post-tool-use.sh .codex/hooks/stop-reminder.sh .claude/settings.json .codex/hooks.json"
  [test-eslint-disable-register]="scripts/eslint-disable-register.sh scripts/test-eslint-disable-register.sh"
  [test-suppression-register]="scripts/suppression-register.sh scripts/test-suppression-register.sh"
  [test-codemod-structured-logging-fix]="scripts/codemods/structured-logging-fix.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-structured-logging-fix.sh package.json tsconfig.scripts.json"
  [test-codemod-trpc-shared-input]="scripts/codemods/trpc-shared-input.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-trpc-shared-input.sh package.json tsconfig.scripts.json"
  [test-codemod-trpc-shared-output]="scripts/codemods/trpc-shared-output.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-trpc-shared-output.sh package.json tsconfig.scripts.json"
  [test-code-intel]="scripts/code-intel.ts scripts/code-intel/ scripts/code-intel.test.ts scripts/test-code-intel.sh scripts/vitest.config.ts package.json tsconfig.scripts.json packages/shared/package.json packages/server/package.json packages/client/tsconfig.json"
  [test-lint-changed]="scripts/lint-changed.sh scripts/lint-shell.sh scripts/parallel-runner.sh scripts/verify-metadata.sh scripts/test-lint-changed.sh"
  [test-lint-shell]="scripts/lint-shell.sh scripts/parallel-runner.sh scripts/test-lint-shell.sh package.json bun.lock"
  [test-lint-config-sensors]="scripts/lint-config-sensors.sh scripts/test-lint-config-sensors.sh scripts/lint-changed.sh scripts/verify-metadata.sh .yamllint.yml package.json bun.lock .github/workflows/ docker-compose.yml .devcontainer/docker-compose.yml .devcontainer/Dockerfile .codex/config.toml .codex/skills/ bunfig.toml"
  [test-test-changed]="scripts/test-changed.sh scripts/vitest.sh scripts/ai-hooks/output-filter.sh scripts/test-test-changed.sh"
  [test-test-slow]="scripts/test-slow.sh scripts/test-changed.sh scripts/vitest.sh scripts/ai-hooks/output-filter.sh vitest.slow.config.ts packages/shared/vitest.config.ts packages/server/vitest.config.ts packages/client/vitest.config.ts packages/shared/src/test-tier-sentinel.test.ts packages/shared/src/test-tier-sentinel.slow.test.ts scripts/test-test-slow.sh"
  [test-generate-module-index]="scripts/generate-module-index.sh scripts/test-generate-module-index.sh scripts/harness-emit-envelope.ts packages/shared/src/schemas/harness-diagnostics.ts"
  [test-generate-lint-guidance]="scripts/generate-lint-guidance.ts scripts/lint-rule-docs.ts scripts/test-generate-lint-guidance.sh scripts/fixtures/generate-lint-guidance/ eslint.config.js package.json tsconfig.scripts.json docs/generated/local-lint-rules.md eslint-rules/"
  [test-generate-harness-controls]="scripts/generate-harness-controls.ts scripts/lint-rule-docs.ts scripts/test-generate-harness-controls.sh scripts/fixtures/generate-harness-controls/ harness.controls.json eslint.config.js package.json tsconfig.scripts.json docs/generated/harness-controls.md eslint-rules/"
  [test-harness-check]="scripts/harness-check.ts scripts/test-harness-check.sh harness.controls.json eslint.config.js package.json tsconfig.scripts.json eslint-rules/"
  [test-lint-agent]="scripts/lint-agent.ts scripts/lint-rule-docs.ts scripts/test-lint-agent.sh packages/shared/src/schemas/harness-diagnostics.ts package.json tsconfig.scripts.json eslint.config.js eslint-rules/"
  [test-lint-agent-changed]="scripts/lint-agent-changed.sh scripts/lint-agent.ts scripts/harness-emit-envelope.ts scripts/test-lint-agent-changed.sh packages/shared/src/schemas/harness-diagnostics.ts package.json"
  [test-harness-emit-envelope]="scripts/harness-emit-envelope.ts scripts/test-harness-emit-envelope.sh packages/shared/src/schemas/harness-diagnostics.ts"
  [test-lint-ratchet]="scripts/lint-ratchet.ts scripts/lint-ratchet-config.ts scripts/lint-ratchet-metrics.ts scripts/lint-ratchet-baseline-compare.ts scripts/lint-ratchet-baseline-parse.ts scripts/lint-ratchet-baseline.ts scripts/lint-ratchet-baseline.test.ts scripts/lint-ratchet-check-registry.ts scripts/lint-ratchet-check-registry.test.ts scripts/lint-ratchet-output.ts scripts/lint-ratchet-output.test.ts scripts/lint-ratchet-report.ts scripts/lint-ratchet-report.test.ts scripts/lint-ratchet-summary.ts scripts/lint-ratchet-summary.test.ts scripts/lint-rule-docs.ts scripts/test-lint-ratchet.sh lint-ratchet.baseline.json packages/shared/src/schemas/harness-diagnostics.ts package.json tsconfig.scripts.json eslint.config.js eslint-rules/"
  [test-migration-safety-scan]="scripts/migration-safety-scan.sh scripts/test-migration-safety-scan.sh scripts/harness-emit-envelope.ts packages/shared/src/schemas/harness-diagnostics.ts"
  [test-doctor-json]="scripts/doctor.sh scripts/dependency-freshness.sh scripts/harness-emit-envelope.ts scripts/test-doctor-json.sh harness.controls.json packages/shared/src/schemas/harness-diagnostics.ts"
  [test-parallel-runner]="scripts/parallel-runner.sh scripts/test-parallel-runner.sh"
  [test-verify-metadata]="scripts/verify-metadata.sh scripts/test-verify-metadata.sh"
  [test-test-scripts]="scripts/test-scripts.sh scripts/test-test-scripts.sh"
)

resolve_changed_ref() {
  local base="main"
  if git rev-parse --verify "$base" >/dev/null 2>&1; then
    printf '%s\n' "$base"
    return 0
  fi
  if git rev-parse --verify "origin/$base" >/dev/null 2>&1; then
    printf '%s\n' "origin/$base"
    return 0
  fi
  return 1
}

read_changed_files() {
  if [ -n "${MUSI_SCRIPTS_CHANGED_FILES:-}" ]; then
    printf '%s\n' "$MUSI_SCRIPTS_CHANGED_FILES"
    return 0
  fi
  local ref
  ref="$(resolve_changed_ref)" || return 1
  git diff --name-only --diff-filter=ACMRD "$ref"...HEAD 2>/dev/null || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only --diff-filter=ACMRD HEAD 2>/dev/null || true
  fi
}

read_deleted_files() {
  if [ -n "${MUSI_SCRIPTS_DELETED_FILES:-}" ]; then
    printf '%s\n' "$MUSI_SCRIPTS_DELETED_FILES"
    return 0
  fi
  if [ -n "${MUSI_SCRIPTS_CHANGED_FILES:-}" ]; then
    return 0
  fi
  local ref
  ref="$(resolve_changed_ref)" || return 1
  git diff --name-only --diff-filter=D "$ref"...HEAD 2>/dev/null || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only --diff-filter=D HEAD 2>/dev/null || true
  fi
}

script_smoke_deletion_requires_full_suite() {
  local file="$1"
  case "$file" in
    .husky/*|scripts/*)
      return 0
      ;;
  esac
  return 1
}

matches_smoke_subject() {
  local changed_file="$1"
  local subject="$2"
  if [ "$changed_file" = "$subject" ]; then
    return 0
  fi
  case "$subject" in
    */)
      case "$changed_file" in
        "$subject"*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

select_smoke_tests() {
  if [ "$CHANGED" -eq 0 ]; then
    printf '%s\n' "${SMOKE_NAMES[@]}"
    return 0
  fi
  if [ -z "${MUSI_SCRIPTS_CHANGED_FILES:-}" ] && ! resolve_changed_ref >/dev/null; then
    printf "test:scripts: neither 'main' nor 'origin/main' exists — running full smoke suite.\n" >&2
    printf '%s\n' "${SMOKE_NAMES[@]}"
    return 0
  fi
  local name subjects f subject
  local -a changed=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    changed+=("$f")
  done < <(read_changed_files)
  if [ "${#changed[@]}" -eq 0 ]; then
    return 0
  fi
  local -a deleted=()
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    deleted+=("$f")
  done < <(read_deleted_files)
  for f in "${deleted[@]}"; do
    if script_smoke_deletion_requires_full_suite "$f"; then
      printf "test:scripts: script deletion staged — running full smoke suite.\n" >&2
      printf '%s\n' "${SMOKE_NAMES[@]}"
      return 0
    fi
  done
  for name in "${SMOKE_NAMES[@]}"; do
    subjects="${SMOKE_SUBJECTS[$name]}"
    for f in "${changed[@]}"; do
      for subject in $subjects; do
        if matches_smoke_subject "$f" "$subject"; then
          printf '%s\n' "$name"
          continue 3
        fi
      done
    done
  done
}

mapfile -t SELECTED < <(select_smoke_tests)

if [ "${#SELECTED[@]}" -eq 0 ]; then
  if [ "$CHANGED" -eq 1 ]; then
    echo "test:scripts: no script smoke tests selected by changed file set."
    exit 0
  fi
  echo "test:scripts: no smoke tests configured."
  exit 0
fi

RUNNER="${MUSI_SCRIPTS_RUNNER:-bash}"
LOG_DIR="${MUSI_SCRIPTS_LOG_DIR:-/tmp/musi-test-scripts-logs}"
LOG_TAIL_LINES=30

default_scripts_concurrency() {
  local cpu_count

  cpu_count="$(nproc 2>/dev/null)" || cpu_count=4
  if [[ ! "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
    cpu_count=4
  fi
  if [ "$cpu_count" -lt 4 ]; then
    printf '%s\n' "$cpu_count"
    return 0
  fi
  printf '4\n'
}

resolve_scripts_concurrency() {
  local concurrency="${MUSI_SCRIPTS_CONCURRENCY:-}"

  if [ -z "$concurrency" ]; then
    default_scripts_concurrency
    return 0
  fi
  if [[ ! "$concurrency" =~ ^[1-9][0-9]*$ ]]; then
    printf 'test:scripts: MUSI_SCRIPTS_CONCURRENCY must be a positive integer, got: %s\n' \
      "$concurrency" >&2
    return 2
  fi
  printf '%s\n' "$concurrency"
}

summarize_selected_smokes() {
  local passed="" failed="" name status

  for name in "${SELECTED[@]}"; do
    if [ -v "SMOKE_STATUS[$name]" ]; then
      status="${SMOKE_STATUS[$name]}"
      if [ "$status" -eq 0 ]; then
        passed="$passed $name"
      else
        failed="$failed $name"
      fi
    fi
  done

  if [ -n "$failed" ]; then
    printf '\ntest:scripts: FAILED — passed:%s failed:%s\n' "$passed" "$failed" >&2
    return 1
  fi

  printf 'test:scripts: OK —%s\n' "$passed"
}

run_selected_sequential() {
  local name passed="" failed=""

  for name in "${SELECTED[@]}"; do
    printf 'test:scripts: running %s...\n' "$name"
    if "$RUNNER" "scripts/$name.sh"; then
      passed="$passed $name"
      continue
    fi
    failed="$failed $name"
    printf 'test:scripts: %s FAILED\n' "$name" >&2
    break
  done

  if [ -n "$failed" ]; then
    printf '\ntest:scripts: FAILED — passed:%s failed:%s\n' "$passed" "$failed" >&2
    return 1
  fi

  printf 'test:scripts: OK —%s\n' "$passed"
}

musi_scripts_forward_child_signal() {
  local signal="$1"
  local pid="$2"

  trap - INT TERM
  if [ -n "$pid" ]; then
    kill -s "$signal" "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

musi_scripts_run_logged_child() {
  local name="$1"
  local log_file="$2"
  local child_pid=""
  local exit_code=0
  local start_time end_time elapsed

  start_time="$(date +%s)"
  trap 'musi_scripts_forward_child_signal INT "$child_pid"; exit 130' INT
  trap 'musi_scripts_forward_child_signal TERM "$child_pid"; exit 143' TERM

  env --default-signal=INT --default-signal=TERM \
    "$RUNNER" "scripts/$name.sh" >"$log_file" 2>&1 &
  child_pid=$!
  wait "$child_pid" || exit_code=$?

  trap - INT TERM
  end_time="$(date +%s)"
  elapsed=$((end_time - start_time))
  if [ "$exit_code" -eq 0 ]; then
    printf 'test:scripts: %s OK (%ss)\n' "$name" "$elapsed"
  else
    printf 'test:scripts: %s FAILED (%ss)\n' "$name" "$elapsed" >&2
  fi
  exit "$exit_code"
}

ACTIVE_PIDS=()
ACTIVE_NAMES=()
NEXT_SMOKE_INDEX=0
STOP_STARTING=0
declare -A SMOKE_STATUS=()
declare -A SMOKE_LOGS=()

musi_scripts_wait_active_with_signal() {
  local signal="$1"
  local exit_code="$2"
  local pid

  trap - INT TERM
  STOP_STARTING=1
  for pid in "${ACTIVE_PIDS[@]}"; do
    kill -s "$signal" "$pid" 2>/dev/null || true
  done
  for pid in "${ACTIVE_PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  exit "$exit_code"
}

musi_scripts_on_sigint() {
  musi_scripts_wait_active_with_signal INT 130
}

musi_scripts_on_sigterm() {
  musi_scripts_wait_active_with_signal TERM 143
}

musi_scripts_remove_active_pid() {
  local pid="$1"
  local index

  for index in "${!ACTIVE_PIDS[@]}"; do
    if [ "${ACTIVE_PIDS[$index]}" = "$pid" ]; then
      unset 'ACTIVE_PIDS[$index]'
      unset 'ACTIVE_NAMES[$index]'
      ACTIVE_PIDS=("${ACTIVE_PIDS[@]}")
      ACTIVE_NAMES=("${ACTIVE_NAMES[@]}")
      return 0
    fi
  done
  return 1
}

musi_scripts_name_for_pid() {
  local pid="$1"
  local index

  for index in "${!ACTIVE_PIDS[@]}"; do
    if [ "${ACTIVE_PIDS[$index]}" = "$pid" ]; then
      printf '%s\n' "${ACTIVE_NAMES[$index]}"
      return 0
    fi
  done
  return 1
}

musi_scripts_start_next() {
  local name log_file

  name="${SELECTED[$NEXT_SMOKE_INDEX]}"
  log_file="$LOG_DIR/$name.log"
  : >"$log_file" || return 1
  SMOKE_LOGS["$name"]="$log_file"
  printf 'test:scripts: running %s...\n' "$name"
  musi_scripts_run_logged_child "$name" "$log_file" &
  ACTIVE_PIDS+=("$!")
  ACTIVE_NAMES+=("$name")
  NEXT_SMOKE_INDEX=$((NEXT_SMOKE_INDEX + 1))
}

musi_scripts_fill_slots() {
  local concurrency="$1"

  while [ "$STOP_STARTING" -eq 0 ] \
    && [ "${#ACTIVE_PIDS[@]}" -lt "$concurrency" ] \
    && [ "$NEXT_SMOKE_INDEX" -lt "${#SELECTED[@]}" ]; do
    musi_scripts_start_next || return 1
  done
}

musi_scripts_wait_for_one() {
  local completed_pid=""
  local exit_code=0
  local name

  wait -n -p completed_pid "${ACTIVE_PIDS[@]}" || exit_code=$?
  if [ -z "$completed_pid" ]; then
    return 0
  fi
  name="$(musi_scripts_name_for_pid "$completed_pid")" || return 1
  SMOKE_STATUS["$name"]="$exit_code"
  if [ "$exit_code" -ne 0 ]; then
    STOP_STARTING=1
  fi
  musi_scripts_remove_active_pid "$completed_pid"
}

print_failed_log_tails() {
  local name log_file

  for name in "${SELECTED[@]}"; do
    if [ -v "SMOKE_STATUS[$name]" ] && [ "${SMOKE_STATUS[$name]}" -ne 0 ]; then
      log_file="${SMOKE_LOGS[$name]}"
      printf '\ntest:scripts: last %s log lines for %s (%s):\n' \
        "$LOG_TAIL_LINES" "$name" "$log_file" >&2
      tail -n "$LOG_TAIL_LINES" "$log_file" >&2 || true
    fi
  done
}

run_selected_parallel() {
  local concurrency="$1"

  mkdir -p "$LOG_DIR" || return 1
  trap musi_scripts_on_sigint INT
  trap musi_scripts_on_sigterm TERM

  musi_scripts_fill_slots "$concurrency" || return 1
  while [ "${#ACTIVE_PIDS[@]}" -gt 0 ]; do
    musi_scripts_wait_for_one || return 1
    musi_scripts_fill_slots "$concurrency" || return 1
  done

  trap - INT TERM
  if summarize_selected_smokes; then
    return 0
  fi
  print_failed_log_tails
  return 1
}

SCRIPTS_CONCURRENCY="$(resolve_scripts_concurrency)" || exit $?

if [ "$SCRIPTS_CONCURRENCY" -eq 1 ]; then
  run_selected_sequential
  exit $?
fi

run_selected_parallel "$SCRIPTS_CONCURRENCY"
