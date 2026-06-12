#!/usr/bin/env bash
# Smoke test for the lint TypeScript-build prerequisite preflight.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
LINT_WRAPPER="$SCRIPT_DIR/../lint.sh"
LINT_CHANGED_WRAPPER="$SCRIPT_DIR/../lint-changed.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/../lib/parallel-runner.sh"
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$HELPER" || fail "lint-dist-preflight.sh fails bash -n"
ok "lint-dist-preflight.sh passes bash -n"

bash -n "$LINT_WRAPPER" || fail "lint.sh fails bash -n"
ok "lint.sh passes bash -n"

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
  chmod +x "$repo/scripts/lint-shell.sh" "$repo/scripts/lint-config-sensors.sh"
}

copy_path_policy() {
  local repo="$1"
  mkdir -p "$repo/scripts/path-policy"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
}

copy_lint_changed_dependencies() {
  local repo="$1"
  mkdir -p "$repo/scripts/lib"
  cp "$LINT_CHANGED_WRAPPER" "$repo/scripts/lint-changed.sh"
  cp "$HELPER" "$repo/scripts/lib/lint-dist-preflight.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/lib/parallel-runner.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
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

install_eslint_stub "$ROOT/bin"

REPO_LINT_WRAPPER="$ROOT/lint-wrapper"
mkdir -p "$REPO_LINT_WRAPPER/scripts/lib"
cp "$LINT_WRAPPER" "$REPO_LINT_WRAPPER/scripts/lint.sh"
cp "$HELPER" "$REPO_LINT_WRAPPER/scripts/lib/lint-dist-preflight.sh"
cp "$PARALLEL_RUNNER" "$REPO_LINT_WRAPPER/scripts/lib/parallel-runner.sh"
install_lint_support_stubs "$REPO_LINT_WRAPPER"
expect_wrapper_repair_then_eslint "lint-wrapper" "$REPO_LINT_WRAPPER" bash scripts/lint.sh
ok "lint.sh repairs missing dist outputs before eslint"

REPO_LINT_WRAPPER_FAIL="$ROOT/lint-wrapper-fail"
mkdir -p "$REPO_LINT_WRAPPER_FAIL/scripts/lib"
cp "$LINT_WRAPPER" "$REPO_LINT_WRAPPER_FAIL/scripts/lint.sh"
cp "$HELPER" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/lint-dist-preflight.sh"
cp "$PARALLEL_RUNNER" "$REPO_LINT_WRAPPER_FAIL/scripts/lib/parallel-runner.sh"
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
