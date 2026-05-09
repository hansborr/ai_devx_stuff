#!/bin/bash
# Run Vitest only for files changed vs the base branch.
# Falls back to the full test suite when the base ref cannot be resolved
# (detached HEAD, shallow clone, fresh repo without a tracked main).
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"

BASE="main"
if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
  BASE="$1"
  shift
fi

if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  REF="$BASE"
elif git rev-parse --verify "origin/$BASE" >/dev/null 2>&1; then
  REF="origin/$BASE"
else
  echo "test:changed: neither '$BASE' nor 'origin/$BASE' exists — running full test suite." >&2
  exec bash "$VITEST_RUNNER" run --passWithNoTests "$@"
fi

# Classification scans the same diff Vitest's `--changed` would; the working-tree
# additions cover staged/uncommitted edits that --changed does not see in
# pre-commit-only contexts. The classifier decides whether to skip Vitest
# entirely, which `--project` filters to pass, and whether to drop `--changed`
# so config/dependency edits run the relevant suite in full instead of
# selecting nothing.
mapfile -t CHANGED_FILES < <(git diff --name-only --diff-filter=ACMR "$REF"...HEAD)
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  mapfile -t WORKTREE_FILES < <(git diff --name-only --diff-filter=ACMR HEAD)
  CHANGED_FILES+=(${WORKTREE_FILES[@]+"${WORKTREE_FILES[@]}"})
fi

if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
  echo "test:changed: no files changed vs $REF."
  exit 0
fi

# Slow tests live in their own tier (vitest.slow.config.ts) and are excluded
# from the default include patterns. Changed *.slow.test.* files therefore
# never run through `bun run test:changed`; surface a hint so an agent or
# contributor knows to invoke `test:slow` deliberately.
SLOW_CHANGED=()
for file in "${CHANGED_FILES[@]}"; do
  case "$file" in
    *.slow.test.ts|*.slow.test.tsx)
      SLOW_CHANGED+=("$file")
      ;;
  esac
done
if [ "${#SLOW_CHANGED[@]}" -gt 0 ]; then
  printf 'test:changed: slow tests changed; run MUSI_RUN_SLOW_TESTS=1 bun run test:slow\n' >&2
  for file in "${SLOW_CHANGED[@]}"; do
    printf 'test:changed:   - %s\n' "$file" >&2
  done
fi

has_shared=0
has_server=0
has_client=0
has_eslint_rules=0
has_scripts=0
has_global=0
has_vitest_relevant=0
# Dependency or config changes that `vitest --changed` cannot see — they alter
# how unchanged tests run, so the relevant suite must run in full.
full_run=0

for file in "${CHANGED_FILES[@]}"; do
  case "$file" in
    bun.lock|package.json|vitest.config.*|tsconfig*.json)
      has_global=1
      has_vitest_relevant=1
      full_run=1
      ;;
    packages/shared/*)
      has_shared=1
      has_vitest_relevant=1
      ;;
    packages/server/*)
      has_server=1
      has_vitest_relevant=1
      ;;
    packages/client/*)
      has_client=1
      has_vitest_relevant=1
      ;;
    eslint-rules/*)
      has_eslint_rules=1
      has_vitest_relevant=1
      ;;
    scripts/codemods/*|scripts/code-intel*.ts)
      has_scripts=1
      has_vitest_relevant=1
      full_run=1
      ;;
  esac

  case "$file" in
    packages/*/package.json|packages/*/vitest.config.*|packages/*/tsconfig*.json|eslint-rules/vitest.config.*)
      has_vitest_relevant=1
      full_run=1
      ;;
    scripts/vitest.config.*)
      has_scripts=1
      has_vitest_relevant=1
      full_run=1
      ;;
  esac
done

if [ "$has_vitest_relevant" -eq 0 ]; then
  echo "test:changed: no Vitest-relevant changes vs $REF."
  exit 0
fi

PROJECT_ARGS=()
if [ "$has_global" -eq 0 ] && [ "$has_shared" -eq 0 ]; then
  [ "$has_server" -eq 1 ] && PROJECT_ARGS+=("--project=server")
  [ "$has_client" -eq 1 ] && PROJECT_ARGS+=("--project=client")
  [ "$has_eslint_rules" -eq 1 ] && PROJECT_ARGS+=("--project=eslint-rules")
  [ "$has_scripts" -eq 1 ] && PROJECT_ARGS+=("--project=scripts")
fi

if [ "$full_run" -eq 1 ]; then
  exec bash "$VITEST_RUNNER" run --passWithNoTests ${PROJECT_ARGS[@]+"${PROJECT_ARGS[@]}"} "$@"
fi

exec bash "$VITEST_RUNNER" run --passWithNoTests ${PROJECT_ARGS[@]+"${PROJECT_ARGS[@]}"} "$@" --changed "$REF"
