#!/usr/bin/env bash
# smoke-order: 180
# smoke-subjects: .prettierignore
# smoke-subjects: .prettierrc
# smoke-subjects: scripts/format-changed.sh
# smoke-subjects: scripts/lib/changed-base.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects.ts
# smoke-subjects: scripts/path-policy/path-policy-smoke-subjects-data.ts
# smoke-subjects: scripts/harness/harness-paths.ts
# smoke-subjects: scripts/lint-ratchet/paths.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-format-changed.sh
# Pure-shell smoke tests for scripts/format-changed.sh selection behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
FORMAT_CHANGED="$SCRIPT_DIR/../format-changed.sh"
CHANGED_BASE="$SCRIPT_DIR/../lib/changed-base.sh"
PATH_POLICY_QUERY="$SCRIPT_DIR/../path-policy/path-policy-query.ts"
PATH_POLICY_QUERY_CORE="$SCRIPT_DIR/../path-policy/path-policy-query-core.ts"
PATH_POLICY="$SCRIPT_DIR/../path-policy/path-policy.ts"
PATH_POLICY_SMOKE_SUBJECTS="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects.ts"
PATH_POLICY_SMOKE_SUBJECTS_DATA="$SCRIPT_DIR/../path-policy/path-policy-smoke-subjects-data.ts"
HARNESS_PATHS="$SCRIPT_DIR/../harness/harness-paths.ts"
LINT_RATCHET_PATHS="$SCRIPT_DIR/../lint-ratchet/paths.ts"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-format-changed-test.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/prettier" <<'STUB'
#!/usr/bin/env bash
{
  printf 'stub prettier'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\n'
} >> "${PRETTIER_LOG:-/dev/null}"
exit "${STUB_PRETTIER_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/prettier"

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo/scripts" "$repo/scripts/lib" "$repo/scripts/path-policy" \
    "$repo/scripts/harness" "$repo/scripts/lint-ratchet" "$repo/packages/server/src"
  git -C "$SANDBOX" init -q -b main "$repo"
  cp "$FORMAT_CHANGED" "$repo/scripts/format-changed.sh"
  cp "$CHANGED_BASE" "$repo/scripts/lib/changed-base.sh"
  cp "$PATH_POLICY_QUERY" "$repo/scripts/path-policy/path-policy-query.ts"
  cp "$PATH_POLICY_QUERY_CORE" "$repo/scripts/path-policy/path-policy-query-core.ts"
  cp "$PATH_POLICY" "$repo/scripts/path-policy/path-policy.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS" "$repo/scripts/path-policy/path-policy-smoke-subjects.ts"
  cp "$PATH_POLICY_SMOKE_SUBJECTS_DATA" \
    "$repo/scripts/path-policy/path-policy-smoke-subjects-data.ts"
  cp "$HARNESS_PATHS" "$repo/scripts/harness/harness-paths.ts"
  cp "$LINT_RATCHET_PATHS" "$repo/scripts/lint-ratchet/paths.ts"
  printf 'const base = true;\n' > "$repo/packages/server/src/app.ts"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" add .
  git -C "$repo" commit -qm base
  printf '%s\n' "$repo"
}

run_format_changed() {
  local repo="$1"; shift
  (
    cd "$repo"
    PRETTIER_LOG="$repo/prettier.log" PATH="$SANDBOX/bin:$PATH" \
      bash scripts/format-changed.sh "$@"
  )
}

assert_prettier_arg() {
  local log="$1"
  local arg="$2"
  grep -qF "<$arg>" <<< "$log" || fail "prettier args should include $arg: $log"
}

bash -n "$FORMAT_CHANGED" || fail "format-changed.sh fails bash -n"
ok "format-changed.sh passes bash -n"

repo="$(new_repo clean)"
: > "$repo/prettier.log"
output="$(run_format_changed "$repo")" || fail "clean repo should not fail: $output"
grep -qF 'No changed files vs main' <<< "$output" \
  || fail "clean repo should announce no changed files: $output"
[ ! -s "$repo/prettier.log" ] \
  || fail "clean repo should not invoke prettier: $(cat "$repo/prettier.log")"
ok "clean repo skips Prettier"

repo="$(new_repo check-clean)"
: > "$repo/prettier.log"
output="$(run_format_changed "$repo" --check)" || fail "check mode clean repo should not fail: $output"
grep -qF 'No changed files vs main' <<< "$output" \
  || fail "check mode clean repo should announce no changed files: $output"
[ ! -s "$repo/prettier.log" ] \
  || fail "check mode clean repo should not invoke prettier: $(cat "$repo/prettier.log")"
ok "check mode on clean repo"

repo="$(new_repo staged-format-candidates)"
printf '{ "name": "musi" }\n' > "$repo/packages/server/src/data.json"
printf '{ "compilerOptions": {} }\n' > "$repo/packages/server/src/tsconfig.jsonc"
printf 'select 1;\n' > "$repo/packages/server/src/query.sql"
git -C "$repo" add packages/server/src/data.json packages/server/src/tsconfig.jsonc packages/server/src/query.sql
: > "$repo/prettier.log"
run_format_changed "$repo" >/dev/null || fail "staged format candidates should run Prettier"
log="$(cat "$repo/prettier.log")"
assert_prettier_arg "$log" "--write"
assert_prettier_arg "$log" "--ignore-unknown"
assert_prettier_arg "$log" "packages/server/src/data.json"
assert_prettier_arg "$log" "packages/server/src/tsconfig.jsonc"
assert_prettier_arg "$log" "packages/server/src/query.sql"
ok "staged JSON, JSONC, and unsupported files are passed to Prettier"

repo="$(new_repo staged-format-check)"
printf '{ "name": "musi" }\n' > "$repo/packages/server/src/data.json"
git -C "$repo" add packages/server/src/data.json
: > "$repo/prettier.log"
run_format_changed "$repo" --check >/dev/null || fail "staged format check should run Prettier"
log="$(cat "$repo/prettier.log")"
assert_prettier_arg "$log" "--check"
assert_prettier_arg "$log" "--ignore-unknown"
assert_prettier_arg "$log" "packages/server/src/data.json"
if grep -qF '<--write>' <<< "$log"; then
  fail "check mode must not pass --write to Prettier: $log"
fi
ok "check mode passes --check to prettier"

repo="$(new_repo staged-format-check-failure)"
printf '{ "name": "musi" }\n' > "$repo/packages/server/src/data.json"
git -C "$repo" add packages/server/src/data.json
: > "$repo/prettier.log"
set +e
output="$(STUB_PRETTIER_EXIT=1 run_format_changed "$repo" --check 2>&1)"
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "check mode should fail when Prettier fails: $output"
log="$(cat "$repo/prettier.log")"
assert_prettier_arg "$log" "--check"
if grep -qF '<--write>' <<< "$log"; then
  fail "failing check mode must not pass --write to Prettier: $log"
fi
ok "check mode fails on unformatted files"

repo="$(new_repo unstaged-tracked-file)"
printf 'const base = false;\n' > "$repo/packages/server/src/app.ts"
: > "$repo/prettier.log"
run_format_changed "$repo" >/dev/null || fail "unstaged tracked change should run Prettier"
log="$(cat "$repo/prettier.log")"
assert_prettier_arg "$log" "--write"
assert_prettier_arg "$log" "packages/server/src/app.ts"
ok "unstaged tracked files remain in the changed-format write set"

repo="$(new_repo deleted-file)"
printf '{ "remove": true }\n' > "$repo/packages/server/src/remove.json"
git -C "$repo" add packages/server/src/remove.json
git -C "$repo" commit -qm add-remove-target
git -C "$repo" rm -q packages/server/src/remove.json
: > "$repo/prettier.log"
output="$(run_format_changed "$repo")" || fail "deleted-only change should not fail: $output"
grep -qF 'No changed files vs main' <<< "$output" \
  || fail "deleted-only change should announce no changed files: $output"
[ ! -s "$repo/prettier.log" ] \
  || fail "deleted-only change should not invoke prettier: $(cat "$repo/prettier.log")"
ok "deleted files are skipped before invoking Prettier"

repo="$(new_repo missing-base)"
: > "$repo/prettier.log"
output="$(run_format_changed "$repo" missing-base 2>&1)" \
  || fail "missing base should fall back to full formatting: $output"
log="$(cat "$repo/prettier.log")"
[ "$log" = 'stub prettier <--write> <--ignore-unknown> <.>' ] \
  || fail "missing base should format the full repo in write mode: $log"
grep -qF "neither 'missing-base' nor 'origin/missing-base' exists" <<< "$output" \
  || fail "missing base should announce full-format fallback: $output"
ok "missing base falls back to full-repo Prettier write mode"

repo="$(new_repo missing-base-check)"
: > "$repo/prettier.log"
output="$(run_format_changed "$repo" --check missing-base 2>&1)" \
  || fail "missing base check should fall back to full formatting check: $output"
log="$(cat "$repo/prettier.log")"
[ "$log" = 'stub prettier <--check> <--ignore-unknown> <.>' ] \
  || fail "missing base should format-check the full repo in check mode: $log"
grep -qF "neither 'missing-base' nor 'origin/missing-base' exists" <<< "$output" \
  || fail "missing base check should announce full-format fallback: $output"
ok "missing base falls back to full-repo Prettier check mode"

# Disjoint history: `main` resolves but shares no ancestor with HEAD, so the
# triple-dot diff would fatal inside the collection block. Expect the same
# loud full-format fallback as the missing-ref case.
repo="$(new_repo orphan-branch)"
git -C "$repo" checkout -q --orphan orphan
git -C "$repo" commit -qm orphan-seed
: > "$repo/prettier.log"
output="$(run_format_changed "$repo" 2>&1)" \
  || fail "disjoint base should fall back to full formatting: $output"
log="$(cat "$repo/prettier.log")"
[ "$log" = 'stub prettier <--write> <--ignore-unknown> <.>' ] \
  || fail "disjoint base should format the full repo in write mode: $log"
grep -qF "'main' shares no history with HEAD" <<< "$output" \
  || fail "disjoint base should announce full-format fallback: $output"
ok "base with no common ancestor falls back to full-repo Prettier"

printf 'format-changed tests passed (%d)\n' "$PASS"
