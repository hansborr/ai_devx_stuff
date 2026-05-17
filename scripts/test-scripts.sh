#!/bin/bash
# test-scripts.sh — run shell smoke tests for verification scripts.
#
# Default: runs the full smoke suite sequentially, halting at the first
# failure.
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
cd "$REPO_ROOT"

# Smoke test name → subject paths it covers. A change to any subject (or
# the smoke test file itself) triggers that smoke test in --changed mode.
# Order is run order; halting at the first failure mirrors verify.sh.
SMOKE_NAMES=(
  test-verify
  test-verify-async
  test-verify-logs
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
  test-test-changed
  test-test-slow
  test-generate-module-index
  test-generate-lint-guidance
  test-migration-safety-scan
  test-test-scripts
)
declare -A SMOKE_SUBJECTS=(
  [test-verify]="scripts/verify.sh scripts/verify-metadata.sh scripts/test-verify.sh scripts/ai-hooks/cache.sh scripts/ai-hooks/output-filter.sh"
  [test-verify-async]="scripts/verify-async.sh scripts/test-verify-async.sh scripts/verify.sh scripts/ai-hooks/cache.sh"
  [test-verify-logs]="scripts/verify-logs.sh scripts/test-verify-logs.sh scripts/ai-hooks/cache.sh scripts/ai-hooks/output-filter.sh"
  [test-worktree-db]="scripts/worktree-db.sh scripts/worktree-new.sh scripts/worktree-drift-hook.sh scripts/dev.sh scripts/test-worktree-db.sh"
  [test-dependency-freshness]="scripts/dependency-freshness.sh scripts/prisma-client-freshness.sh scripts/doc-length-policy.sh scripts/verify-metadata.sh scripts/ai-hooks/output-filter.sh .husky/pre-commit scripts/test-dependency-freshness.sh"
  [test-ai-hooks]="scripts/test-ai-hooks.sh scripts/ai-hooks/test.sh scripts/ai-hooks/common.sh scripts/ai-hooks/cache.sh scripts/verify-metadata.sh scripts/ai-hooks/policy.sh scripts/ai-hooks/protected-files.sh scripts/ai-hooks/doc-length.sh scripts/ai-hooks/output-filter.sh scripts/ai-hooks/process-runner.sh scripts/ai-hooks/stop-policy.sh scripts/ai-hooks/stop-reminder.sh .claude/hooks/bun-run-quiet.sh .claude/hooks/stop-reminder.sh .codex/hooks/pre-tool-use.sh .codex/hooks/post-tool-use.sh .codex/hooks/stop-reminder.sh .claude/settings.json .codex/hooks.json"
  [test-eslint-disable-register]="scripts/eslint-disable-register.sh scripts/test-eslint-disable-register.sh"
  [test-suppression-register]="scripts/suppression-register.sh scripts/test-suppression-register.sh"
  [test-codemod-structured-logging-fix]="scripts/codemods/structured-logging-fix.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-structured-logging-fix.sh package.json tsconfig.scripts.json"
  [test-codemod-trpc-shared-input]="scripts/codemods/trpc-shared-input.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-trpc-shared-input.sh package.json tsconfig.scripts.json"
  [test-codemod-trpc-shared-output]="scripts/codemods/trpc-shared-output.ts scripts/codemods/lib/trpc-shared-schema.ts scripts/test-codemod-trpc-shared-output.sh package.json tsconfig.scripts.json"
  [test-code-intel]="scripts/code-intel.ts scripts/code-intel/ scripts/code-intel.test.ts scripts/test-code-intel.sh scripts/vitest.config.ts package.json tsconfig.scripts.json packages/shared/package.json packages/server/package.json packages/client/tsconfig.json"
  [test-lint-changed]="scripts/lint-changed.sh scripts/verify-metadata.sh scripts/test-lint-changed.sh"
  [test-test-changed]="scripts/test-changed.sh scripts/vitest.sh scripts/ai-hooks/output-filter.sh scripts/test-test-changed.sh"
  [test-test-slow]="scripts/test-slow.sh scripts/test-changed.sh scripts/vitest.sh scripts/ai-hooks/output-filter.sh vitest.slow.config.ts packages/shared/vitest.config.ts packages/server/vitest.config.ts packages/client/vitest.config.ts packages/shared/src/test-tier-sentinel.test.ts packages/shared/src/test-tier-sentinel.slow.test.ts scripts/test-test-slow.sh"
  [test-generate-module-index]="scripts/generate-module-index.sh scripts/test-generate-module-index.sh"
  [test-generate-lint-guidance]="scripts/generate-lint-guidance.ts scripts/test-generate-lint-guidance.sh eslint.config.js package.json tsconfig.scripts.json docs/generated/local-lint-rules.md eslint-rules/structured-logging.js eslint-rules/no-barrel.js eslint-rules/strict-trpc-input.js"
  [test-migration-safety-scan]="scripts/migration-safety-scan.sh scripts/test-migration-safety-scan.sh"
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

passed=""
failed=""
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
  exit 1
fi

printf 'test:scripts: OK —%s\n' "$passed"
