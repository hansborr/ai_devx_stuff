#!/usr/bin/env bash
# smoke-order: 200
# smoke-subjects: scripts/lint.sh
# smoke-subjects: scripts/eslint-main.sh
# smoke-subjects: scripts/lint-changed.sh
# smoke-subjects: scripts/lib/eslint-main-partitions.sh
# smoke-subjects: scripts/lib/eslint-main-cache.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/lib/tool-memory-admission.sh
# smoke-subjects: scripts/lib/test-worker-count.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/parallel-runner.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/verify/memory-budget.sh
# smoke-subjects: scripts/verify/admitted-command.sh
# smoke-subjects: scripts/process-tree.sh
# smoke-subjects: scripts/tests/test-lint-dist-preflight.sh
# smoke-subjects: packages/shared/package.json
# smoke-subjects: packages/server/package.json
# Smoke test for the lint TypeScript-build prerequisite preflight.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
ESLINT_MAIN_CACHE="$SCRIPT_DIR/../lib/eslint-main-cache.sh"
ESLINT_MAIN_PARTITIONS="$SCRIPT_DIR/../lib/eslint-main-partitions.sh"
ESLINT_MAIN_RUNNER="$SCRIPT_DIR/../eslint-main.sh"
LINT_WRAPPER="$SCRIPT_DIR/../lint.sh"
LINT_CHANGED_WRAPPER="$SCRIPT_DIR/../lint-changed.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/../lib/parallel-runner.sh"
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
CHANGED_LINTABLE_FILES="$SCRIPT_DIR/../lib/changed-lintable-files.sh"
GATE_ENV="$SCRIPT_DIR/../lib/gate-env.sh"
TOOL_MEMORY_ADMISSION="$SCRIPT_DIR/../lib/tool-memory-admission.sh"
TEST_WORKER_COUNT="$SCRIPT_DIR/../lib/test-worker-count.sh"
MEMORY_BUDGET="$SCRIPT_DIR/../verify/memory-budget.sh"
ADMITTED_COMMAND="$SCRIPT_DIR/../verify/admitted-command.sh"
PROCESS_TREE="$SCRIPT_DIR/../process-tree.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"
PATH_POLICY_SMOKE_SUBJECTS_DATA="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects-data.ts"
HARNESS_PATHS="$SCRIPT_DIR/../harness/harness-paths.ts"
HARNESS_MANIFEST="$SCRIPT_DIR/../harness/harness-manifest.ts"
LINT_RATCHET_PATHS="$SCRIPT_DIR/../lint-ratchet/paths.ts"
LINT_RATCHET_METRICS_TYPES="$SCRIPT_DIR/../lint-ratchet/metrics-types.ts"
CONFIG_SURFACES="$REPO_ROOT/eslint-config/config-surfaces.js"
CONFIG_SURFACE_MANIFEST="$REPO_ROOT/eslint-config/config-surface-manifest.json"
SHARED_POLICY="$REPO_ROOT/eslint-config/shared-policy.js"
PACKAGE_SCRIPTS="$REPO_ROOT/package.json"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$HELPER" || fail "lint-dist-preflight.sh fails bash -n"
ok "lint-dist-preflight.sh passes bash -n"

bash -n "$ESLINT_MAIN_CACHE" || fail "eslint-main-cache.sh fails bash -n"
ok "eslint-main-cache.sh passes bash -n"

bash -n "$ESLINT_MAIN_PARTITIONS" || fail "eslint-main-partitions.sh fails bash -n"
ok "eslint-main-partitions.sh passes bash -n"

bash -n "$ESLINT_MAIN_RUNNER" || fail "eslint-main.sh fails bash -n"
ok "eslint-main.sh passes bash -n"

bash -n "$LINT_WRAPPER" || fail "lint.sh fails bash -n"
ok "lint.sh passes bash -n"

if awk '!/^[[:space:]]*#/' \
    "$LINT_WRAPPER" "$ESLINT_MAIN_RUNNER" "$LINT_CHANGED_WRAPPER" \
    "$ESLINT_MAIN_CACHE" "$ESLINT_MAIN_PARTITIONS" "$PACKAGE_SCRIPTS" \
    | grep -Eq -- '--concurrency(=|[^[:alnum:]_-]|$)'; then
  fail "main lint entrypoints must never enable ESLint concurrency; see lint memory profile note 73"
fi
ok "all main lint entrypoints statically reject ESLint concurrency flags"

# shellcheck source=/dev/null
. "$ESLINT_MAIN_PARTITIONS"

[ "${MUSI_ESLINT_MAIN_PARTITIONS[*]}" = "shared server client remainder" ] \
  || fail "full lint partitions must keep measured sequential order: ${MUSI_ESLINT_MAIN_PARTITIONS[*]}"

for fixture in \
  "packages/shared/src/schema.ts:shared" \
  "packages/server/src/router.ts:server" \
  "packages/client/src/app.tsx:client" \
  "packages/shared/vitest.config.ts:remainder" \
  "packages/server/scripts/pgexec.ts:remainder" \
  "scripts/lint-ratchet.ts:remainder" \
  "eslint.config.js:remainder"; do
  path="${fixture%:*}"
  expected_partition="${fixture##*:}"
  actual_partition="$(musi_eslint_main_partition_for_path "$path")"
  [ "$actual_partition" = "$expected_partition" ] \
    || fail "$path should select $expected_partition, got $actual_partition"
done
ok "partition selection isolates only package src trees"

musi_eslint_main_full_partition_args remainder
[ "${MUSI_ESLINT_MAIN_PARTITION_ARGS[*]}" = \
  ". --ignore-pattern packages/shared/src/** --ignore-pattern packages/server/src/** --ignore-pattern packages/client/src/**" ] \
  || fail "remainder must cover dot while excluding each package src tree: ${MUSI_ESLINT_MAIN_PARTITION_ARGS[*]}"
ok "full partition targets are disjoint and leave root/config surfaces in remainder"

bash -n "$LINT_CHANGED_WRAPPER" || fail "lint-changed.sh fails bash -n"
ok "lint-changed.sh passes bash -n"

# shellcheck source=/dev/null
. "$HELPER"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-dist-preflight-smoke-XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

make_repo() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p \
    "$repo/packages/shared/dist/dice" \
    "$repo/packages/shared/dist/map" \
    "$repo/packages/shared/dist/rules" \
    "$repo/packages/shared/dist/schemas" \
    "$repo/packages/shared/dist/test" \
    "$repo/packages/server/dist/routers"
  touch "$repo/packages/shared/dist/constants.d.ts"
  touch "$repo/packages/shared/dist/dice/dice-roller.d.ts"
  touch "$repo/packages/shared/dist/map/drawing.d.ts"
  touch "$repo/packages/shared/dist/rules/attack-damage.d.ts"
  touch "$repo/packages/shared/dist/schemas/auth.d.ts"
  touch "$repo/packages/shared/dist/test/parse-helpers.d.ts"
  touch "$repo/packages/server/dist/routers/app-router.d.ts"
}

expect_preflight_ok() {
  local label="$1" repo="$2"
  if ! musi_lint_dist_preflight "$repo" >"$ROOT/$label.out" 2>"$ROOT/$label.err"; then
    printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$ROOT/$label.out")" "$(cat "$ROOT/$label.err")"
    fail "$label expected preflight success"
  fi
  [ ! -s "$ROOT/$label.out" ] || fail "$label expected empty stdout"
  [ ! -s "$ROOT/$label.err" ] || fail "$label expected empty stderr"
}

expect_preflight_repair() {
  local label="$1" repo="$2" missing="$3"
  local log="$ROOT/$label.typecheck.log"
  : > "$log"
  if ! REAL_BUN="$(command -v bun)" TYPECHECK_LOG="$log" PATH="$ROOT/bin:$PATH" \
      musi_lint_dist_preflight "$repo" >"$ROOT/$label.out" 2>"$ROOT/$label.err"; then
    printf 'stdout:\n%s\nstderr:\n%s\n' "$(cat "$ROOT/$label.out")" "$(cat "$ROOT/$label.err")"
    fail "$label expected preflight repair success"
  fi
  [ ! -s "$ROOT/$label.out" ] || fail "$label expected empty stdout"
  grep -qF "lint: TypeScript build output is missing; running \`bun run typecheck\` before ESLint." "$ROOT/$label.err" \
    || fail "$label missing action diagnostic"
  grep -qF "$missing" "$ROOT/$label.err" \
    || fail "$label missing path detail"
  [ "$(cat "$log")" = "stub bun run typecheck" ] \
    || fail "$label should run typecheck once: $(cat "$log")"
  musi_lint_dist_outputs_present "$repo" \
    || fail "$label expected typecheck stub to create required dist outputs"
}

expect_preflight_typecheck_failure() {
  local label="$1" repo="$2" missing="$3"
  local rc log="$ROOT/$label.typecheck.log"
  : > "$log"
  set +e
  REAL_BUN="$(command -v bun)" STUB_TYPECHECK_EXIT=1 TYPECHECK_LOG="$log" PATH="$ROOT/bin:$PATH" \
    musi_lint_dist_preflight "$repo" >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label expected preflight failure"
  grep -qF "lint: TypeScript build output is missing; running \`bun run typecheck\` before ESLint." "$ROOT/$label.err" \
    || fail "$label missing action diagnostic"
  grep -qF "$missing" "$ROOT/$label.err" \
    || fail "$label missing path detail"
  grep -qF 'lint: `bun run typecheck` failed; fix typecheck before lint.' "$ROOT/$label.err" \
    || fail "$label missing failed typecheck diagnostic"
  [ "$(cat "$log")" = "stub bun run typecheck" ] \
    || fail "$label should run typecheck once: $(cat "$log")"
}

expect_preflight_unrepaired_typecheck() {
  local label="$1" repo="$2" missing="$3"
  local rc log="$ROOT/$label.typecheck.log"
  : > "$log"
  set +e
  REAL_BUN="$(command -v bun)" STUB_TYPECHECK_MODE=noop TYPECHECK_LOG="$log" PATH="$ROOT/bin:$PATH" \
    musi_lint_dist_preflight "$repo" >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label expected preflight failure"
  grep -qF 'lint: `bun run typecheck` completed, but required build output is still missing.' "$ROOT/$label.err" \
    || fail "$label missing post-typecheck failure diagnostic"
  grep -qF "$missing" "$ROOT/$label.err" \
    || fail "$label missing path detail"
  grep -qF 'compare each missing path with the owning package tsconfig `outDir`, `declaration`, `composite`, and project references' "$ROOT/$label.err" \
    || fail "$label missing tsconfig remedy"
  [ "$(cat "$log")" = "stub bun run typecheck" ] \
    || fail "$label should run typecheck once: $(cat "$log")"
}

install_bun_stub() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/bun" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = run ] && [ "${2:-}" = typecheck ]; then
  {
    printf 'stub bun'
    for arg in "$@"; do
      printf ' %s' "$arg"
    done
    printf '\n'
  } >> "${TYPECHECK_LOG:?}"
  if [ "${STUB_TYPECHECK_EXIT:-0}" != "0" ]; then
    exit "$STUB_TYPECHECK_EXIT"
  fi
  if [ "${STUB_TYPECHECK_MODE:-repair}" = repair ]; then
    mkdir -p \
      packages/shared/dist/dice \
      packages/shared/dist/map \
      packages/shared/dist/rules \
      packages/shared/dist/schemas \
      packages/shared/dist/test \
      packages/server/dist/routers
    touch packages/shared/dist/constants.d.ts
    touch packages/shared/dist/dice/dice-roller.d.ts
    touch packages/shared/dist/map/drawing.d.ts
    touch packages/shared/dist/rules/attack-damage.d.ts
    touch packages/shared/dist/schemas/auth.d.ts
    touch packages/shared/dist/test/parse-helpers.d.ts
    touch packages/server/dist/routers/app-router.d.ts
  fi
  exit 0
fi
exec "${REAL_BUN:?}" "$@"
STUB
  chmod +x "$bin_dir/bun"
}

install_eslint_stub() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/eslint" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub eslint'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${ESLINT_LOG:?}"
for arg in "$@"; do
  if [ -n "${STUB_ESLINT_FAIL_TARGET:-}" ] && [ "$arg" = "$STUB_ESLINT_FAIL_TARGET" ]; then
    exit "${STUB_ESLINT_FAIL_EXIT:-1}"
  fi
done
exit 0
STUB
  chmod +x "$bin_dir/eslint"
}

install_lint_support_stubs() {
  local repo="$1"
  cat > "$repo/scripts/lint-shell.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$repo/scripts/lint-config-sensors.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  cat > "$repo/scripts/lint-import-cycles.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$repo/scripts/lint-shell.sh" "$repo/scripts/lint-config-sensors.sh" \
    "$repo/scripts/lint-import-cycles.sh"
}

copy_path_policy() {
  local repo="$1"
  mkdir -p "$repo/scripts/path-policy" "$repo/scripts/harness" "$repo/scripts/lint-ratchet" \
    "$repo/eslint-config"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
    "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
  cp "$HARNESS_PATHS" "$repo/scripts/harness/harness-paths.ts"
  cp "$HARNESS_MANIFEST" "$repo/scripts/harness/harness-manifest.ts"
  cp "$LINT_RATCHET_PATHS" "$repo/scripts/lint-ratchet/paths.ts"
  cp "$LINT_RATCHET_METRICS_TYPES" "$repo/scripts/lint-ratchet/metrics-types.ts"
  cp "$CONFIG_SURFACES" "$repo/eslint-config/config-surfaces.js"
  cp "$CONFIG_SURFACE_MANIFEST" "$repo/eslint-config/config-surface-manifest.json"
  cp "$SHARED_POLICY" "$repo/eslint-config/shared-policy.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions-codec.js" "$repo/eslint-config/max-lines-exceptions-codec.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions.baseline.json" "$repo/eslint-config/max-lines-exceptions.baseline.json"
}

copy_lint_changed_dependencies() {
  local repo="$1"
  mkdir -p "$repo/scripts/lib"
  cp "$LINT_CHANGED_WRAPPER" "$repo/scripts/lint-changed.sh"
  cp "$HELPER" "$repo/scripts/lib/lint-dist-preflight.sh"
  cp "$ESLINT_MAIN_CACHE" "$repo/scripts/lib/eslint-main-cache.sh"
  cp "$ESLINT_MAIN_PARTITIONS" "$repo/scripts/lib/eslint-main-partitions.sh"
  cp "$ESLINT_MAIN_RUNNER" "$repo/scripts/eslint-main.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/lib/parallel-runner.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
  cp "$CHANGED_LINTABLE_FILES" "$repo/scripts/lib/changed-lintable-files.sh"
  cp "$GATE_ENV" "$repo/scripts/lib/gate-env.sh"
  install_lint_support_stubs "$repo"
  copy_path_policy "$repo"
}

new_lint_changed_repo() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p "$repo/packages/server/src"
  git -C "$ROOT" init -q -b main "$repo"
  copy_lint_changed_dependencies "$repo"
  printf 'export const base = 1;\n' > "$repo/packages/server/src/app.ts"
  printf '{}\n' > "$repo/package.json"
  git -C "$repo" config user.email smoke@example.com
  git -C "$repo" config user.name Smoke
  git -C "$repo" add .
  git -C "$repo" commit -qm base
}

expect_wrapper_repair_then_eslint() {
  local label="$1" repo="$2"
  shift 2
  local eslint_log="$ROOT/$label.eslint.log"
  local typecheck_log="$ROOT/$label.typecheck.log"
  : > "$eslint_log"
  : > "$typecheck_log"
  (
    cd "$repo"
    ESLINT_LOG="$eslint_log" REAL_BUN="$(command -v bun)" TYPECHECK_LOG="$typecheck_log" PATH="$ROOT/bin:$PATH" "$@"
  ) >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  grep -qF "lint: TypeScript build output is missing; running \`bun run typecheck\` before ESLint." "$ROOT/$label.err" \
    || fail "$label missing action diagnostic"
  [ "$(cat "$typecheck_log")" = "stub bun run typecheck" ] \
    || fail "$label should run typecheck once: $(cat "$typecheck_log")"
  [ -s "$eslint_log" ] || fail "$label should run eslint after repairing dist outputs"
}

expect_wrapper_typecheck_failure() {
  local label="$1" repo="$2"
  shift 2
  local rc eslint_log="$ROOT/$label.eslint.log"
  local typecheck_log="$ROOT/$label.typecheck.log"
  : > "$eslint_log"
  : > "$typecheck_log"
  set +e
  (
    cd "$repo"
    STUB_TYPECHECK_EXIT=1 ESLINT_LOG="$eslint_log" REAL_BUN="$(command -v bun)" TYPECHECK_LOG="$typecheck_log" PATH="$ROOT/bin:$PATH" "$@"
  ) >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label expected wrapper typecheck failure"
  grep -qF 'lint: `bun run typecheck` failed; fix typecheck before lint.' "$ROOT/$label.err" \
    || fail "$label missing failed typecheck diagnostic"
  [ ! -s "$eslint_log" ] || fail "$label should fail before eslint runs: $(cat "$eslint_log")"
}

REPO_OK="$ROOT/ok"
make_repo "$REPO_OK"
expect_preflight_ok "ok" "$REPO_OK"
ok "all required dist outputs pass"

install_bun_stub "$ROOT/bin"

REPO_SHARED_MISSING="$ROOT/shared-missing"
make_repo "$REPO_SHARED_MISSING"
rm "$REPO_SHARED_MISSING/packages/shared/dist/constants.d.ts"
expect_preflight_repair "shared-missing" "$REPO_SHARED_MISSING" "packages/shared/dist/constants.d.ts"
ok "missing shared dist output runs typecheck before lint"

REPO_SERVER_MISSING="$ROOT/server-missing"
make_repo "$REPO_SERVER_MISSING"
rm "$REPO_SERVER_MISSING/packages/server/dist/routers/app-router.d.ts"
expect_preflight_repair "server-missing" "$REPO_SERVER_MISSING" "packages/server/dist/routers/app-router.d.ts"
ok "missing server router type output runs typecheck before lint"

REPO_TYPECHECK_FAIL="$ROOT/typecheck-fail"
make_repo "$REPO_TYPECHECK_FAIL"
rm "$REPO_TYPECHECK_FAIL/packages/shared/dist/constants.d.ts"
expect_preflight_typecheck_failure "typecheck-fail" "$REPO_TYPECHECK_FAIL" "packages/shared/dist/constants.d.ts"
ok "typecheck failure keeps lint blocked"

REPO_TYPECHECK_NO_OUTPUT="$ROOT/typecheck-no-output"
make_repo "$REPO_TYPECHECK_NO_OUTPUT"
rm "$REPO_TYPECHECK_NO_OUTPUT/packages/shared/dist/constants.d.ts"
expect_preflight_unrepaired_typecheck "typecheck-no-output" "$REPO_TYPECHECK_NO_OUTPUT" "packages/shared/dist/constants.d.ts"
ok "successful typecheck without dist output names the tsconfig remedy"

install_eslint_stub "$ROOT/bin"

install_lint_memory_support() {
  local repo="$1"
  mkdir -p "$repo/scripts/lib" "$repo/scripts/verify"
  cp "$TOOL_MEMORY_ADMISSION" "$repo/scripts/lib/tool-memory-admission.sh"
  cp "$TEST_WORKER_COUNT" "$repo/scripts/lib/test-worker-count.sh"
  cp "$MEMORY_BUDGET" "$repo/scripts/verify/memory-budget.sh"
  cp "$ADMITTED_COMMAND" "$repo/scripts/verify/admitted-command.sh"
  cp "$PROCESS_TREE" "$repo/scripts/process-tree.sh"
}

REPO_LINT_WRAPPER="$ROOT/lint-wrapper"
mkdir -p "$REPO_LINT_WRAPPER/scripts/lib"
cp "$LINT_WRAPPER" "$REPO_LINT_WRAPPER/scripts/lint.sh"
cp "$HELPER" "$REPO_LINT_WRAPPER/scripts/lib/lint-dist-preflight.sh"
cp "$ESLINT_MAIN_CACHE" "$REPO_LINT_WRAPPER/scripts/lib/eslint-main-cache.sh"
cp "$ESLINT_MAIN_PARTITIONS" "$REPO_LINT_WRAPPER/scripts/lib/eslint-main-partitions.sh"
cp "$ESLINT_MAIN_RUNNER" "$REPO_LINT_WRAPPER/scripts/eslint-main.sh"
cp "$PARALLEL_RUNNER" "$REPO_LINT_WRAPPER/scripts/lib/parallel-runner.sh"
cp "$GATE_ENV" "$REPO_LINT_WRAPPER/scripts/lib/gate-env.sh"
install_lint_memory_support "$REPO_LINT_WRAPPER"
install_lint_support_stubs "$REPO_LINT_WRAPPER"
expect_wrapper_repair_then_eslint "lint-wrapper" "$REPO_LINT_WRAPPER" bash scripts/lint.sh
ok "lint.sh repairs missing dist outputs before eslint"

[ "$(wc -l < "$ROOT/lint-wrapper.eslint.log")" -eq 4 ] \
  || fail "full lint should invoke four ESLint partitions: $(cat "$ROOT/lint-wrapper.eslint.log")"
mapfile -t lint_partition_calls < "$ROOT/lint-wrapper.eslint.log"
for index_and_target in \
  "0:<packages/shared/src>" \
  "1:<packages/server/src>" \
  "2:<packages/client/src>" \
  "3:<.>"; do
  index="${index_and_target%%:*}"
  target="${index_and_target#*:}"
  grep -qF "$target" <<< "${lint_partition_calls[$index]}" \
    || fail "partition $index should target $target: ${lint_partition_calls[$index]}"
done
ok "lint.sh runs all four partitions in measured sequential order"

for partition in shared server client remainder; do
  grep -qF "/$partition.eslintcache>" "$ROOT/lint-wrapper.eslint.log" \
    || fail "full lint should use the isolated $partition cache: $(cat "$ROOT/lint-wrapper.eslint.log")"
done
ok "full lint uses one content cache per partition"

expect_full_lint_args_rejected() {
  local label="$1"
  shift
  local output rc

  : > "$ROOT/lint-wrapper.eslint.log"
  set +e
  output="$(
    (
      cd "$REPO_LINT_WRAPPER"
      ESLINT_LOG="$ROOT/lint-wrapper.eslint.log" PATH="$ROOT/bin:$PATH" "$@"
    ) 2>&1
  )"
  rc=$?
  set -e

  [ "$rc" -eq 2 ] \
    || fail "$label should fail with usage exit 2, got $rc: $output"
  grep -qF 'partitioned full lint accepts no forwarded ESLint arguments' <<< "$output" \
    || fail "$label should explain the fail-closed argument contract: $output"
  [ ! -s "$ROOT/lint-wrapper.eslint.log" ] \
    || fail "$label should fail before invoking any ESLint partition: $(cat "$ROOT/lint-wrapper.eslint.log")"
}

expect_full_lint_args_rejected "lint positional target" \
  bash scripts/lint.sh packages/server/src/app.ts
ok "lint.sh rejects positional targets before partitioning"

expect_full_lint_args_rejected "full runner output file" \
  bash scripts/eslint-main.sh --full --output-file report.json
ok "full runner rejects output files that partitions would overwrite"

expect_full_lint_args_rejected "full runner JSON stdout" \
  bash scripts/eslint-main.sh --full --format json
ok "full runner rejects JSON stdout that would contain multiple arrays"

: > "$ROOT/lint-wrapper.eslint.log"
set +e
(
  cd "$REPO_LINT_WRAPPER"
  ESLINT_LOG="$ROOT/lint-wrapper.eslint.log" \
    STUB_ESLINT_FAIL_TARGET="packages/server/src" \
    STUB_ESLINT_FAIL_EXIT=1 \
    PATH="$ROOT/bin:$PATH" \
    bash scripts/eslint-main.sh --full
)
partition_exit=$?
set -e
[ "$partition_exit" -eq 1 ] \
  || fail "partitioned lint should preserve ESLint diagnostic exit 1, got $partition_exit"
[ "$(wc -l < "$ROOT/lint-wrapper.eslint.log")" -eq 4 ] \
  || fail "diagnostic failure should not hide later partition diagnostics"
ok "partitioned lint aggregates all scopes and preserves diagnostic exit 1"

: > "$ROOT/lint-wrapper.eslint.log"
set +e
(
  cd "$REPO_LINT_WRAPPER"
  ESLINT_LOG="$ROOT/lint-wrapper.eslint.log" \
    STUB_ESLINT_FAIL_TARGET="packages/client/src" \
    STUB_ESLINT_FAIL_EXIT=2 \
    PATH="$ROOT/bin:$PATH" \
    bash scripts/eslint-main.sh --full
)
partition_exit=$?
set -e
[ "$partition_exit" -eq 2 ] \
  || fail "partitioned lint should preserve ESLint fatal exit 2, got $partition_exit"
ok "partitioned lint preserves fatal ESLint exit 2"

if grep -q -- '<--concurrency' "$ROOT/lint-wrapper.eslint.log"; then
  fail "main ESLint lane must remain serial per lint memory profile note 73: $(cat "$ROOT/lint-wrapper.eslint.log")"
fi
ok "lint.sh never adds an ESLint concurrency flag"

REPO_LINT_WRAPPER_FAIL="$ROOT/lint-wrapper-fail"
mkdir -p "$REPO_LINT_WRAPPER_FAIL/scripts/lib"
cp "$LINT_WRAPPER" "$REPO_LINT_WRAPPER_FAIL/scripts/lint.sh"
cp "$HELPER" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/lint-dist-preflight.sh"
cp "$ESLINT_MAIN_CACHE" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/eslint-main-cache.sh"
cp "$ESLINT_MAIN_PARTITIONS" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/eslint-main-partitions.sh"
cp "$ESLINT_MAIN_RUNNER" "$REPO_LINT_WRAPPER_FAIL/scripts/eslint-main.sh"
cp "$PARALLEL_RUNNER" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/parallel-runner.sh"
cp "$GATE_ENV" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/gate-env.sh"
install_lint_memory_support "$REPO_LINT_WRAPPER_FAIL"
install_lint_support_stubs "$REPO_LINT_WRAPPER_FAIL"
expect_wrapper_typecheck_failure "lint-wrapper-fail" "$REPO_LINT_WRAPPER_FAIL" bash scripts/lint.sh
ok "lint.sh blocks eslint when typecheck repair fails"

REPO_CHANGED_SOURCE="$ROOT/lint-changed-source"
new_lint_changed_repo "$REPO_CHANGED_SOURCE"
printf 'export const base = 2;\n' > "$REPO_CHANGED_SOURCE/packages/server/src/app.ts"
git -C "$REPO_CHANGED_SOURCE" add packages/server/src/app.ts
expect_wrapper_repair_then_eslint "lint-changed-source" "$REPO_CHANGED_SOURCE" bash scripts/lint-changed.sh main
ok "lint:changed source path repairs missing dist outputs before eslint"

REPO_CHANGED_FULL="$ROOT/lint-changed-full"
new_lint_changed_repo "$REPO_CHANGED_FULL"
printf 'export default [];\n' > "$REPO_CHANGED_FULL/eslint.config.js"
git -C "$REPO_CHANGED_FULL" add eslint.config.js
expect_wrapper_repair_then_eslint "lint-changed-full" "$REPO_CHANGED_FULL" bash scripts/lint-changed.sh main
ok "lint:changed full fallback repairs missing dist outputs before eslint"
