#!/usr/bin/env bash
# smoke-order: 210
# smoke-subjects: package.json
# smoke-subjects: scripts/lint-fix.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/tests/test-lint-fix-dist-preflight.sh
# smoke-subjects: packages/shared/package.json
# smoke-subjects: packages/server/package.json
# Smoke test for the lint:fix TypeScript-build prerequisite preflight.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
LINT_FIX_WRAPPER="$SCRIPT_DIR/../lint-fix.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n "$HELPER" || fail "lint-dist-preflight.sh fails bash -n"
ok "lint-dist-preflight.sh passes bash -n"

bash -n "$LINT_FIX_WRAPPER" || fail "lint-fix.sh fails bash -n"
ok "lint-fix.sh passes bash -n"

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-fix-dist-preflight-smoke-XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

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

make_required_dist_outputs() {
  local repo="$1"
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

new_lint_fix_repo() {
  local repo="$1"
  rm -rf "$repo"
  mkdir -p "$repo/scripts/lib"
  cp "$HELPER" "$repo/scripts/lib/lint-dist-preflight.sh"
  cp "$LINT_FIX_WRAPPER" "$repo/scripts/lint-fix.sh"
  printf '{"scripts":{"lint:fix":"bash scripts/lint-fix.sh"}}\n' > "$repo/package.json"
}

expect_lint_fix_blocks_missing_dist() {
  local label="$1" repo="$2"
  local rc eslint_log="$ROOT/$label.eslint.log"
  : > "$eslint_log"
  set +e
  (
    cd "$repo"
    ESLINT_LOG="$eslint_log" PATH="$ROOT/bin:$PATH" bun run lint:fix
  ) >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$label expected lint:fix to fail when dist is missing"
  grep -qF "lint: TypeScript build output is missing." "$ROOT/$label.err" \
    || fail "$label missing shared lint prerequisite diagnostic"
  if grep -qF "running \`bun run typecheck\` before ESLint" "$ROOT/$label.err"; then
    fail "$label must not claim lint:fix is running typecheck"
  fi
  grep -qF "lint: run \`bun run typecheck\` before lint:fix." "$ROOT/$label.err" \
    || fail "$label missing lint:fix prerequisite action"
  grep -qF "packages/shared/dist/constants.d.ts" "$ROOT/$label.err" \
    || fail "$label missing shared dist path detail"
  grep -qF "packages/server/dist/routers/app-router.d.ts" "$ROOT/$label.err" \
    || fail "$label missing server dist path detail"
  [ ! -s "$eslint_log" ] || fail "$label should fail before eslint runs: $(cat "$eslint_log")"
}

expect_lint_fix_runs_eslint_when_dist_present() {
  local label="$1" repo="$2"
  local eslint_log="$ROOT/$label.eslint.log"
  : > "$eslint_log"
  (
    cd "$repo"
    ESLINT_LOG="$eslint_log" PATH="$ROOT/bin:$PATH" bun run lint:fix
  ) >"$ROOT/$label.out" 2>"$ROOT/$label.err"
  [ "$(cat "$eslint_log")" = "stub eslint <.> <--fix>" ] \
    || fail "$label should run eslint . --fix: $(cat "$eslint_log")"
}

install_eslint_stub "$ROOT/bin"

REPO_MISSING="$ROOT/missing"
new_lint_fix_repo "$REPO_MISSING"
expect_lint_fix_blocks_missing_dist "missing" "$REPO_MISSING"
ok "lint:fix reports the typecheck prerequisite before eslint when dist is missing"

REPO_PRESENT="$ROOT/present"
new_lint_fix_repo "$REPO_PRESENT"
make_required_dist_outputs "$REPO_PRESENT"
expect_lint_fix_runs_eslint_when_dist_present "present" "$REPO_PRESENT"
ok "lint:fix preserves eslint-only repair when dist is present"

printf 'lint-fix dist preflight tests passed (%d)\n' "$PASS"
