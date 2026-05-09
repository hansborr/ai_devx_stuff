#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/lint-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT_CHANGED="$SCRIPT_DIR/lint-changed.sh"

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
exit "${STUB_ESLINT_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/eslint"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/packages/server/src" "$repo/eslint-rules"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
  printf 'export default [];\n' > "$repo/eslint.config.js"
  printf 'base\n' > "$repo/packages/server/src/app.ts"
  printf 'rule\n' > "$repo/eslint-rules/example.js"
  printf '{}\n' > "$repo/package.json"
  printf '{}\n' > "$repo/tsconfig.json"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_lint_changed() {
  local repo="$1"; shift
  (
    cd "$repo"
    STUB_LOG="$repo/eslint.log" PATH="$SANDBOX/bin:$PATH" \
      bash scripts/lint-changed.sh "$@"
  )
}

bash -n "$LINT_CHANGED" || fail "lint-changed.sh fails bash -n"
ok "lint-changed.sh passes bash -n"

repo="$(new_repo clean)"
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "clean repo should not fail: $output"
grep -qF 'No changed lintable files vs main' <<< "$output" \
  || fail "clean repo should announce no changed lintable files: $output"
[ ! -s "$repo/eslint.log" ] || fail "clean repo should not invoke eslint: $(cat "$repo/eslint.log")"
ok "clean repo skips eslint"

repo="$(new_repo source-change)"
printf 'changed\n' > "$repo/packages/server/src/app.ts"
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "source change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--no-warn-ignored> <packages/server/src/app.ts>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "source change should lint only changed source file: $(cat "$repo/eslint.log")"
ok "source-only changes lint changed files"

repo="$(new_repo eslint-config-change)"
printf 'export default [{ rules: {} }];\n' > "$repo/eslint.config.js"
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "eslint config change should run lint: $output"
grep -qF 'lint-affecting config changed' <<< "$output" \
  || fail "eslint config change should announce full lint: $output"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint config change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint config changes force full lint"

repo="$(new_repo eslint-rule-change)"
printf 'changed rule\n' > "$repo/eslint-rules/example.js"
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "eslint rule change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint rule change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint rule changes force full lint"

repo="$(new_repo tsconfig-change)"
printf '{ "compilerOptions": {} }\n' > "$repo/tsconfig.json"
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "tsconfig change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "tsconfig change should run full lint: $(cat "$repo/eslint.log")"
ok "tsconfig changes force full lint"

repo="$SANDBOX/no-main"
mkdir -p "$repo/scripts"
git -C "$SANDBOX" init -q "$repo"
cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo" 2>&1)" || fail "missing base should fall back to full lint: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "missing base should run full lint: $(cat "$repo/eslint.log")"
ok "missing base ref falls back to full lint"

printf 'lint-changed tests passed (%d)\n' "$PASS"
