#!/bin/bash
# Run Vitest only for files changed vs the base branch.
# Falls back to the full test suite when the base ref cannot be resolved
# (detached HEAD, shallow clone, fresh repo without a tracked main).
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/changed-base.sh
. "$SCRIPT_DIR/lib/changed-base.sh"
# shellcheck source=scripts/lib/test-worker-count.sh
. "$SCRIPT_DIR/lib/test-worker-count.sh"
VITEST_RUNNER="$SCRIPT_DIR/vitest.sh"
CLIENT_TEST_RUNNER="$SCRIPT_DIR/client-test-isolation-runner.ts"

BASE="main"
if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
  BASE="$1"
  shift
fi
USER_ARGS=("$@")
musi_test_parse_cli_max_workers "${USER_ARGS[@]}" || exit $?
musi_test_translate_cli_max_workers_to_native_env
CLIENT_SPLIT_MAX_WORKERS="${MUSI_CLIENT_FAST_LANE_MAX_WORKERS-$MUSI_TEST_CHANGED_CLIENT_DEFAULT_MAX_WORKERS}"
musi_test_validate_worker_count \
  MUSI_CLIENT_FAST_LANE_MAX_WORKERS "$CLIENT_SPLIT_MAX_WORKERS" || exit $?

# Resolve the base ref and preflight the common ancestor the triple-dot
# diff needs (see scripts/lib/changed-base.sh); on failure fall back to
# the full suite.
if musi_resolve_changed_base "$BASE"; then
  REF="$MUSI_CHANGED_BASE"
else
  echo "test:changed: $MUSI_CHANGED_BASE_ERROR — running full test suite." >&2
  exec bash "$VITEST_RUNNER" run --passWithNoTests "$@"
fi

read_diff_names() {
  local target_name="$1"
  local diff_filter="$2"
  local diff_range="$3"
  local tmp

  tmp="$(mktemp "${TMPDIR:-/tmp}/musi-test-changed-diff.XXXXXX")" || return 2
  if ! git diff --name-only --diff-filter="$diff_filter" "$diff_range" >"$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  mapfile -t "$target_name" <"$tmp"
  rm -f "$tmp"
}

# Classification scans the same diff Vitest's `--changed` would; the working-tree
# additions cover staged/uncommitted edits that --changed does not see in
# pre-commit-only contexts. The classifier decides whether to skip Vitest
# entirely, which `--project` filters to pass, and whether to drop `--changed`
# so config/dependency edits run the relevant suite in full instead of
# selecting nothing.
if ! read_diff_names CHANGED_FILES ACMRD "$REF...HEAD"; then
  echo "test:changed: failed to diff changed files vs $REF." >&2
  exit 1
fi
if ! read_diff_names DELETED_FILES D "$REF...HEAD"; then
  echo "test:changed: failed to diff deleted files vs $REF." >&2
  exit 1
fi
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  if ! read_diff_names WORKTREE_FILES ACMRD HEAD; then
    echo "test:changed: failed to diff changed files vs HEAD." >&2
    exit 1
  fi
  if ! read_diff_names WORKTREE_DELETED_FILES D HEAD; then
    echo "test:changed: failed to diff deleted files vs HEAD." >&2
    exit 1
  fi
  CHANGED_FILES+=("${WORKTREE_FILES[@]}")
  DELETED_FILES+=("${WORKTREE_DELETED_FILES[@]}")
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
has_tools=0
has_global=0
has_vitest_relevant=0
# Dependency or config changes that `vitest --changed` cannot see — they alter
# how unchanged tests run, so the relevant suite must run in full.
full_run=0

package_json_requires_full_vitest() {
  local ref="$1"

  bun --config=/dev/null -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ref = process.argv[1];
const base = spawnSync("git", ["show", `${ref}:package.json`], { encoding: "utf8" });
if (base.status !== 0) process.exit(0);

function withoutRootScripts(text) {
  const value = JSON.parse(text);
  if (value === null || Array.isArray(value) || typeof value !== "object") process.exit(0);
  delete value.scripts;
  return normalize(value);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

try {
  const before = withoutRootScripts(base.stdout);
  const after = withoutRootScripts(readFileSync("package.json", "utf8"));
  process.exit(JSON.stringify(before) === JSON.stringify(after) ? 1 : 0);
} catch {
  process.exit(0);
}
' "$ref"
}

is_deleted_change() {
  local needle="$1" deleted
  for deleted in "${DELETED_FILES[@]}"; do
    [ "$deleted" = "$needle" ] && return 0
  done
  return 1
}

# porting-knob: test-changed-classifiers -- retarget these repo-layout routing semantics
for file in "${CHANGED_FILES[@]}"; do
  file_vitest_relevant=0
  case "$file" in
    tsconfig.scripts.json)
      has_scripts=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    eslint.config.*)
      has_eslint_rules=1
      has_scripts=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    bun.lock|vitest.config.*|tsconfig*.json)
      has_global=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    package.json)
      has_vitest_relevant=1
      file_vitest_relevant=1
      if package_json_requires_full_vitest "$REF"; then
        has_global=1
      else
        has_scripts=1
      fi
      full_run=1
      ;;
    packages/shared/*)
      has_shared=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      ;;
    packages/server/*)
      has_server=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      ;;
    packages/client/*)
      has_client=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      ;;
    tools/lint-ratchet/*)
      has_tools=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      ;;
    eslint-rules/*)
      has_eslint_rules=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      ;;
    eslint-config/*)
      has_eslint_rules=1
      has_scripts=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    scripts/*.test.ts|scripts/lib/*.ts|scripts/client-test-isolation-*.ts|scripts/codemods/*|scripts/code-intel*.ts|scripts/drift-ai.ts|scripts/drift-ai/*|scripts/drift/*|scripts/harness/*|scripts/logs-audit.ts|scripts/logs-audit/*|scripts/sensor-blob-size.ts|scripts/lint-coverage-map-check*.ts|scripts/lint-ratchet.ts|scripts/lint-ratchet/*)
      has_scripts=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
  esac

  case "$file" in
    packages/*/package.json|packages/*/vitest.config.*|packages/*/tsconfig*.json|eslint-rules/vitest.config.*)
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    tools/*/package.json|tools/*/vitest.config.*|tools/*/tsconfig*.json|tools/stryker-lint-ratchet.ts)
      has_tools=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
    scripts/vitest.config.*)
      has_scripts=1
      has_vitest_relevant=1
      file_vitest_relevant=1
      full_run=1
      ;;
  esac

  if [ "$file_vitest_relevant" -eq 1 ] && is_deleted_change "$file"; then
    full_run=1
  fi
done

if [ "$has_vitest_relevant" -eq 0 ]; then
  echo "test:changed: no Vitest-relevant changes vs $REF."
  exit 0
fi

client_split_supports_user_args() {
  local arg
  for arg in ${USER_ARGS[@]+"${USER_ARGS[@]}"}; do
    case "$arg" in
      --coverage|--coverage=*|--coverage.*|--project|--project=*|--outputFile|--outputFile=*|--outputFile.*)
        return 1
        ;;
    esac
  done
  return 0
}

run_and_remember_failure() {
  local exit_code_ref="$1"
  shift
  local status=0

  "$@" || status=$?
  if [ "$status" -ne 0 ] && [ "${!exit_code_ref}" -eq 0 ]; then
    printf -v "$exit_code_ref" '%s' "$status"
  fi
}

VITEST_PROJECT_ARGS=()
RUN_CLIENT_SPLIT=0
if client_split_supports_user_args; then
  if [ "$has_global" -eq 1 ] || [ "$has_shared" -eq 1 ]; then
    RUN_CLIENT_SPLIT=1
    # All non-client projects in one run (the `!client` filter mirrors test-all.sh
    # and keeps any project added to vitest.config.ts covered without re-listing
    # the set); the client project runs through the split runner below.
    VITEST_PROJECT_ARGS=("--project=!client")
  else
    [ "$has_server" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=server")
    [ "$has_client" -eq 1 ] && RUN_CLIENT_SPLIT=1
    [ "$has_eslint_rules" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=eslint-rules")
    [ "$has_scripts" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=scripts")
    [ "$has_tools" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=lint-ratchet")
  fi
else
  if [ "$has_global" -eq 0 ] && [ "$has_shared" -eq 0 ]; then
    [ "$has_server" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=server")
    [ "$has_client" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=client")
    [ "$has_eslint_rules" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=eslint-rules")
    [ "$has_scripts" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=scripts")
    [ "$has_tools" -eq 1 ] && VITEST_PROJECT_ARGS+=("--project=lint-ratchet")
  fi
fi

SELECTION_ARGS=()
if [ "$full_run" -eq 0 ]; then
  SELECTION_ARGS=("--changed" "$REF")
fi

EXIT_CODE=0
RUN_VITEST=1
if [ "$RUN_CLIENT_SPLIT" -eq 1 ] && [ "${#VITEST_PROJECT_ARGS[@]}" -eq 0 ]; then
  RUN_VITEST=0
fi

if [ "$RUN_VITEST" -eq 1 ]; then
  run_and_remember_failure EXIT_CODE \
    bash "$VITEST_RUNNER" run --passWithNoTests \
    ${VITEST_PROJECT_ARGS[@]+"${VITEST_PROJECT_ARGS[@]}"} \
    ${USER_ARGS[@]+"${USER_ARGS[@]}"} \
    ${SELECTION_ARGS[@]+"${SELECTION_ARGS[@]}"}
fi

# test:changed runs as one of several parallel pre-commit gates, so the client
# split — especially the CPU-dense no-isolate fast lane — must not grab Vitest's
# default nproc-1 worker fan-out as if it owned the machine. Bound it via
# VITEST_MAX_WORKERS (read natively by Vitest, vitest/dist .../coverage.*.js) on
# this changed-run path only. This deliberately replaces any translated CLI
# value for the distinct client phase; the ordinary/fallback Vitest phase above
# consumes translated CLI normally. Standalone `test:client` /
# `test:client:split` bypass this script and keep the full fan-out for speed.
# Override the bound with MUSI_CLIENT_FAST_LANE_MAX_WORKERS within the shared
# measured 1-8 range.
CLIENT_SPLIT_WORKER_ENV=(env "VITEST_MAX_WORKERS=$CLIENT_SPLIT_MAX_WORKERS")

if [ "$RUN_CLIENT_SPLIT" -eq 1 ]; then
  run_and_remember_failure EXIT_CODE \
    ${CLIENT_SPLIT_WORKER_ENV[@]+"${CLIENT_SPLIT_WORKER_ENV[@]}"} \
    bun "$CLIENT_TEST_RUNNER" \
    ${USER_ARGS[@]+"${USER_ARGS[@]}"} \
    ${SELECTION_ARGS[@]+"${SELECTION_ARGS[@]}"}
fi

exit "$EXIT_CODE"
