#!/usr/bin/env bash
# smoke-order: 190
# smoke-subjects: scripts/lint-changed.sh
# smoke-subjects: scripts/lint-shell.sh
# smoke-subjects: scripts/lib/parallel-runner.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/segment-pattern.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/lint-ratchet/paths.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-lint-changed.sh
# smoke-subjects: eslint-config/
# smoke-subjects: scripts/eslint-main.sh
# smoke-subjects: scripts/lib/eslint-main-cache.sh
# smoke-subjects: scripts/lib/eslint-main-cache.ts
# smoke-subjects: scripts/lib/process-argv.ts
# smoke-subjects: scripts/lib/eslint-main-partitions.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects-data.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/smoke-test-files.ts
# Pure-shell smoke tests for scripts/lint-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LINT_CHANGED="$SCRIPT_DIR/../lint-changed.sh"
LINT_SHELL="$SCRIPT_DIR/../lint-shell.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/../lib/parallel-runner.sh"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/../lint-config-sensors.sh"
ESLINT_MAIN_CACHE="$SCRIPT_DIR/../lib/eslint-main-cache.sh"
ESLINT_MAIN_CACHE_CORE="$SCRIPT_DIR/../lib/eslint-main-cache.ts"
PROCESS_ARGV="$SCRIPT_DIR/../lib/process-argv.ts"
ESLINT_MAIN_PARTITIONS="$SCRIPT_DIR/../lib/eslint-main-partitions.sh"
ESLINT_MAIN_RUNNER="$SCRIPT_DIR/../eslint-main.sh"
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"
VERIFY_COMMIT_QUEUE="$SCRIPT_DIR/../lib/verify-commit-queue.sh"
VERIFY_FAST_COMMIT="$SCRIPT_DIR/../lib/verify-fast-commit.sh"
VERIFY_MARKERS="$SCRIPT_DIR/../lib/verify-markers.sh"
VERIFY_PATH_POLICY="$SCRIPT_DIR/../lib/verify-path-policy.sh"
VERIFY_RUN_META="$SCRIPT_DIR/../lib/verify-run-meta.sh"
VERIFY_STATE_PATHS="$SCRIPT_DIR/../lib/verify-state-paths.sh"
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree via the MUSI_VERIFY_META_CORE seam.
export MUSI_VERIFY_META_CORE="$SCRIPT_DIR/../lib/verify-metadata-core.ts"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
CHANGED_LINTABLE_FILES="$SCRIPT_DIR/../lib/changed-lintable-files.sh"
LINT_DIST_PREFLIGHT="$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
GATE_ENV="$SCRIPT_DIR/../lib/gate-env.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
SEGMENT_PATTERN="$SCRIPT_DIR/../path-policy/segment-pattern.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"
PATH_POLICY_SMOKE_SUBJECTS_DATA="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects-data.ts"
SMOKE_TEST_FILES="$SCRIPT_DIR/../path-policy/smoke-test-files.ts"
HARNESS_PATHS="$SCRIPT_DIR/../harness/harness-paths.ts"
HARNESS_MANIFEST="$SCRIPT_DIR/../harness/harness-manifest.ts"
RECORDS="$SCRIPT_DIR/../lib/records.ts"
LINT_RATCHET_PATHS="$SCRIPT_DIR/../lint-ratchet/paths.ts"
CONFIG_SURFACES="$REPO_ROOT/eslint-config/config-surfaces.js"
CONFIG_SURFACE_MANIFEST="$REPO_ROOT/eslint-config/config-surface-manifest.json"
PATH_GLOB_POLICY="$REPO_ROOT/eslint-config/path-glob-policy.js"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-lint-changed-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/eslint" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub eslint'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${STUB_LOG:-/dev/null}"
for arg in "$@"; do
  if [ -n "${STUB_ESLINT_FAIL_TARGET:-}" ] \
    && [ "$arg" = "$STUB_ESLINT_FAIL_TARGET" ]; then
    exit "${STUB_ESLINT_FAIL_EXIT:-1}"
  fi
done
exit "${STUB_ESLINT_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/eslint"

cat > "$SANDBOX/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub shellcheck'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${SHELLCHECK_LOG:-/dev/null}"
exit "${STUB_SHELLCHECK_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/shellcheck"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p \
    "$repo/scripts" \
    "$repo/scripts/lib" \
    "$repo/scripts/path-policy" \
    "$repo/scripts/harness" \
    "$repo/scripts/lint-ratchet" \
    "$repo/eslint-config" \
    "$repo/packages/server/src" \
    "$repo/packages/shared/dist/dice" \
    "$repo/packages/shared/dist/map" \
    "$repo/packages/shared/dist/rules" \
    "$repo/packages/shared/dist/schemas" \
    "$repo/packages/shared/dist/test" \
    "$repo/packages/server/dist/routers" \
    "$repo/eslint-rules" \
    "$repo/.github/workflows"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
  cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/lib/parallel-runner.sh"
  cp "$ESLINT_MAIN_CACHE" "$repo/scripts/lib/eslint-main-cache.sh"
  cp "$ESLINT_MAIN_CACHE_CORE" "$repo/scripts/lib/eslint-main-cache.ts"
  cp "$PROCESS_ARGV" "$repo/scripts/lib/process-argv.ts"
  cp "$ESLINT_MAIN_PARTITIONS" "$repo/scripts/lib/eslint-main-partitions.sh"
  cp "$ESLINT_MAIN_RUNNER" "$repo/scripts/eslint-main.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
  cp "$VERIFY_COMMIT_QUEUE" "$repo/scripts/lib/verify-commit-queue.sh"
  cp "$VERIFY_FAST_COMMIT" "$repo/scripts/lib/verify-fast-commit.sh"
  cp "$VERIFY_MARKERS" "$repo/scripts/lib/verify-markers.sh"
  cp "$VERIFY_PATH_POLICY" "$repo/scripts/lib/verify-path-policy.sh"
  cp "$VERIFY_RUN_META" "$repo/scripts/lib/verify-run-meta.sh"
  cp "$VERIFY_STATE_PATHS" "$repo/scripts/lib/verify-state-paths.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
  cp "$CHANGED_LINTABLE_FILES" "$repo/scripts/lib/changed-lintable-files.sh"
  cp "$LINT_DIST_PREFLIGHT" "$repo/scripts/lib/lint-dist-preflight.sh"
  cp "$GATE_ENV" "$repo/scripts/lib/gate-env.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$SEGMENT_PATTERN" "$repo/scripts/path-policy/segment-pattern.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
    "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
  cp "$SMOKE_TEST_FILES" "$repo/scripts/path-policy/smoke-test-files.ts"
  cp "$HARNESS_PATHS" "$repo/scripts/harness/harness-paths.ts"
  cp "$HARNESS_MANIFEST" "$repo/scripts/harness/harness-manifest.ts"
  # harness-manifest.ts narrows the manifest JSON through the shared record
  # guards in scripts/lib/records.ts, so the sandbox closure needs that leaf too.
  cp "$RECORDS" "$repo/scripts/lib/records.ts"
  cp "$LINT_RATCHET_PATHS" "$repo/scripts/lint-ratchet/paths.ts"
  # @musi/lint-ratchet engine moved to the package (leaf 02 S3); the copied
  # adapter/generators import it, so resolve it via a scoped node_modules
  # symlink instead of copying the moved leaf file.
  mkdir -p "$repo/node_modules/@musi"
  [ -e "$repo/node_modules/@musi/lint-ratchet" ] || ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"
  cp "$CONFIG_SURFACES" "$repo/eslint-config/config-surfaces.js"
  cp "$CONFIG_SURFACE_MANIFEST" "$repo/eslint-config/config-surface-manifest.json"
  cp "$PATH_GLOB_POLICY" "$repo/eslint-config/path-glob-policy.js"
  cat > "$repo/scripts/lint-config-sensors.sh" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub config sensors'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${CONFIG_SENSOR_LOG:-/dev/null}"
exit "${STUB_CONFIG_SENSOR_EXIT:-0}"
STUB
  cat > "$repo/scripts/lint-import-cycles.sh" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub import cycles'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${IMPORT_CYCLES_LOG:-/dev/null}"
exit "${STUB_IMPORT_CYCLES_EXIT:-0}"
STUB
  printf 'export default [];\n' > "$repo/eslint.config.js"
  printf 'name: CI\non: push\njobs: {}\n' > "$repo/.github/workflows/ci.yml"
  printf 'base\n' > "$repo/packages/server/src/app.ts"
  touch "$repo/packages/shared/dist/constants.d.ts"
  touch "$repo/packages/shared/dist/logging-policy.d.ts"
  touch "$repo/packages/shared/dist/dice/dice-roller.d.ts"
  touch "$repo/packages/shared/dist/map/drawing.d.ts"
  touch "$repo/packages/shared/dist/rules/attack-damage.d.ts"
  touch "$repo/packages/shared/dist/schemas/auth.d.ts"
  touch "$repo/packages/shared/dist/test/parse-helpers.d.ts"
  touch "$repo/packages/server/dist/routers/app-router.d.ts"
  printf 'rule\n' > "$repo/eslint-rules/example.js"
  printf '{}\n' > "$repo/package.json"
  printf '{}\n' > "$repo/tsconfig.json"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

new_json_lint_repo() {
  local name="$1"
  local repo

  repo="$(new_repo "$name")"
  # JSON lint needs @eslint/json from the real node_modules; replace new_repo's
  # scoped @musi node_modules with the whole store (which still resolves
  # @musi/lint-ratchet via the workspace .bun metadata).
  rm -rf "$repo/node_modules"
  ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"
  cat > "$repo/package.json" <<'JSON'
{"type":"module"}
JSON
  cat > "$repo/eslint.config.js" <<'JS'
import json from "@eslint/json";

export default [
  {
    files: ["**/*.json"],
    plugins: { json },
    language: "json/json",
    rules: {
      "json/no-duplicate-keys": "error",
    },
  },
];
JS
  git -C "$repo" add package.json eslint.config.js
  git -C "$repo" commit -qm json-eslint-config
  printf '%s\n' "$repo"
}

run_lint_changed() {
  local repo="$1"; shift
  (
    cd "$repo"
    STUB_LOG="$repo/eslint.log" PATH="$SANDBOX/bin:$PATH" \
      SHELLCHECK_LOG="$repo/shellcheck.log" \
      CONFIG_SENSOR_LOG="$repo/config-sensors.log" \
      IMPORT_CYCLES_LOG="$repo/import-cycles.log" \
      STUB_SHELLCHECK_EXIT="${STUB_SHELLCHECK_EXIT:-0}" \
      STUB_CONFIG_SENSOR_EXIT="${STUB_CONFIG_SENSOR_EXIT:-0}" \
      STUB_IMPORT_CYCLES_EXIT="${STUB_IMPORT_CYCLES_EXIT:-0}" \
      bash scripts/lint-changed.sh "$@"
  )
}

run_lint_changed_real_eslint() {
  local repo="$1"; shift
  (
    cd "$repo"
    PATH="$REPO_ROOT/node_modules/.bin:$PATH" \
      CONFIG_SENSOR_LOG="$repo/config-sensors.log" \
      bash scripts/lint-changed.sh "$@"
  )
}

eslint_cache_log_args() {
  local repo="$1" cache_key="${2:-}"
  (
    cd "$repo"
    # shellcheck source=/dev/null
    . scripts/lib/eslint-main-cache.sh
    musi_eslint_main_cache_load_plans "$repo" "$cache_key"
    musi_eslint_main_cache_args_for_key "$cache_key"
    for arg in "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}"; do
      printf ' <%s>' "$arg"
    done
  )
}

eslint_full_partition_log() {
  local repo="$1"
  printf 'stub eslint <--max-warnings=0>%s <packages/shared/src>\n' \
    "$(eslint_cache_log_args "$repo" shared)"
  printf 'stub eslint <--max-warnings=0>%s <packages/server/src>\n' \
    "$(eslint_cache_log_args "$repo" server)"
  printf 'stub eslint <--max-warnings=0>%s <packages/client/src>\n' \
    "$(eslint_cache_log_args "$repo" client)"
  printf 'stub eslint <--max-warnings=0>%s <.> <--ignore-pattern> <packages/shared/src/**> <--ignore-pattern> <packages/server/src/**> <--ignore-pattern> <packages/client/src/**>\n' \
    "$(eslint_cache_log_args "$repo" remainder)"
}

assert_stage_or_inspect_failure() {
  local output="$1"
  local file="$2"
  grep -qF 'source-relevant unstaged or untracked changes' <<< "$output" \
    || fail "diagnostic should name source-relevant unstaged/untracked changes: $output"
  grep -qF "$file" <<< "$output" \
    || fail "diagnostic should name offending file $file: $output"
  grep -qF 'stage' <<< "$output" \
    || fail "diagnostic should tell the user to stage the file: $output"
  grep -qF 'git diff or git show HEAD:<path>' <<< "$output" \
    || fail "diagnostic should tell the user how to inspect unrelated work: $output"
  if grep -qiF stash <<< "$output"; then
    fail "diagnostic must not tell the user to stash unrelated work: $output"
  fi
}

bash -n "$LINT_CHANGED" || fail "lint-changed.sh fails bash -n"
ok "lint-changed.sh passes bash -n"

bash -n "$PARALLEL_RUNNER" || fail "parallel-runner.sh fails bash -n"
ok "parallel-runner.sh passes bash -n"

bash -n "$LINT_SHELL" || fail "lint-shell.sh fails bash -n"
ok "lint-shell.sh passes bash -n"

bash -n "$LINT_CONFIG_SENSORS" || fail "lint-config-sensors.sh fails bash -n"
ok "lint-config-sensors.sh passes bash -n"

bash -n "$ESLINT_MAIN_CACHE" || fail "eslint-main-cache.sh fails bash -n"
ok "eslint-main-cache.sh passes bash -n"

bash -n "$ESLINT_MAIN_PARTITIONS" || fail "eslint-main-partitions.sh fails bash -n"
ok "eslint-main-partitions.sh passes bash -n"

bash -n "$ESLINT_MAIN_RUNNER" || fail "eslint-main.sh fails bash -n"
ok "eslint-main.sh passes bash -n"

repo="$(new_repo clean)"
: > "$repo/eslint.log"
: > "$repo/import-cycles.log"
output="$(run_lint_changed "$repo")" || fail "clean repo should not fail: $output"
grep -qF 'no staged/base changed lintable files vs main' <<< "$output" \
  || fail "clean repo should announce no changed lintable files: $output"
[ ! -s "$repo/eslint.log" ] || fail "clean repo should not invoke eslint: $(cat "$repo/eslint.log")"
[ -s "$repo/import-cycles.log" ] \
  || fail "clean repo should still run the always-on import-cycles floor"
ok "clean repo skips eslint but runs the import-cycles floor"

repo="$(new_repo cache-adapter)"
(
  cd "$repo"
  # shellcheck source=/dev/null
  . scripts/lib/eslint-main-cache.sh
  musi_eslint_main_cache_load_plans "$repo" shared server client remainder
  first_cache_dir=""
  for partition in shared server client remainder; do
    musi_eslint_main_cache_args_for_key "$partition"
    cache_location="${MUSI_ESLINT_MAIN_CACHE_ARGS[2]}"
    [ "$(basename "$cache_location")" = "$partition.eslintcache" ] \
      || fail "$partition cache should keep its typed filename: $cache_location"
    if [ -z "$first_cache_dir" ]; then
      first_cache_dir="$(dirname "$cache_location")"
    else
      [ "$(dirname "$cache_location")" = "$first_cache_dir" ] \
        || fail "adapter plans should share one identity directory"
    fi
  done
) || fail "typed cache adapter should load and select every partition plan"
ok "main ESLint shell adapter preserves typed partition plans"

# The adapter transports the argument vector opaquely, so these fixtures use
# neutral sentinel fields rather than ESLint flags: the only field the adapter
# is entitled to read is the one path under the declared identity directory.
# A record of a different length, in a different order, still round-trips
# verbatim, so growing the vector stays a one-file edit in
# scripts/lib/eslint-main-cache.ts instead of a lockstep TS+shell change.
write_cache_record_fixture() {
  local path="$1" body="" field
  shift
  for field in "$@"; do
    body+="$field\\x00"
  done
  cat >"$path" <<TS
process.stdout.write("musi-eslint-cache-plan-v1\\x00$body");
TS
}

write_cache_record_fixture "$repo/scripts/lib/opaque-eslint-main-cache.ts" \
  1 shared /tmp/identity-test \
  4 first-field /tmp/identity-test/shared.cache-file third-field fourth-field
actual="$(
  cd "$repo"
  # shellcheck source=/dev/null
  . scripts/lib/eslint-main-cache.sh
  MUSI_ESLINT_MAIN_CACHE_CORE="$repo/scripts/lib/opaque-eslint-main-cache.ts" \
    musi_eslint_main_cache_load_plans "$repo" shared || exit 1
  musi_eslint_main_cache_args_for_key shared || exit 1
  printf '<%s>' "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}"
)" || fail "cache adapter should load a record of neutral sentinel fields"
[ "$actual" = "<first-field></tmp/identity-test/shared.cache-file><third-field><fourth-field>" ] \
  || fail "cache adapter should reconstruct the declared vector verbatim: $actual"
ok "main ESLint shell adapter transports the argument vector opaquely"

# Framing rejections: no field under the identity directory, fewer fields than
# the declared count, and one field more than the whole record accounts for.
assert_cache_record_rejected() {
  local name="$1" description="$2"
  shift 2
  write_cache_record_fixture "$repo/scripts/lib/$name-eslint-main-cache.ts" "$@"
  if (
    cd "$repo"
    # shellcheck source=/dev/null
    . scripts/lib/eslint-main-cache.sh
    MUSI_ESLINT_MAIN_CACHE_CORE="$repo/scripts/lib/$name-eslint-main-cache.ts" \
      musi_eslint_main_cache_load_plans "$repo" shared
  ); then
    fail "cache adapter should reject $description"
  fi
  ok "main ESLint shell adapter rejects $description"
}

assert_cache_record_rejected uncontained \
  "a record with no path under the identity directory" \
  1 shared /tmp/identity-test \
  3 first-field relative.cache-file third-field
assert_cache_record_rejected truncated \
  "a record shorter than its declared argument count" \
  1 shared /tmp/identity-test \
  4 first-field /tmp/identity-test/shared.cache-file third-field
assert_cache_record_rejected trailing \
  "a record with a field beyond its declared argument count" \
  1 shared /tmp/identity-test \
  3 first-field /tmp/identity-test/shared.cache-file third-field extra-field

repo="$(new_repo staged-source-change)"
printf 'changed\n' > "$repo/packages/server/src/app.ts"
git -C "$repo" add packages/server/src/app.ts
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged source change should run lint"
expected="stub eslint <--max-warnings=0> <--no-warn-ignored>$(eslint_cache_log_args "$repo" server) <--> <packages/server/src/app.ts>"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "staged source change should lint only staged source file: $(cat "$repo/eslint.log")"
ok "staged source-only changes lint staged files"

repo="$(new_repo staged-multi-partition-change)"
mkdir -p "$repo/packages/shared/src" "$repo/packages/client/src" "$repo/scripts"
printf 'export const shared = true;\n' > "$repo/packages/shared/src/shared.ts"
printf 'export const client = true;\n' > "$repo/packages/client/src/client.ts"
printf 'export const tool = true;\n' > "$repo/scripts/tool.ts"
printf 'changed\n' > "$repo/packages/server/src/app.ts"
git -C "$repo" add packages/shared/src/shared.ts packages/server/src/app.ts \
  packages/client/src/client.ts scripts/tool.ts
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "multi-package staged changes should run lint"
expected="$(
  printf 'stub eslint <--max-warnings=0> <--no-warn-ignored>%s <--> <packages/shared/src/shared.ts>\n' \
    "$(eslint_cache_log_args "$repo" shared)"
  printf 'stub eslint <--max-warnings=0> <--no-warn-ignored>%s <--> <packages/server/src/app.ts>\n' \
    "$(eslint_cache_log_args "$repo" server)"
  printf 'stub eslint <--max-warnings=0> <--no-warn-ignored>%s <--> <packages/client/src/client.ts>\n' \
    "$(eslint_cache_log_args "$repo" client)"
  printf 'stub eslint <--max-warnings=0> <--no-warn-ignored>%s <--> <scripts/tool.ts>\n' \
    "$(eslint_cache_log_args "$repo" remainder)"
)"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "changed files should run in four sequential owning partitions: $(cat "$repo/eslint.log")"
ok "multi-package changed lint uses sequential owning partitions and caches"

: > "$repo/eslint.log"
set +e
output="$(STUB_ESLINT_FAIL_TARGET=packages/server/src/app.ts \
  STUB_ESLINT_FAIL_EXIT=2 run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "changed partition fatal status should propagate as exit 2: $output"
[ "$(wc -l < "$repo/eslint.log")" -eq 4 ] \
  || fail "a changed partition failure should not hide later diagnostics: $(cat "$repo/eslint.log")"
grep -qF '<scripts/tool.ts>' "$repo/eslint.log" \
  || fail "remainder should still run after a server partition failure: $(cat "$repo/eslint.log")"
ok "changed lint aggregates partition failures without skipping later scopes"

repo="$(new_repo staged-jsonc-change)"
mkdir -p "$repo/packages/server/src/data"
printf '{ "extends": "./base.json" }\n' > "$repo/packages/server/src/data/tsconfig.jsonc"
git -C "$repo" add packages/server/src/data/tsconfig.jsonc
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged JSONC change should run lint"
expected="stub eslint <--max-warnings=0> <--no-warn-ignored>$(eslint_cache_log_args "$repo" server) <--> <packages/server/src/data/tsconfig.jsonc>"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "staged JSONC change should lint JSONC file: $(cat "$repo/eslint.log")"
ok "staged JSONC changes are selected for ESLint"

repo="$(new_json_lint_repo staged-json-duplicate-key)"
mkdir -p "$repo/packages/server/src/data"
printf '{ "name": "one", "name": "two" }\n' > "$repo/packages/server/src/data/duplicate.json"
git -C "$repo" add packages/server/src/data/duplicate.json
set +e
output="$(run_lint_changed_real_eslint "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "staged JSON duplicate key should fail lint:changed"
grep -qF 'packages/server/src/data/duplicate.json' <<< "$output" \
  || fail "JSON lint failure should name staged JSON file: $output"
grep -qF 'json/no-duplicate-keys' <<< "$output" \
  || fail "JSON lint failure should report json/no-duplicate-keys: $output"
ok "staged JSON duplicate keys fail lint:changed"

repo="$(new_repo staged-shell-change)"
cat > "$repo/scripts/new-hook.sh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "ok"
SH
git -C "$repo" add scripts/new-hook.sh
: > "$repo/eslint.log"
: > "$repo/shellcheck.log"
run_lint_changed "$repo" >/dev/null || fail "staged shell change should run ShellCheck"
expected='stub shellcheck <--external-sources> <--severity=info> <--exclude=SC1091,SC2015,SC2016,SC2030,SC2031,SC2317> <scripts/new-hook.sh>'
[ "$(cat "$repo/shellcheck.log")" = "$expected" ] \
  || fail "staged shell change should shellcheck only staged shell file: $(cat "$repo/shellcheck.log")"
[ ! -s "$repo/eslint.log" ] \
  || fail "shell-only change should not invoke eslint: $(cat "$repo/eslint.log")"
ok "staged shell-only changes run ShellCheck"

repo="$(new_repo staged-workflow-change)"
printf 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n' > "$repo/.github/workflows/ci.yml"
git -C "$repo" add .github/workflows/ci.yml
: > "$repo/eslint.log"
: > "$repo/config-sensors.log"
run_lint_changed "$repo" >/dev/null || fail "staged workflow change should run config sensors"
expected='stub config sensors <--changed> <main>'
[ "$(cat "$repo/config-sensors.log")" = "$expected" ] \
  || fail "staged workflow change should run changed config sensors: $(cat "$repo/config-sensors.log")"
[ ! -s "$repo/eslint.log" ] \
  || fail "workflow-only change should not invoke eslint: $(cat "$repo/eslint.log")"
ok "staged workflow-only changes run config sensors"

repo="$(new_repo staged-unsupported-change)"
printf 'notes\n' > "$repo/notes.md"
git -C "$repo" add notes.md
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "staged unsupported change should not fail: $output"
grep -qF 'no staged/base changed lintable files vs main' <<< "$output" \
  || fail "unsupported staged change should announce no lintable files: $output"
[ ! -s "$repo/eslint.log" ] \
  || fail "unsupported staged change should not invoke eslint: $(cat "$repo/eslint.log")"
ok "unsupported staged files are not selected for ESLint"

repo="$(new_repo staged-shellcheck-failure)"
cat > "$repo/scripts/bad-hook.sh" <<'SH'
#!/usr/bin/env bash
echo $1
SH
git -C "$repo" add scripts/bad-hook.sh
: > "$repo/eslint.log"
: > "$repo/shellcheck.log"
set +e
output="$(STUB_SHELLCHECK_EXIT=1 run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "ShellCheck failure should fail lint:changed"
grep -qF 'lint:shell: checking 1 staged/base changed maintained shell file' <<< "$output" \
  || fail "ShellCheck failure should announce changed shell check: $output"
grep -qF 'lint:changed: ShellCheck failed with exit 1' <<< "$output" \
  || fail "ShellCheck failure should be aggregated by lint:changed: $output"
[ ! -s "$repo/eslint.log" ] \
  || fail "shell-only ShellCheck failure should not invoke eslint: $(cat "$repo/eslint.log")"
ok "ShellCheck failures fail lint:changed without eslint files"

repo="$(new_repo import-cycles-failure)"
: > "$repo/eslint.log"
: > "$repo/import-cycles.log"
set +e
output="$(STUB_IMPORT_CYCLES_EXIT=1 run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "import-cycles failure should fail lint:changed"
grep -qF 'lint:changed: import cycles failed with exit 1' <<< "$output" \
  || fail "import-cycles failure should be aggregated by lint:changed: $output"
ok "runtime import-cycle floor failures fail lint:changed"

repo="$(new_repo staged-shell-and-source-failures)"
cat > "$repo/scripts/bad-hook.sh" <<'SH'
#!/usr/bin/env bash
echo $1
SH
printf 'changed\n' > "$repo/packages/server/src/app.ts"
git -C "$repo" add scripts/bad-hook.sh packages/server/src/app.ts
: > "$repo/eslint.log"
: > "$repo/shellcheck.log"
set +e
output="$(STUB_SHELLCHECK_EXIT=1 STUB_ESLINT_EXIT=2 run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "combined ShellCheck/ESLint failures should fail lint:changed"
grep -qF 'lint:changed: ShellCheck failed with exit 1' <<< "$output" \
  || fail "combined failure should report ShellCheck exit: $output"
grep -qF 'lint:changed: ESLint failed with exit 2' <<< "$output" \
  || fail "combined failure should report ESLint exit: $output"
[ -s "$repo/eslint.log" ] \
  || fail "combined ShellCheck/ESLint failure should still invoke eslint"
ok "lint:changed reports all failing parallel substeps"

repo="$(new_repo unstaged-source-change)"
printf 'unstaged\n' > "$repo/packages/server/src/app.ts"
: > "$repo/eslint.log"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "unstaged source change should fail"
assert_stage_or_inspect_failure "$output" "packages/server/src/app.ts"
[ ! -s "$repo/eslint.log" ] \
  || fail "unstaged source change should fail before invoking eslint: $(cat "$repo/eslint.log")"
ok "unstaged tracked source changes fail fast"

repo="$(new_repo untracked-source-change)"
printf 'untracked\n' > "$repo/packages/server/src/new-file.ts"
: > "$repo/eslint.log"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "untracked source file should fail"
assert_stage_or_inspect_failure "$output" "packages/server/src/new-file.ts"
[ ! -s "$repo/eslint.log" ] \
  || fail "untracked source file should fail before invoking eslint: $(cat "$repo/eslint.log")"
ok "untracked source files fail fast"

repo="$(new_repo partially-staged-source-change)"
printf 'staged\nbase\nbase\n' > "$repo/packages/server/src/app.ts"
git -C "$repo" add packages/server/src/app.ts
printf 'staged\nbase\nunstaged\n' > "$repo/packages/server/src/app.ts"
: > "$repo/eslint.log"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "partially staged source change should fail"
assert_stage_or_inspect_failure "$output" "packages/server/src/app.ts"
[ ! -s "$repo/eslint.log" ] \
  || fail "partially staged source change should fail before invoking eslint: $(cat "$repo/eslint.log")"
ok "partially staged source changes fail fast"

repo="$(new_repo staged-rename-unstaged-edit)"
git -C "$repo" mv packages/server/src/app.ts packages/server/src/renamed.ts
printf 'renamed with unstaged edit\n' > "$repo/packages/server/src/renamed.ts"
: > "$repo/eslint.log"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "staged rename with unstaged edit should fail"
assert_stage_or_inspect_failure "$output" "packages/server/src/renamed.ts"
[ ! -s "$repo/eslint.log" ] \
  || fail "staged rename with unstaged edit should fail before invoking eslint: $(cat "$repo/eslint.log")"
ok "staged rename plus unstaged source edit fails fast"

repo="$(new_repo spaced-path)"
printf 'space\n' > "$repo/packages/server/src/file with spaces.ts"
git -C "$repo" add "packages/server/src/file with spaces.ts"
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged source path with spaces should run lint"
expected="stub eslint <--max-warnings=0> <--no-warn-ignored>$(eslint_cache_log_args "$repo" server) <--> <packages/server/src/file with spaces.ts>"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "source path with spaces should be passed as one eslint argument: $(cat "$repo/eslint.log")"
ok "paths with spaces are linted safely"

repo="$(new_repo staged-deleted-source)"
git -C "$repo" rm -q packages/server/src/app.ts
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "deleted source should not fail lint: $output"
grep -qF 'no staged/base changed lintable files vs main' <<< "$output" \
  || fail "deleted lintable file should announce no lintable files: $output"
[ ! -s "$repo/eslint.log" ] \
  || fail "deleted source should not invoke eslint: $(cat "$repo/eslint.log")"
ok "deleted lintable files are not passed to ESLint"

repo="$(new_repo eslint-config-change)"
printf 'export default [{ rules: {} }];\n' > "$repo/eslint.config.js"
git -C "$repo" add eslint.config.js
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "eslint config change should run lint: $output"
grep -qF 'lint-affecting staged/base config changed' <<< "$output" \
  || fail "eslint config change should announce full lint: $output"
expected="$(eslint_full_partition_log "$repo")"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint config change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint config changes force full lint"

repo="$(new_repo eslint-rule-change)"
printf 'changed rule\n' > "$repo/eslint-rules/example.js"
git -C "$repo" add eslint-rules/example.js
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "eslint rule change should run lint"
expected="$(eslint_full_partition_log "$repo")"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint rule change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint rule changes force full lint"

repo="$(new_repo tsconfig-change)"
printf '{ "compilerOptions": {} }\n' > "$repo/tsconfig.json"
git -C "$repo" add tsconfig.json
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "tsconfig change should run lint"
expected="$(eslint_full_partition_log "$repo")"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "tsconfig change should run full lint: $(cat "$repo/eslint.log")"
ok "tsconfig changes force full lint"

for trigger_path in \
  package.json \
  bun.lock \
  .yamllint.yml \
  packages/server/package.json \
  packages/server/tsconfig.json; do
  repo="$(new_repo "full-trigger-${trigger_path//\//-}")"
  mkdir -p "$repo/$(dirname "$trigger_path")"
  printf '{"trigger":"%s"}\n' "$trigger_path" > "$repo/$trigger_path"
  git -C "$repo" add "$trigger_path"
  : > "$repo/eslint.log"
  output="$(run_lint_changed "$repo")" || fail "$trigger_path change should run lint: $output"
  grep -qF 'lint-affecting staged/base config changed' <<< "$output" \
    || fail "$trigger_path change should announce full lint: $output"
  expected="$(eslint_full_partition_log "$repo")"
  [ "$(cat "$repo/eslint.log")" = "$expected" ] \
    || fail "$trigger_path change should run full lint: $(cat "$repo/eslint.log")"
  ok "$trigger_path changes force full lint"
done

repo="$SANDBOX/no-main"
mkdir -p \
  "$repo/scripts" \
  "$repo/scripts/lib" \
  "$repo/scripts/path-policy" \
  "$repo/scripts/harness" \
  "$repo/scripts/lint-ratchet" \
  "$repo/eslint-config" \
  "$repo/packages/shared/dist/dice" \
  "$repo/packages/shared/dist/map" \
  "$repo/packages/shared/dist/rules" \
  "$repo/packages/shared/dist/schemas" \
  "$repo/packages/shared/dist/test" \
  "$repo/packages/server/dist/routers"
git -C "$SANDBOX" init -q "$repo"
cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
cp "$PARALLEL_RUNNER" "$repo/scripts/lib/parallel-runner.sh"
cp "$ESLINT_MAIN_CACHE" "$repo/scripts/lib/eslint-main-cache.sh"
cp "$ESLINT_MAIN_CACHE_CORE" "$repo/scripts/lib/eslint-main-cache.ts"
cp "$PROCESS_ARGV" "$repo/scripts/lib/process-argv.ts"
cp "$ESLINT_MAIN_PARTITIONS" "$repo/scripts/lib/eslint-main-partitions.sh"
cp "$ESLINT_MAIN_RUNNER" "$repo/scripts/eslint-main.sh"
cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
cp "$VERIFY_COMMIT_QUEUE" "$repo/scripts/lib/verify-commit-queue.sh"
cp "$VERIFY_FAST_COMMIT" "$repo/scripts/lib/verify-fast-commit.sh"
cp "$VERIFY_MARKERS" "$repo/scripts/lib/verify-markers.sh"
cp "$VERIFY_PATH_POLICY" "$repo/scripts/lib/verify-path-policy.sh"
cp "$VERIFY_RUN_META" "$repo/scripts/lib/verify-run-meta.sh"
cp "$VERIFY_STATE_PATHS" "$repo/scripts/lib/verify-state-paths.sh"
cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
cp "$CHANGED_LINTABLE_FILES" "$repo/scripts/lib/changed-lintable-files.sh"
cp "$LINT_DIST_PREFLIGHT" "$repo/scripts/lib/lint-dist-preflight.sh"
cp "$GATE_ENV" "$repo/scripts/lib/gate-env.sh"
cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
cp "$SEGMENT_PATTERN" "$repo/scripts/path-policy/segment-pattern.ts"
cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
  "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
cp "$SMOKE_TEST_FILES" "$repo/scripts/path-policy/smoke-test-files.ts"
cp "$HARNESS_PATHS" "$repo/scripts/harness/harness-paths.ts"
cp "$HARNESS_MANIFEST" "$repo/scripts/harness/harness-manifest.ts"
# harness-manifest.ts narrows the manifest JSON through the shared record
# guards in scripts/lib/records.ts, so the sandbox closure needs that leaf too.
cp "$RECORDS" "$repo/scripts/lib/records.ts"
cp "$LINT_RATCHET_PATHS" "$repo/scripts/lint-ratchet/paths.ts"
# @musi/lint-ratchet engine moved to the package (leaf 02 S3); the copied
# adapter/generators import it, so resolve it via a scoped node_modules
# symlink instead of copying the moved leaf file.
mkdir -p "$repo/node_modules/@musi"
[ -e "$repo/node_modules/@musi/lint-ratchet" ] || ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"
cp "$CONFIG_SURFACES" "$repo/eslint-config/config-surfaces.js"
cp "$CONFIG_SURFACE_MANIFEST" "$repo/eslint-config/config-surface-manifest.json"
cp "$PATH_GLOB_POLICY" "$repo/eslint-config/path-glob-policy.js"
cat > "$repo/scripts/lint-config-sensors.sh" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub config sensors'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${CONFIG_SENSOR_LOG:-/dev/null}"
exit "${STUB_CONFIG_SENSOR_EXIT:-0}"
STUB
cat > "$repo/scripts/lint-import-cycles.sh" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub import cycles'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${IMPORT_CYCLES_LOG:-/dev/null}"
exit "${STUB_IMPORT_CYCLES_EXIT:-0}"
STUB
touch "$repo/packages/shared/dist/constants.d.ts"
touch "$repo/packages/shared/dist/logging-policy.d.ts"
touch "$repo/packages/shared/dist/dice/dice-roller.d.ts"
touch "$repo/packages/shared/dist/map/drawing.d.ts"
touch "$repo/packages/shared/dist/rules/attack-damage.d.ts"
touch "$repo/packages/shared/dist/schemas/auth.d.ts"
touch "$repo/packages/shared/dist/test/parse-helpers.d.ts"
touch "$repo/packages/server/dist/routers/app-router.d.ts"
git -C "$repo" add scripts/eslint-main.sh scripts/lint-changed.sh scripts/lint-shell.sh scripts/lib/parallel-runner.sh scripts/lint-config-sensors.sh scripts/lint-import-cycles.sh scripts/lib/eslint-main-cache.sh scripts/lib/eslint-main-cache.ts scripts/lib/process-argv.ts scripts/lib/eslint-main-partitions.sh scripts/lib/verify-metadata.sh scripts/lib/verify-commit-queue.sh scripts/lib/verify-fast-commit.sh scripts/lib/verify-markers.sh scripts/lib/verify-path-policy.sh scripts/lib/verify-run-meta.sh scripts/lib/verify-state-paths.sh scripts/lib/changed-base.sh scripts/lib/changed-lintable-files.sh scripts/lib/lint-dist-preflight.sh scripts/lib/gate-env.sh scripts/path-policy/path-policy-query.ts scripts/path-policy/path-policy-query-core.ts scripts/path-policy/segment-pattern.ts scripts/path-policy/path-policy.ts scripts/path-policy/path-policy-smoke-subjects.ts scripts/path-policy/path-policy-smoke-subjects-data.ts scripts/path-policy/smoke-test-files.ts scripts/harness/harness-paths.ts scripts/harness/harness-manifest.ts scripts/lib/records.ts scripts/lint-ratchet/paths.ts eslint-config/config-surfaces.js eslint-config/config-surface-manifest.json eslint-config/path-glob-policy.js packages/shared/dist/constants.d.ts packages/shared/dist/logging-policy.d.ts packages/shared/dist/dice/dice-roller.d.ts packages/shared/dist/map/drawing.d.ts packages/shared/dist/rules/attack-damage.d.ts packages/shared/dist/schemas/auth.d.ts packages/shared/dist/test/parse-helpers.d.ts packages/server/dist/routers/app-router.d.ts
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo" 2>&1)" || fail "missing base should fall back to full lint: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
expected="$(eslint_full_partition_log "$repo")"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "missing base should run full lint: $(cat "$repo/eslint.log")"
ok "missing base ref falls back to full lint"

# Disjoint history: `main` resolves but shares no ancestor with HEAD, so the
# triple-dot diff would fatal inside process substitution. Expect the same
# loud full-scan fallback as the missing-ref case.
repo="$(new_repo orphan-branch)"
git -C "$repo" checkout -q --orphan orphan
git -C "$repo" commit -qm orphan-seed
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo" 2>&1)" || fail "disjoint base should fall back to full lint: $output"
grep -qF "'main' shares no history with HEAD" <<< "$output" \
  || fail "disjoint base fallback should be announced: $output"
expected="$(eslint_full_partition_log "$repo")"
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "disjoint base should run full lint: $(cat "$repo/eslint.log")"
ok "base with no common ancestor falls back to full lint"

repo="$(new_repo selector-crash)"
printf 'process.exit(73);\n' > "$repo/scripts/path-policy/path-policy-query.ts"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "lint:changed selector crash should exit 2 (got $exit_code): $output"
grep -qF 'path selection failed' <<< "$output" \
  || fail "lint:changed selector crash should report selection failure: $output"
ok "lint:changed distinguishes selector failure from an empty selection"

printf 'lint-changed tests passed (%d)\n' "$PASS"
