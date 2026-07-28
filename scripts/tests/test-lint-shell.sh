#!/usr/bin/env bash
# smoke-order: 230
# smoke-subjects: scripts/lint-shell.sh
# smoke-subjects: scripts/lib/parallel-runner.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/lib/changed-lintable-files.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/lint-ratchet/paths.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-lint-shell.sh
# smoke-subjects: package.json
# smoke-subjects: bun.lock
# smoke-subjects: scripts/lib/eslint-main-cache.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/lint-dist-preflight.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/lint-changed.sh
# smoke-subjects: eslint-config/config-surface-manifest.json
# smoke-subjects: eslint-config/config-surfaces.js
# smoke-subjects: eslint-config/max-lines-exceptions-codec.js
# smoke-subjects: eslint-config/max-lines-exceptions.baseline.json
# smoke-subjects: eslint-config/shared-policy.js
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects-data.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects.ts
# Pure-shell smoke tests for scripts/lint-shell.sh and its changed-lint wiring.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LINT_SHELL="$SCRIPT_DIR/../lint-shell.sh"
LINT_CHANGED="$SCRIPT_DIR/../lint-changed.sh"
PARALLEL_RUNNER="$SCRIPT_DIR/../lib/parallel-runner.sh"
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree via the MUSI_VERIFY_META_CORE seam.
export MUSI_VERIFY_META_CORE="$SCRIPT_DIR/../lib/verify-metadata-core.ts"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
CHANGED_LINTABLE_FILES="$SCRIPT_DIR/../lib/changed-lintable-files.sh"
LINT_DIST_PREFLIGHT="$SCRIPT_DIR/../lib/lint-dist-preflight.sh"
ESLINT_MAIN_CACHE="$SCRIPT_DIR/../lib/eslint-main-cache.sh"
GATE_ENV="$SCRIPT_DIR/../lib/gate-env.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"
PATH_POLICY_SMOKE_SUBJECTS_DATA="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects-data.ts"
HARNESS_PATHS="$SCRIPT_DIR/../harness/harness-paths.ts"
HARNESS_MANIFEST="$SCRIPT_DIR/../harness/harness-manifest.ts"
RECORDS="$SCRIPT_DIR/../lib/records.ts"
LINT_RATCHET_PATHS="$SCRIPT_DIR/../lint-ratchet/paths.ts"
CONFIG_SURFACES="$REPO_ROOT/eslint-config/config-surfaces.js"
CONFIG_SURFACE_MANIFEST="$REPO_ROOT/eslint-config/config-surface-manifest.json"
SHARED_POLICY="$REPO_ROOT/eslint-config/shared-policy.js"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

if command -v shellcheck >/dev/null 2>&1; then
  SHELLCHECK_BIN="$(command -v shellcheck)"
else
  fail "shellcheck unavailable; install shellcheck with your system package manager (dnf/apt/brew)"
fi

SANDBOX="$(mktemp -d /tmp/musi-lint-shell-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/scripts/lib" "$repo/scripts/path-policy" \
    "$repo/scripts/harness" "$repo/scripts/lint-ratchet" "$repo/eslint-config" "$repo/.husky"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$LINT_SHELL" "$repo/scripts/lint-shell.sh"
  cp "$LINT_CHANGED" "$repo/scripts/lint-changed.sh"
  cp "$PARALLEL_RUNNER" "$repo/scripts/lib/parallel-runner.sh"
  cp "$VERIFY_METADATA" "$repo/scripts/lib/verify-metadata.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
  cp "$CHANGED_LINTABLE_FILES" "$repo/scripts/lib/changed-lintable-files.sh"
  cp "$LINT_DIST_PREFLIGHT" "$repo/scripts/lib/lint-dist-preflight.sh"
  cp "$ESLINT_MAIN_CACHE" "$repo/scripts/lib/eslint-main-cache.sh"
  cp "$GATE_ENV" "$repo/scripts/lib/gate-env.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
    "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
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
  cp "$SHARED_POLICY" "$repo/eslint-config/shared-policy.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions-codec.js" "$repo/eslint-config/max-lines-exceptions-codec.js"
  cp "$REPO_ROOT/eslint-config/max-lines-exceptions.baseline.json" "$repo/eslint-config/max-lines-exceptions.baseline.json"
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

repo="$(new_repo info-violation)"
cat > "$repo/scripts/info-bad.sh" <<'SH'
#!/usr/bin/env bash
prefix="$1"
path="$2"
printf '%s\n' "${path#$prefix/}"
SH
set +e
output="$(run_lint_shell "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "full ShellCheck should fail on info-severity SC2295 violation"
grep -qF 'SC2295' <<< "$output" \
  || fail "full ShellCheck output should report SC2295: $output"
ok "full ShellCheck fails on info-severity SC2295 violation"

repo="$(new_repo info-excluded)"
cat > "$repo/scripts/info-noisy.sh" <<'SH'
#!/usr/bin/env bash
cleanup() { rm -f /tmp/musi-lint-shell-fixture; }
trap cleanup EXIT
printf '%s\n' 'literal $dollar text'
exit 0
printf '%s\n' "unreachable"
SH
run_lint_shell "$repo" >/dev/null \
  || fail "excluded info codes (SC2317, SC2016) should not fail ShellCheck"
ok "excluded info codes still pass ShellCheck"

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

repo="$(new_repo changed-verify-family-violation)"
mkdir -p "$repo/scripts/verify"
cat > "$repo/scripts/verify/bad.sh" <<'SH'
#!/usr/bin/env bash
cd /tmp
pwd
SH
git -C "$repo" add scripts/verify/bad.sh
set +e
output="$(run_lint_shell "$repo" --changed main 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "changed ShellCheck should fail on staged verify-family violation"
grep -qF 'checking 1 staged/base changed maintained shell file' <<< "$output" \
  || fail "changed ShellCheck should report one changed verify-family shell file: $output"
grep -qF 'scripts/verify/bad.sh' <<< "$output" \
  || fail "changed ShellCheck output should name verify-family script: $output"
ok "changed ShellCheck discovers scripts/verify shell files"

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

repo="$(new_repo selector-crash)"
printf 'process.exit(73);\n' > "$repo/scripts/path-policy/path-policy-query.ts"
set +e
output="$(run_lint_shell "$repo" 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "lint:shell selector crash should exit 2 (got $exit_code): $output"
grep -qF 'path selection failed' <<< "$output" \
  || fail "lint:shell selector crash should report selection failure: $output"
grep -qF 'no maintained shell files found' <<< "$output" \
  && fail "lint:shell selector crash should not report an empty selection: $output"
ok "lint:shell distinguishes selector failure from an empty selection"

repo="$(new_repo git-collector-crash)"
mkdir -p "$repo/failing-git-bin"
cat > "$repo/failing-git-bin/git" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "ls-files" ]; then
  printf 'injected git ls-files failure\n' >&2
  exit 73
fi
exec "${REAL_GIT:?}" "$@"
STUB
chmod +x "$repo/failing-git-bin/git"
set +e
output=$(
  cd "$repo"
  REAL_GIT="$(command -v git)" PATH="$repo/failing-git-bin:$PATH" \
    bash scripts/lint-shell.sh 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] \
  || fail "lint:shell git collector crash should exit 2 (got $exit_code): $output"
grep -qF 'injected git ls-files failure' <<< "$output" \
  || fail "lint:shell git collector fixture did not reach ls-files: $output"
grep -qF 'path selection failed' <<< "$output" \
  || fail "lint:shell git collector crash should report selection failure: $output"
grep -qF 'no maintained shell files found' <<< "$output" \
  && fail "lint:shell git collector crash should not report an empty selection: $output"
ok "lint:shell propagates git collector failure"

printf 'lint-shell tests passed (%d)\n' "$PASS"
