#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/lint-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./test-git-env.sh
. "$SCRIPT_DIR/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINT_CHANGED="$SCRIPT_DIR/lint-changed.sh"
LINT_SHELL="$SCRIPT_DIR/lint-shell.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/parallel-runner.sh"
LINT_CONFIG_SENSORS="$SCRIPT_DIR/lint-config-sensors.sh"
VERIFY_METADATA="$SCRIPT_DIR/verify-metadata.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/path-policy-smoke-subjects.ts"

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
  mkdir -p "$repo/scripts" "$repo/packages/server/src" "$repo/eslint-rules" "$repo/.github/workflows"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
  cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/parallel-runner.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy-smoke-subjects.ts"
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
  printf 'export default [];\n' > "$repo/eslint.config.js"
  printf 'name: CI\non: push\njobs: {}\n' > "$repo/.github/workflows/ci.yml"
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

new_json_lint_repo() {
  local name="$1"
  local repo

  repo="$(new_repo "$name")"
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
      STUB_SHELLCHECK_EXIT="${STUB_SHELLCHECK_EXIT:-0}" \
      STUB_CONFIG_SENSOR_EXIT="${STUB_CONFIG_SENSOR_EXIT:-0}" \
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

bash -n "$PARALLEL_RUNNER" || fail "parallel-runner.sh fails bash -n"
ok "parallel-runner.sh passes bash -n"

bash -n "$LINT_SHELL" || fail "lint-shell.sh fails bash -n"
ok "lint-shell.sh passes bash -n"

bash -n "$LINT_CONFIG_SENSORS" || fail "lint-config-sensors.sh fails bash -n"
ok "lint-config-sensors.sh passes bash -n"

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

repo="$(new_repo staged-jsonc-change)"
mkdir -p "$repo/packages/server/src/data"
printf '{ "extends": "./base.json" }\n' > "$repo/packages/server/src/data/tsconfig.jsonc"
git -C "$repo" add packages/server/src/data/tsconfig.jsonc
: > "$repo/eslint.log"
run_lint_changed "$repo" >/dev/null || fail "staged JSONC change should run lint"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <--no-warn-ignored> <packages/server/src/data/tsconfig.jsonc>'
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
expected='stub shellcheck <--external-sources> <--severity=warning> <scripts/new-hook.sh>'
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
  expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
  [ "$(cat "$repo/eslint.log")" = "$expected" ] \
    || fail "$trigger_path change should run full lint: $(cat "$repo/eslint.log")"
  ok "$trigger_path changes force full lint"
done

repo="$SANDBOX/no-main"
mkdir -p "$repo/scripts"
git -C "$SANDBOX" init -q "$repo"
cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
cp "$PARALLEL_RUNNER" "$repo/scripts/parallel-runner.sh"
cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy-query.ts"
cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy-query-core.ts"
cp "$PATH_POLICY" "$repo/scripts/path-policy.ts"
cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy-smoke-subjects.ts"
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
git -C "$repo" add scripts/lint-changed.sh scripts/lint-shell.sh scripts/parallel-runner.sh scripts/lint-config-sensors.sh scripts/verify-metadata.sh scripts/path-policy-query.ts scripts/path-policy-query-core.ts scripts/path-policy.ts scripts/path-policy-smoke-subjects.ts
: > "$repo/eslint.log"
output="$(run_lint_changed "$repo" 2>&1)" || fail "missing base should fall back to full lint: $output"
grep -qF "neither 'main' nor 'origin/main' exists" <<< "$output" \
  || fail "missing base fallback should be announced: $output"
expected='stub eslint <--cache> <--cache-location> <node_modules/.cache/eslint/> <--max-warnings=0> <.>'
[ "$(cat "$repo/eslint.log")" = "$expected" ] \
  || fail "missing base should run full lint: $(cat "$repo/eslint.log")"
ok "missing base ref falls back to full lint"

printf 'lint-changed tests passed (%d)\n' "$PASS"
