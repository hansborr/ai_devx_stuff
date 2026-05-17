#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/lint-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT_CHANGED="$SCRIPT_DIR/lint-changed.sh"
VERIFY_METADATA="$SCRIPT_DIR/verify-metadata.sh"

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
  cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
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

assert_stage_or_stash_failure() {
  local output="$1"
  local file="$2"
  grep -qF 'source-relevant unstaged or untracked changes' <<< "$output" \
    || fail "diagnostic should name source-relevant unstaged/untracked changes: $output"
  grep -qF "$file" <<< "$output" \
    || fail "diagnostic should name offending file $file: $output"
  grep -qF 'stage' <<< "$output" \
    || fail "diagnostic should tell the user to stage the file: $output"
  grep -qF 'stash' <<< "$output" \
    || fail "diagnostic should tell the user to stash unrelated work: $output"
}

bash -n "$LINT_CHANGED" || fail "lint-changed.sh fails bash -n"
ok "lint-changed.sh passes bash -n"

repo="$(new_repo clean)"
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "clean repo should not fail: $output"
grep -qF 'no staged/base changed lintable files vs main' <<< "$output" \
  || fail "clean repo should announce no changed lintable files: $output"
[ ! -s "$repo/eslint.log" ] || fail "clean repo should not invoke eslint: $(cat "$repo/eslint.log")"
ok "clean repo skips eslint"

repo="$(new_repo staged-source-change)"
printf 'changed\n' > "$repo/packages/server/src/app.ts"
git -C "$repo" add packages/server/src/app.ts
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged source change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <--no-warn-ignored> <packages/server/src/app.ts>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "staged source change should lint only staged source file: $(cat "$repo/eslint.log")"
ok "staged source-only changes lint staged files"

repo="$(new_repo unstaged-source-change)"
printf 'unstaged\n' > "$repo/packages/server/src/app.ts"
: > "$repo/eslint.log"
set +e
output="$(run_lint_changed "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "unstaged source change should fail"
assert_stage_or_stash_failure "$output" "packages/server/src/app.ts"
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
assert_stage_or_stash_failure "$output" "packages/server/src/new-file.ts"
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
assert_stage_or_stash_failure "$output" "packages/server/src/app.ts"
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
assert_stage_or_stash_failure "$output" "packages/server/src/renamed.ts"
[ ! -s "$repo/eslint.log" ] \
  || fail "staged rename with unstaged edit should fail before invoking eslint: $(cat "$repo/eslint.log")"
ok "staged rename plus unstaged source edit fails fast"

repo="$(new_repo spaced-path)"
printf 'space\n' > "$repo/packages/server/src/file with spaces.ts"
git -C "$repo" add "packages/server/src/file with spaces.ts"
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged source path with spaces should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <--no-warn-ignored> <packages/server/src/file with spaces.ts>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "source path with spaces should be passed as one eslint argument: $(cat "$repo/eslint.log")"
ok "paths with spaces are linted safely"

repo="$(new_repo eslint-config-change)"
printf 'export default [{ rules: {} }];\n' > "$repo/eslint.config.js"
git -C "$repo" add eslint.config.js
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo")" || fail "eslint config change should run lint: $output"
grep -qF 'lint-affecting staged/base config changed' <<< "$output" \
  || fail "eslint config change should announce full lint: $output"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint config change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint config changes force full lint"

repo="$(new_repo eslint-rule-change)"
printf 'changed rule\n' > "$repo/eslint-rules/example.js"
git -C "$repo" add eslint-rules/example.js
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "eslint rule change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "eslint rule change should run full lint: $(cat "$repo/eslint.log")"
ok "eslint rule changes force full lint"

repo="$(new_repo tsconfig-change)"
printf '{ "compilerOptions": {} }\n' > "$repo/tsconfig.json"
git -C "$repo" add tsconfig.json
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "tsconfig change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "tsconfig change should run full lint: $(cat "$repo/eslint.log")"
ok "tsconfig changes force full lint"

repo="$SANDBOX/no-main"
mkdir -p "$repo/scripts"
git -C "$SANDBOX" init -q "$repo"
cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
git -C "$repo" add scripts/lint-changed.sh scripts/verify-metadata.sh
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo" 2>&1)" || fail "missing base should fall back to full lint: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "missing base should run full lint: $(cat "$repo/eslint.log")"
ok "missing base ref falls back to full lint"

printf 'lint-changed tests passed (%d)\n' "$PASS"
