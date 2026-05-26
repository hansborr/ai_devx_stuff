#!/usr/bin/env bash
# Pure-shell smoke tests for scripts/lint-shell.sh and its changed-lint wiring.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./test-git-env.sh
. "$SCRIPT_DIR/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LINT_SHELL="$SCRIPT_DIR/lint-shell.sh"
LINT_CHANGED="$SCRIPT_DIR/lint-changed.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/parallel-runner.sh"
VERIFY_METADATA="$SCRIPT_DIR/verify-metadata.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/path-policy-smoke-subjects.ts"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

if command -v shellcheck >/dev/null 2>&1; then
  SHELLCHECK_BIN="$(command -v shellcheck)"
else
  fail "shellcheck unavailable; install with apt install shellcheck"
fi

SANDBOX="$(mktemp -d /tmp/musi-lint-shell-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/.husky"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
  cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/parallel-runner.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/verify-metadata.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy-smoke-subjects.ts"
  cat > "$repo/scripts/lint-config-sensors.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  cat > "$repo/scripts/good.sh" <<'SH'
#!/usr/bin/env bash
set -u
printf '%s\n' "ok"
SH
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_lint_shell() {
  local repo="$1"; shift
  (
    cd "$repo"
    bash scripts/lint-shell.sh "$@"
  )
}

bash -n "$LINT_SHELL" || fail "lint-shell.sh fails bash -n"
ok "lint-shell.sh passes bash -n"

bash -n "$PARALLEL_RUNNER" || fail "parallel-runner.sh fails bash -n"
ok "parallel-runner.sh passes bash -n"

[ "$SHELLCHECK_BIN" != "$REPO_ROOT/node_modules/.bin/shellcheck" ] \
  || fail "shellcheck smoke test should use system PATH binary"
ok "shellcheck smoke test uses system PATH binary"

repo="$(new_repo stale-shellcheck-wrapper)"
mkdir -p "$repo/node_modules/.bin"
cat > "$repo/node_modules/.bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
printf 'stale npm shellcheck wrapper used\n' >&2
exit 99
STUB
chmod +x "$repo/node_modules/.bin/shellcheck"
set +e
output="$(PATH="$repo/node_modules/.bin:$PATH" run_lint_shell "$repo" 2>&1)"
exit_code=$?
set -e
rm -f "$repo/node_modules/.bin/shellcheck"
[ "$exit_code" -eq 0 ] \
  || fail "stale node_modules shellcheck wrapper should be ignored: $output"
grep -qF 'stale npm shellcheck wrapper used' <<< "$output" \
  && fail "stale node_modules shellcheck wrapper should not run: $output"
ok "lint-shell ignores stale node_modules shellcheck wrapper"

repo="$(new_repo clean)"
run_lint_shell "$repo" >/dev/null || fail "clean maintained shell set should pass ShellCheck"
ok "clean maintained shell set passes ShellCheck"

repo="$(new_repo full-violation)"
cat > "$repo/scripts/bad.sh" <<'SH'
#!/usr/bin/env bash
cd /tmp
pwd
SH
set +e
output="$(run_lint_shell "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "full ShellCheck should fail on fixture violation"
grep -qF 'SC2164' <<< "$output" \
  || fail "full ShellCheck output should report SC2164: $output"
grep -qF 'scripts/bad.sh' <<< "$output" \
  || fail "full ShellCheck output should name fixture script: $output"
ok "full ShellCheck fails on known violation"

repo="$(new_repo changed-violation)"
cat > "$repo/scripts/bad.sh" <<'SH'
#!/usr/bin/env bash
cd /tmp
pwd
SH
git -C "$repo" add scripts/bad.sh
set +e
output="$(run_lint_shell "$repo" --changed main 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "changed ShellCheck should fail on staged fixture violation"
grep -qF 'checking 1 staged/base changed maintained shell file' <<< "$output" \
  || fail "changed ShellCheck should report one changed shell file: $output"
grep -qF 'SC2164' <<< "$output" \
  || fail "changed ShellCheck output should report SC2164: $output"
ok "changed ShellCheck fails on known staged violation"

repo="$(new_repo changed-deleted-shell)"
git -C "$repo" rm -q scripts/good.sh
output="$(run_lint_shell "$repo" --changed main)" \
  || fail "changed ShellCheck should skip deleted shell files: $output"
grep -qF 'no staged/base changed maintained shell files vs main' <<< "$output" \
  || fail "deleted shell file should leave changed ShellCheck empty: $output"
ok "changed ShellCheck skips deleted maintained shell files"

repo="$(new_repo lint-changed-wiring)"
mkdir -p "$repo/bin"
cat > "$repo/bin/eslint" <<'STUB'
#!/usr/bin/env bash
printf 'eslint should not run for shell-only failure\n' >> "${ESLINT_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$repo/bin/eslint"
cat > "$repo/scripts/bad-hook.sh" <<'SH'
#!/usr/bin/env bash
cd /tmp
pwd
SH
git -C "$repo" add scripts/bad-hook.sh
: > "$repo/eslint.log"
set +e
output="$(
  cd "$repo"
  ESLINT_LOG="$repo/eslint.log" \
    PATH="$repo/bin:$PATH" \
    bash scripts/lint-changed.sh main 2>&1
)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "lint:changed should fail when changed ShellCheck fails"
grep -qF 'SC2164' <<< "$output" \
  || fail "lint:changed ShellCheck output should report SC2164: $output"
grep -qF 'lint:changed: ShellCheck failed with exit' <<< "$output" \
  || fail "lint:changed should aggregate the ShellCheck failure: $output"
[ ! -s "$repo/eslint.log" ] \
  || fail "lint:changed should not invoke eslint for shell-only violation"
ok "lint-changed wiring fails on changed shell violation without eslint files"

printf 'lint-shell tests passed (%d)\n' "$PASS"
