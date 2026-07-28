#!/usr/bin/env bash
# smoke-order: 085
# smoke-subjects: scripts/land.sh
# smoke-subjects: scripts/prisma-client-freshness.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-land.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested

REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
TMP_ROOT=$(mktemp -d /tmp/musi-land-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT
export MUSI_PATH_POLICY_QUERY="$REPO_ROOT/scripts/path-policy/path-policy-query.ts"
export MUSI_PATH_POLICY_BUN="${MUSI_PATH_POLICY_BUN:-$(command -v bun)}"
# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree (same seam pattern as MUSI_PATH_POLICY_QUERY above).
export MUSI_VERIFY_META_CORE="$REPO_ROOT/scripts/lib/verify-metadata-core.ts"
export MUSI_VERIFY_META_BUN="${MUSI_VERIFY_META_BUN:-$(command -v bun)}"

PASS=0

ok() {
  PASS=$((PASS + 1))
  printf 'ok %d - %s\n' "$PASS" "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

new_repo() {
  local name="$1"
  local repo="$TMP_ROOT/$name"

  mkdir -p "$repo/scripts/lib"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test User"
  cp "$REPO_ROOT/scripts/land.sh" "$repo/scripts/land.sh"
  cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
  cp "$REPO_ROOT/scripts/lib/gate-env.sh" "$repo/scripts/lib/gate-env.sh"
  printf 'fixture\n' > "$repo/README.md"
  git -C "$repo" add .
  git -C "$repo" commit -qm "test: initial land fixture"
  git -C "$repo" branch -m main
  printf '%s\n' "$repo"
}

write_bun_stub() {
  local stub_dir="$1"

  mkdir -p "$stub_dir"
  cat > "$stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 2 ] && [ "$1" = "install" ] && [ "$2" = "--frozen-lockfile" ]; then
  root=$(git rev-parse --show-toplevel)
  package_dep=""
  locked_dep=""
  if [ -f "$root/package.json" ]; then
    package_dep=$(sed -n 's/.*"fixture-dependency":"\([^"]*\)".*/\1/p' "$root/package.json")
  fi
  if [ -f "$root/bun.lock" ]; then
    locked_dep=$(sed -n 's/^fixture-dependency=//p' "$root/bun.lock")
  fi
  printf 'install:%s:%s:%s\n' "$root" "${2:-<missing-flag>}" "${locked_dep:-<none>}" \
    >> "${MUSI_LAND_BUN_LOG:?}"
  if [ -n "$package_dep" ] && [ "$package_dep" != "$locked_dep" ]; then
    printf 'stub install diagnostic: package.json and bun.lock disagree\n' >&2
    exit 94
  fi
  if [ "${MUSI_LAND_INSTALL_STATUS:-0}" -ne 0 ]; then
    printf 'stub install diagnostic: forced locked install failure\n' >&2
    exit "${MUSI_LAND_INSTALL_STATUS}"
  fi
  if [ -n "$locked_dep" ]; then
    mkdir -p "$root/node_modules"
    printf '%s\n' "$locked_dep" > "$root/node_modules/.fixture-dependency"
  fi
  exit 0
fi
if [ "$#" -eq 2 ] && [ "$1" = "run" ] && [ "$2" = "harness:check" ]; then
  printf 'harness:%s\n' "$(git rev-parse --show-toplevel)" >> "${MUSI_LAND_BUN_LOG:?}"
  exit "${MUSI_LAND_HARNESS_CHECK_STATUS:-0}"
fi
if [ "$#" -eq 4 ] && [ "$1" = "run" ] && [ "$2" = "--filter" ] &&
  [ "$3" = "@musi/server" ] && [ "$4" = "prisma:generate" ]; then
  root=$(git rev-parse --show-toplevel)
  parents=$(git rev-list --parents -n 1 HEAD | awk '{print NF - 1}')
  printf 'prisma-generate:%s:%s:%s\n' "$root" "$parents" "$(git rev-parse HEAD^{tree})" \
    >> "${MUSI_LAND_BUN_LOG:?}"
  if [ "${MUSI_LAND_PRISMA_STATUS:-0}" -ne 0 ]; then
    printf 'stub prisma generate diagnostic: forced generator failure\n' >&2
    exit "${MUSI_LAND_PRISMA_STATUS}"
  fi
  exit 0
fi
if [ "$#" -eq 2 ] && [ "$1" = "run" ] && [ "$2" = "verify" ]; then
  root=$(git rev-parse --show-toplevel)
  marker="${MUSI_VERIFY_MARKER_FULL:-}"
  if [ -n "$marker" ] && [ -f "$marker" ] && [ "${FORCE_VERIFY:-}" != "1" ]; then
    # shellcheck source=/dev/null
    . "$root/scripts/lib/verify-metadata.sh"
    current_head=$(git rev-parse HEAD)
    current_hash=$(ai_worktree_fingerprint "$root")
    if musi_success_marker_matches "$marker" "$current_head" "$current_hash"; then
      printf 'verify-marker-skip:%s:%s\n' "$root" "$current_head" \
        >> "${MUSI_LAND_BUN_LOG:?}"
      exit 0
    fi
  fi
  parents=$(git rev-list --parents -n 1 HEAD | awk '{print NF - 1}')
  printf 'verify:%s:%s:%s\n' "$root" "$parents" "$(git rev-parse HEAD^{tree})" \
    >> "${MUSI_LAND_BUN_LOG:?}"
  if [ -n "${MUSI_LAND_EXPECT_FILES:-}" ]; then
    old_ifs=$IFS
    IFS=:
    for expected_file in $MUSI_LAND_EXPECT_FILES; do
      [ -e "$expected_file" ] || {
        printf 'missing expected merge-tree file: %s\n' "$expected_file" >&2
        exit 91
      }
    done
    IFS=$old_ifs
  fi
  if [ "${MUSI_LAND_VERIFY_DEP_SYNC:-0}" -eq 1 ]; then
    expected_dep=$(sed -n 's/^fixture-dependency=//p' "$root/bun.lock")
    actual_dep=$(sed -n '1p' "$root/node_modules/.fixture-dependency" 2>/dev/null || true)
    if [ "$actual_dep" != "$expected_dep" ]; then
      printf 'dependency mismatch during verify: expected %s, got %s\n' \
        "$expected_dep" "${actual_dep:-<missing>}" >&2
      exit 92
    fi
  fi
  status="${MUSI_LAND_VERIFY_STATUS:-0}"
  if [ "$status" -eq 0 ] && [ -n "${MUSI_LAND_VERIFY_MARKER:-}" ]; then
    # shellcheck source=/dev/null
    . "$root/scripts/lib/verify-metadata.sh"
    musi_write_success_marker "$MUSI_LAND_VERIFY_MARKER" "$(git rev-parse HEAD)" \
      "$(ai_worktree_fingerprint "$root")"
  fi
  if [ "$status" -eq 0 ] && [ -n "${MUSI_LAND_ADVANCE_REF:-}" ]; then
    ref="refs/heads/$MUSI_LAND_ADVANCE_REF"
    parent=$(git rev-parse "$ref")
    tree=$(git rev-parse "$parent^{tree}")
    advanced=$(printf 'test: advance %s during verify\n' "$MUSI_LAND_ADVANCE_REF" |
      git commit-tree "$tree" -p "$parent")
    git update-ref "$ref" "$advanced" "$parent"
  fi
  exit "$status"
fi
root=$(git rev-parse --show-toplevel 2>/dev/null || printf '<outside-repo>')
{
  printf 'unexpected-bun:%s' "$root"
  for arg in "$@"; do
    printf ':%q' "$arg"
  done
  printf '\n'
} >> "${MUSI_LAND_BUN_LOG:?}"
{
  printf 'stub bun diagnostic: unexpected argv'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
} >&2
exit 95
STUB
  chmod +x "$stub_dir/bun"
}

write_git_stub() {
  local stub_dir="$1"

  cat > "$stub_dir/git" <<'STUB'
#!/usr/bin/env bash
state_file="${MUSI_LAND_GIT_STATE:?}"
if [ "${MUSI_LAND_GIT_MODE:-}" = "fail-after-merge" ] &&
  [ -e "$state_file" ] && [ "$1" = "rev-parse" ] && [ "${2:-}" = "HEAD" ]; then
  printf 'injected post-merge rev-parse failure\n' >&2
  exit 77
fi

is_merge=0
is_merge_abort=0
for arg in "$@"; do
  if [ "$arg" = "merge" ]; then
    is_merge=1
  elif [ "$arg" = "--abort" ]; then
    is_merge_abort=1
  fi
done

if [ "$is_merge" -eq 1 ] && [ "$is_merge_abort" -eq 0 ] &&
  [ "$("$MUSI_LAND_REAL_GIT" symbolic-ref --short HEAD 2>/dev/null || true)" = "main" ]; then
  printf 'final-merge-attempt\n' >> "$state_file"
  final_merge_attempt=$(grep -c '^final-merge-attempt$' "$state_file")
  case "${MUSI_LAND_GIT_MODE:-}" in
    final-merge-index-lock)
      if [ "$final_merge_attempt" -le "${MUSI_LAND_GIT_FAIL_COUNT:-1}" ]; then
        printf "fatal: Unable to create '%s/.git/index.lock': File exists.\n" \
          "$("$MUSI_LAND_REAL_GIT" rev-parse --show-toplevel)" >&2
        exit 128
      fi
      ;;
    final-merge-error)
      printf 'injected non-lock final merge failure\n' >&2
      exit 88
      ;;
  esac
fi

"${MUSI_LAND_REAL_GIT:?}" "$@"
status=$?
[ "$status" -eq 0 ] || exit "$status"

if [ "$is_merge" -eq 1 ] &&
  [ "$("$MUSI_LAND_REAL_GIT" symbolic-ref --short HEAD 2>/dev/null || true)" = "main" ]; then
  case "${MUSI_LAND_GIT_MODE:-}" in
    fail-after-merge)
      : > "$state_file"
      ;;
    change-merge-tree)
      printf 'post-merge drift\n' > post-merge-drift.txt
      "$MUSI_LAND_REAL_GIT" add post-merge-drift.txt
      "$MUSI_LAND_REAL_GIT" commit --amend --no-edit --no-verify >/dev/null
      ;;
  esac
fi
STUB
  chmod +x "$stub_dir/git"
}

run_land() {
  local repo="$1"
  local stub_dir="$2"
  local stub_log="$3"
  local marker="$4"
  shift 4

  (
    cd "$repo"
    PATH="$stub_dir:$PATH" \
      MUSI_LAND_BUN_LOG="$stub_log" \
      MUSI_LAND_VERIFY_MARKER="$marker" \
      MUSI_VERIFY_MARKER_FULL="$marker" \
      MUSI_VERIFY_LOG_DIR="$TMP_ROOT/verify-log" \
      "$@" bash scripts/land.sh
  )
}

run_land_branch() {
  local repo="$1"
  local stub_dir="$2"
  local stub_log="$3"
  local marker="$4"
  local branch="$5"
  shift 5

  (
    cd "$repo"
    PATH="$stub_dir:$PATH" \
      MUSI_LAND_BUN_LOG="$stub_log" \
      MUSI_LAND_VERIFY_MARKER="$marker" \
      MUSI_VERIFY_MARKER_FULL="$marker" \
      MUSI_VERIFY_LOG_DIR="$TMP_ROOT/verify-log" \
      "$@" bash scripts/land.sh --branch "$branch"
  )
}

last_line() {
  printf '%s\n' "$1" | tail -n 1
}

assert_bun_stub_rejects() {
  local repo="$1"
  local stub="$2"
  local stub_log="$3"
  shift 3
  local expected_event="unexpected-bun:$repo"
  local arg
  local quoted_arg
  local output
  local exit_code

  for arg in "$@"; do
    printf -v quoted_arg '%q' "$arg"
    expected_event="$expected_event:$quoted_arg"
  done

  : > "$stub_log"
  set +e
  output=$(cd "$repo" && MUSI_LAND_BUN_LOG="$stub_log" "$stub" "$@" 2>&1)
  exit_code=$?
  set -e
  [ "$exit_code" -eq 95 ] \
    || fail "Bun stub should reject unexpected argv '$*' with exit 95: $output"
  [ "$(cat "$stub_log")" = "$expected_event" ] \
    || fail "Bun stub should log full unexpected argv '$*': $(cat "$stub_log")"
}

documented_contract=$(sed -n 's/^#   \([0-9][0-9]*\) \([^ ]*\) — .*$/\1 \2/p' "$REPO_ROOT/scripts/land.sh")
expected_contract=$'0 landed-verified\n1 not-landed\n2 verify-failed\n3 merged-unverified'
[ "$documented_contract" = "$expected_contract" ] \
  || fail "land.sh documented exit contract drifted: $documented_contract"
ok "land.sh documents the machine-readable exit code and token contract"

repo=$(new_repo land-bun-stub-contract)
stub_dir="$TMP_ROOT/bun-stub-contract-bin"
stub_log="$TMP_ROOT/bun-stub-contract.log"
write_bun_stub "$stub_dir"
assert_bun_stub_rejects "$repo" "$stub_dir/bun" "$stub_log" \
  install --frozen-lockfile --ignore-scripts
assert_bun_stub_rejects "$repo" "$stub_dir/bun" "$stub_log" \
  run harness:check --changed
assert_bun_stub_rejects "$repo" "$stub_dir/bun" "$stub_log" \
  run --filter @musi/server prisma:generate --watch
assert_bun_stub_rejects "$repo" "$stub_dir/bun" "$stub_log" \
  run verify --watch
assert_bun_stub_rejects "$repo" "$stub_dir/bun" "$stub_log" run unexpected:gate
ok "Bun stub rejects and records changed or unknown command shapes"

repo=$(new_repo land-dirty)
git -C "$repo" switch -qc feature
printf 'dirty\n' >> "$repo/README.md"
set +e
output=$(cd "$repo" && bash scripts/land.sh 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "dirty land should exit 1: $output"
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — inspect with git diff, then commit the worktree changes or ask the user how to preserve them before re-running land" ] \
  || fail "dirty land trailer mismatch: $output"
grep -qF "land: uncommitted changes — inspect them with git diff, then commit them or ask the user how to preserve them." <<< "$output" \
  || fail "dirty land guidance mismatch: $output"
if grep -qiF stash <<< "$output"; then
  fail "dirty land guidance must not recommend stash: $output"
fi
ok "precondition failures end with the not-landed trailer"

repo=$(new_repo land-untracked-source)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: untracked source candidate"
printf 'export const hiddenDependency = true;\n' > "$repo/scripts/untracked-helper.ts"
stub_dir="$TMP_ROOT/untracked-source-bin"
stub_log="$TMP_ROOT/untracked-source.log"
marker="$TMP_ROOT/untracked-source.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "untracked source land should exit 1: $output"
grep -qF 'land:   - scripts/untracked-helper.ts' <<< "$output" \
  || fail "untracked source diagnostic should name the dependency: $output"
[ ! -s "$stub_log" ] || fail "untracked source should fail before harness verification: $(cat "$stub_log")"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "feature" ] \
  || fail "untracked source rejection should leave the feature checked out"
ok "source-relevant untracked files fail landing before verification"

# Main in a sibling worktree is rejected before any Bun-owned verification
# work. This keeps the recovery guidance actionable and the failure immediate.
repo=$(new_repo land-sibling-main-live)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: sibling-main preflight feature"
sibling="$TMP_ROOT/land-sibling-main-live-wt"
git -C "$repo" worktree add -q "$sibling" main
stub_dir="$TMP_ROOT/sibling-main-live-bin"
stub_log="$TMP_ROOT/sibling-main-live.log"
marker="$TMP_ROOT/sibling-main-live.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "sibling-main preflight should exit 1: $output"
grep -qF "main is checked out in a sibling worktree" <<< "$output" \
  || fail "sibling-main abort should name the sibling worktree: $output"
[ ! -s "$stub_log" ] \
  || fail "sibling-main abort must happen before install or verification: $(cat "$stub_log")"
ok "main in a sibling worktree aborts before the land flow starts"

# A registered main worktree that cannot be entered is not treated as a safe
# sibling path. Fail closed before install/harness/verify and name the stale
# registration so the operator can repair it.
repo=$(new_repo land-sibling-main-stale)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: stale sibling-main preflight feature"
sibling="$TMP_ROOT/land-sibling-main-stale-wt"
git -C "$repo" worktree add -q "$sibling" main
rm -rf "$sibling"
stub_dir="$TMP_ROOT/sibling-main-stale-bin"
stub_log="$TMP_ROOT/sibling-main-stale.log"
marker="$TMP_ROOT/sibling-main-stale.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "stale sibling-main preflight should exit 1: $output"
grep -qF "cannot be entered" <<< "$output" \
  || fail "stale sibling-main abort should explain the invalid entry: $output"
grep -qF "$sibling" <<< "$output" \
  || fail "stale sibling-main abort should name the registered path: $output"
[ ! -s "$stub_log" ] \
  || fail "stale sibling-main abort must happen before install or verification: $(cat "$stub_log")"
ok "an unenterable main worktree registration fails closed before land starts"

repo=$(new_repo land-branch-arguments)
set +e
output=$(cd "$repo" && bash scripts/land.sh --branch does-not-exist 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "missing branch should exit 1: $output"
grep -qF "does not exist" <<< "$output" || fail "missing branch diagnostic drifted: $output"

git -C "$repo" switch -qc feature
set +e
output=$(cd "$repo" && bash scripts/land.sh --branch main 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "protected branch should exit 1: $output"
grep -qF "protected branch" <<< "$output" || fail "protected branch diagnostic drifted: $output"

set +e
output=$(cd "$repo" && bash scripts/land.sh --branch 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "missing --branch value should exit 1: $output"
grep -qF "requires a branch name" <<< "$output" || fail "missing --branch value diagnostic drifted: $output"

set +e
output=$(cd "$repo" && bash scripts/land.sh --bogus-flag 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "unknown argument should exit 1: $output"
grep -qF "unknown argument" <<< "$output" || fail "unknown argument diagnostic drifted: $output"

set +e
output=$(cd "$repo" && bash scripts/land.sh --branch feature 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "current branch target should exit 1: $output"
grep -qF "is the current branch" <<< "$output" || fail "current branch diagnostic drifted: $output"

git -C "$repo" switch -q main
git -C "$repo" branch land/feature feature
set +e
output=$(cd "$repo" && bash scripts/land.sh --branch feature 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "stale integration branch should exit 1: $output"
grep -qF "already exists" <<< "$output" || fail "stale integration branch diagnostic drifted: $output"
ok "branch mode validates its target and command-line contract"

# Harness freshness is the first authored preflight after the locked install.
# A stale harness is `1 not-landed`, and Prisma generation plus verify must not
# start. Keeping this exact event contract here makes this suite the sole owner
# of land's Bun-call sequence.
repo=$(new_repo land-harness-check-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: current-mode harness failure"
stub_dir="$TMP_ROOT/harness-fail-bin"
stub_log="$TMP_ROOT/harness-fail.log"
marker="$TMP_ROOT/harness-fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_HARNESS_CHECK_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "harness failure should exit 1: $output"
grep -qF "land: running harness freshness gate on feature" <<< "$output" \
  || fail "harness failure should announce the freshness gate: $output"
expected_events=$(printf 'install:%s:--frozen-lockfile:<none>\nharness:%s' "$repo" "$repo")
[ "$(cat "$stub_log")" = "$expected_events" ] \
  || fail "harness failure must stop before Prisma generation and verify: $(cat "$stub_log")"
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — regenerate the stale harness surfaces, commit them, then re-run land" ] \
  || fail "harness-failure trailer mismatch: $output"
ok "harness failure short-circuits Prisma generation and verify as not-landed"

repo=$(new_repo land-fast-path)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: fast path feature"
stub_dir="$TMP_ROOT/fast-bin"
stub_log="$TMP_ROOT/fast.log"
marker="$TMP_ROOT/fast.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "fast-path land should succeed: $output"
grep -qF "land: running harness freshness gate on feature" <<< "$output" \
  || fail "fast path should announce the harness freshness gate: $output"
grep -qF "land: running full verify on feature" <<< "$output" \
  || fail "fast path should announce the full verify: $output"
[ "$(grep -c '^verify:' "$stub_log")" -eq 1 ] || fail "fast path should verify once: $(cat "$stub_log")"
grep -qF "verify:$repo:1:" "$stub_log" || fail "fast path should verify the feature tip: $(cat "$stub_log")"
event_kinds=$(cut -d: -f1 "$stub_log")
[ "$event_kinds" = $'install\nharness\nprisma-generate\nverify\ninstall' ] \
  || fail "successful land must run its preflights in order and reconcile merged-main dependencies: $(cat "$stub_log")"
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "fast-path success trailer mismatch: $output"
ok "tree-equality fast path owns the successful preflight order and exits push-ready"

# Prisma preflight placement, branch-tip mode: the client is regenerated
# exactly once, from the same settled tree verify then runs on, and strictly
# before verify. (This fixture has no generated client, so it cannot
# distinguish unconditional regeneration from a freshness-gated one — the
# land-prisma-fresh-client fixture below pins unconditionality.)
[ "$(grep -c '^prisma-generate:' "$stub_log")" -eq 1 ] \
  || fail "fast path should regenerate the Prisma client exactly once: $(cat "$stub_log")"
generate_line=$(grep -n '^prisma-generate:' "$stub_log" | head -n1 | cut -d: -f1)
verify_line=$(grep -n '^verify:' "$stub_log" | head -n1 | cut -d: -f1)
[ "$generate_line" -lt "$verify_line" ] \
  || fail "prisma generate must run before verify: $(cat "$stub_log")"
generate_tree=$(sed -n 's/^prisma-generate:.*:1:\([0-9a-f]*\)$/\1/p' "$stub_log")
verified_tree=$(sed -n 's/^verify:.*:1:\([0-9a-f]*\)$/\1/p' "$stub_log")
[ -n "$generate_tree" ] || fail "fast path should generate from the branch tip: $(cat "$stub_log")"
[ "$generate_tree" = "$verified_tree" ] \
  || fail "prisma generate must see the exact tree verify runs on: $(cat "$stub_log")"
ok "branch-tip land regenerates the Prisma client from the verify tree before verify"

# A fresh-LOOKING generated client must not suppress regeneration. This
# builds the exact state `musi_prisma_client_freshness`
# (scripts/prisma-client-freshness.sh) reports as "fresh" — the
# packages/server/src/generated/prisma directory exists and schema.prisma is
# not newer than it — i.e. precisely what a freshness-gated "optimization"
# would skip, and the leaf rules that gate out: an mtime heuristic cannot
# prove schema-content identity. The real predicate is sourced and asserted
# below so this fixture cannot drift from the path/mtime semantics it must
# discriminate against. The dir is gitignored (as in the real repo) so the
# untracked-source preflight stays quiet.
repo=$(new_repo land-prisma-fresh-client)
mkdir -p "$repo/packages/server/prisma"
printf 'packages/server/src/generated/\n' > "$repo/.gitignore"
printf 'model Fixture { id Int @id }\n' > "$repo/packages/server/prisma/schema.prisma"
git -C "$repo" add .gitignore packages/server/prisma/schema.prisma
git -C "$repo" commit -qm "test: schema fixture for freshness pin"
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: fresh-client feature"
mkdir -p "$repo/packages/server/src/generated/prisma"
printf 'previously generated client\n' > "$repo/packages/server/src/generated/prisma/client.ts"
touch "$repo/packages/server/src/generated/prisma"
# shellcheck source=../prisma-client-freshness.sh
. "$SCRIPT_DIR/../prisma-client-freshness.sh"
freshness=$(musi_prisma_client_freshness "$repo")
case "$freshness" in
  fresh$'\t'*) : ;;
  *) fail "fixture setup: the real freshness predicate must report fresh, got: $freshness" ;;
esac
stub_dir="$TMP_ROOT/fresh-client-bin"
stub_log="$TMP_ROOT/fresh-client.log"
marker="$TMP_ROOT/fresh-client.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "fresh-client land should succeed: $output"
[ "$(grep -c '^prisma-generate:' "$stub_log")" -eq 1 ] \
  || fail "a fresh-looking generated dir must not suppress regeneration: $(cat "$stub_log")"
ok "a fresh-looking generated client does not gate the unconditional preflight"

# Frozen install rejects a landing package.json whose lockfile still pins the
# starting dependency. This is a verify-gate failure: main stays put, cleanup
# restores main's dependency tree, and verify itself never runs.
repo=$(new_repo land-dependency-install-fails)
printf '{"dependencies":{"fixture-dependency":"main"}}\n' > "$repo/package.json"
printf 'fixture-dependency=main\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: install failure fixture"
mkdir -p "$repo/node_modules"
printf 'stale-before-cleanup\n' > "$repo/node_modules/.fixture-dependency"
git -C "$repo" switch -qc feature
printf '{"dependencies":{"fixture-dependency":"landing"}}\n' > "$repo/package.json"
git -C "$repo" add package.json
git -C "$repo" commit -qm "test: inconsistent landing lock"
git -C "$repo" switch -q main
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/dependency-install-fail-bin"
stub_log="$TMP_ROOT/dependency-install-fail.log"
marker="$TMP_ROOT/dependency-install-fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "locked dependency install failure should exit 2: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] \
  || fail "locked dependency install failure must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] \
  || fail "locked dependency install failure should restore main"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "locked dependency install failure should remove its integration branch"
fi
grep -qF 'stub install diagnostic: package.json and bun.lock disagree' <<< "$output" \
  || fail "locked install diagnostic should be retained in the output: $output"
grep -qF 'land: locked dependency install failed on the branch tip; main is untouched.' <<< "$output" \
  || fail "land should classify the locked install failure clearly: $output"
if grep -q '^verify:' "$stub_log"; then
  fail "verify must not run after a failed locked dependency install: $(cat "$stub_log")"
fi
grep -qF "install:$repo:--frozen-lockfile:main" "$stub_log" \
  || fail "install failure cleanup should run main's frozen reconcile: $(cat "$stub_log")"
[ "$(sed -n '1p' "$repo/node_modules/.fixture-dependency")" = "main" ] \
  || fail "install failure cleanup should reconcile main dependencies"
[ "$(last_line "$output")" = "land: exit: 2 (verify-failed) — fix the locked dependency install failure above, then re-run land" ] \
  || fail "locked install failure trailer mismatch: $output"
ok "locked dependency install failure is verify-failed without moving main"

# A failed branch-mode verify restores the starting checkout. Since the landing
# install changes node_modules first, cleanup must frozen-install main's lockfile
# after switching back so the operator is not left with landing dependencies.
repo=$(new_repo land-dependency-restore)
printf '{"dependencies":{"fixture-dependency":"main"}}\n' > "$repo/package.json"
printf 'fixture-dependency=main\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: restore dependency fixture"
mkdir -p "$repo/node_modules"
printf 'main\n' > "$repo/node_modules/.fixture-dependency"
git -C "$repo" switch -qc feature
printf '{"dependencies":{"fixture-dependency":"landing"}}\n' > "$repo/package.json"
printf 'fixture-dependency=landing\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: restore landing dependency"
git -C "$repo" switch -q main
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/dependency-restore-bin"
stub_log="$TMP_ROOT/dependency-restore.log"
marker="$TMP_ROOT/dependency-restore.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_VERIFY_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "dependency-restore verify failure should exit 2: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] \
  || fail "dependency-restore verify failure must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] \
  || fail "dependency-restore verify failure should restore main"
grep -qF "install:$repo:--frozen-lockfile:landing" "$stub_log" \
  || fail "restore fixture should first install landing dependencies: $(cat "$stub_log")"
[ "$(tail -n1 "$stub_log")" = "install:$repo:--frozen-lockfile:main" ] \
  || fail "restore should finish by installing main dependencies: $(cat "$stub_log")"
[ "$(sed -n '1p' "$repo/node_modules/.fixture-dependency")" = "main" ] \
  || fail "restored main should retain main's dependency tree"
ok "verify failure reconciles dependencies to the restored starting checkout"

# Dependency bumps must be installed from the checked-out landing tree before
# verify. The Bun stub models a frozen install by copying the lockfile's pinned
# fixture version into node_modules; verify then rejects any stale version.
repo=$(new_repo land-dependency-sync)
printf '{"dependencies":{"fixture-dependency":"main"}}\n' > "$repo/package.json"
printf 'fixture-dependency=main\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: main dependency fixture"
mkdir -p "$repo/node_modules"
printf 'main\n' > "$repo/node_modules/.fixture-dependency"
git -C "$repo" switch -qc feature
printf '{"dependencies":{"fixture-dependency":"landing"}}\n' > "$repo/package.json"
printf 'fixture-dependency=landing\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: bump landing dependency"
git -C "$repo" switch -q main
stub_dir="$TMP_ROOT/dependency-sync-bin"
stub_log="$TMP_ROOT/dependency-sync.log"
marker="$TMP_ROOT/dependency-sync.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_VERIFY_DEP_SYNC=1 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "dependency-sync land should succeed: $output"
grep -qF "install:$repo:--frozen-lockfile:landing" "$stub_log" \
  || fail "landing should frozen-install its pinned dependency: $(cat "$stub_log")"
install_line=$(grep -nF "install:$repo:--frozen-lockfile:landing" "$stub_log" | head -n1 | cut -d: -f1)
verify_line=$(grep -n '^verify:' "$stub_log" | head -n1 | cut -d: -f1)
[ "$install_line" -lt "$verify_line" ] \
  || fail "landing dependency install must run before verify: $(cat "$stub_log")"
ok "landing tree dependencies are frozen-installed before verify"

# A marker written for the landing commit before its dependency graph changed
# cannot satisfy land's verify gate. The stub mirrors verify.sh's marker
# short-circuit, including FORCE_VERIFY, so this fixture reproduces the stale
# evidence hole when land invokes verify without forcing it: land exits 0 while
# the verify body (and its dependency-sync check) never runs.
repo=$(new_repo land-marker-cannot-skip-verify)
printf '{"dependencies":{"fixture-dependency":"main"}}\n' > "$repo/package.json"
printf 'fixture-dependency=main\n' > "$repo/bun.lock"
printf 'node_modules/\n' > "$repo/.gitignore"
git -C "$repo" add .gitignore package.json bun.lock
git -C "$repo" commit -qm "test: marker main dependency"
mkdir -p "$repo/node_modules"
printf 'main\n' > "$repo/node_modules/.fixture-dependency"
git -C "$repo" switch -qc feature
printf '{"dependencies":{"fixture-dependency":"landing"}}\n' > "$repo/package.json"
printf 'fixture-dependency=landing\n' > "$repo/bun.lock"
git -C "$repo" add package.json bun.lock
git -C "$repo" commit -qm "test: marker landing dependency"
stub_dir="$TMP_ROOT/marker-cannot-skip-bin"
stub_log="$TMP_ROOT/marker-cannot-skip.log"
marker="$TMP_ROOT/marker-cannot-skip.marker"
(
  cd "$repo"
  # shellcheck source=/dev/null
  . scripts/lib/verify-metadata.sh
  musi_write_success_marker "$marker" "$(git rev-parse HEAD)" \
    "$(ai_worktree_fingerprint "$repo")"
)
git -C "$repo" switch -q main
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_VERIFY_DEP_SYNC=1 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "forced land verify with a matching marker should succeed: $output"
if grep -q '^verify-marker-skip:' "$stub_log"; then
  fail "land must ignore pre-existing verify evidence after installing landing dependencies: $(cat "$stub_log")"
fi
grep -q '^verify:' "$stub_log" \
  || fail "land must execute the real verify body after installing landing dependencies: $(cat "$stub_log")"
ok "land ignores matching markers and verifies the freshly installed dependency graph"

repo=$(new_repo land-fast-verify-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: failing fast path feature"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/fast-fail-bin"
stub_log="$TMP_ROOT/fast-fail.log"
marker="$TMP_ROOT/fast-fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env MUSI_LAND_VERIFY_STATUS=42 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "fast-path verify failure should exit 2: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "fast-path verify failure must not move main"
failed_event_kinds=$(cut -d: -f1 "$stub_log")
[ "$failed_event_kinds" = $'install\nharness\nprisma-generate\nverify' ] \
  || fail "verify failure must stop after the exact install, harness, Prisma, verify sequence: $(cat "$stub_log")"
[ "$(last_line "$output")" = "land: exit: 2 (verify-failed) — inspect $TMP_ROOT/verify-log/<slot>.log, fix the branch verification failure, then re-run land" ] \
  || fail "fast-path verify-failure trailer mismatch: $output"
if grep -qF 'land: NOTE: the regenerated Prisma client' <<< "$output"; then
  fail "current-mode fast-path failure must not warn about a stale client — the checkout was never rewritten and still holds the generated-from tree: $output"
fi
ok "fast-path verify failure is classified without moving main"

# The trailer is the last COMBINED-stream line, so a backgrounded
# `land.sh ... 2>&1 | tail -n 1` still names the verify failure-log dir
# (custom via MUSI_VERIFY_LOG_DIR, which run_land sets).
set +e
tail_line=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_VERIFY_STATUS=42 2>&1 | tail -n 1
)
set -e
[ "$tail_line" = "land: exit: 2 (verify-failed) — inspect $TMP_ROOT/verify-log/<slot>.log, fix the branch verification failure, then re-run land" ] \
  || fail "land verify-failure trailer must survive 2>&1 | tail -n 1: $tail_line"
ok "land verify-failure trailer carries the log dir through 2>&1 | tail -n 1"

repo=$(new_repo land-branch-harness-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: branch harness failure"
git -C "$repo" switch -q main
stub_dir="$TMP_ROOT/branch-harness-bin"
stub_log="$TMP_ROOT/branch-harness.log"
marker="$TMP_ROOT/branch-harness.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_HARNESS_CHECK_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "branch harness failure should exit 1: $output"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "branch harness failure should restore the starting branch"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "branch harness failure should remove its integration branch"
fi
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — regenerate the stale harness surfaces, commit them, then re-run land" ] \
  || fail "branch harness-failure trailer mismatch: $output"
ok "branch harness failure cleans up and ends with an actionable trailer"

# Prisma generator failure: verify never ran, so this is `1 not-landed`
# (matching the sibling harness:check preflight), never `2 verify-failed`.
# The generator's diagnostic must survive in the output and cleanup must
# restore the starting checkout and drop the integration branch.
repo=$(new_repo land-prisma-generate-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: prisma generator failure"
git -C "$repo" switch -q main
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/prisma-fail-bin"
stub_log="$TMP_ROOT/prisma-fail.log"
marker="$TMP_ROOT/prisma-fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_PRISMA_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "prisma generator failure should exit 1: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "prisma generator failure must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] \
  || fail "prisma generator failure should restore the starting checkout"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "prisma generator failure should remove its integration branch"
fi
grep -qF 'stub prisma generate diagnostic: forced generator failure' <<< "$output" \
  || fail "prisma generator diagnostic should be retained in the output: $output"
if grep -q '^verify:' "$stub_log"; then
  fail "verify must not run after a failed prisma generate: $(cat "$stub_log")"
fi
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — fix the Prisma client generation failure above, then re-run land" ] \
  || fail "prisma generator-failure trailer mismatch: $output"
ok "prisma generator failure is not-landed with cleanup and a retained diagnostic"

# Prisma generator failure on the DIVERGED path: the failure fires while the
# detached merge-tree preview is active (preview_active=1), so the restore
# ordering matters — abandon the preview, restore the starting checkout, and
# drop the integration branch, all before the `1 not-landed` trailer. The
# stub's parents=2 record proves generation ran on the merge preview, not the
# branch tip.
repo=$(new_repo land-prisma-generate-fails-diverged)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: diverged prisma generator failure feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm "test: diverged prisma generator failure main"
main_before=$(git -C "$repo" rev-parse main)
feature_before=$(git -C "$repo" rev-parse feature)
stub_dir="$TMP_ROOT/prisma-fail-diverged-bin"
stub_log="$TMP_ROOT/prisma-fail-diverged.log"
marker="$TMP_ROOT/prisma-fail-diverged.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_PRISMA_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "diverged prisma generator failure should exit 1: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] \
  || fail "diverged prisma generator failure must not move main"
[ "$(git -C "$repo" rev-parse feature)" = "$feature_before" ] \
  || fail "diverged prisma generator failure must not move the feature branch"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] \
  || fail "diverged prisma generator failure should restore the starting checkout (not the preview)"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "diverged prisma generator failure should remove its integration branch"
fi
git -C "$repo" diff --quiet && git -C "$repo" diff --cached --quiet \
  || fail "diverged prisma generator failure should leave a clean worktree behind"
grep -qF 'prisma-generate:'"$repo"':2:' "$stub_log" \
  || fail "diverged generation should run on the two-parent merge preview: $(cat "$stub_log")"
if grep -q '^verify:' "$stub_log"; then
  fail "verify must not run after a failed diverged prisma generate: $(cat "$stub_log")"
fi
grep -qF 'stub prisma generate diagnostic: forced generator failure' <<< "$output" \
  || fail "diverged generator diagnostic should be retained in the output: $output"
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — fix the Prisma client generation failure above, then re-run land" ] \
  || fail "diverged prisma generator-failure trailer mismatch: $output"
ok "diverged prisma generator failure restores the preview and cleans up not-landed"

repo=$(new_repo land-three-way)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: divergent feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm "test: divergent main"
git -C "$repo" switch -q feature
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/three-way-bin"
stub_log="$TMP_ROOT/three-way.log"
marker="$TMP_ROOT/three-way.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_EXPECT_FILES="main.txt:feature.txt" 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "three-way land should succeed: $output"
[ "$(grep -c '^verify:' "$stub_log")" -eq 1 ] || fail "three-way path should verify once: $(cat "$stub_log")"
verify_root=$(sed -n 's/^verify:\(.*\):2:[0-9a-f]*$/\1/p' "$stub_log")
[ -n "$verify_root" ] || fail "three-way verify should run on a merge commit: $(cat "$stub_log")"
[ "$verify_root" = "$repo" ] || fail "three-way verify should use the healthy landing worktree"
[ "$(git -C "$repo" rev-parse HEAD^1)" = "$main_before" ] || fail "merge first parent should be frozen main"
verified_tree=$(sed -n 's/^verify:.*:2:\([0-9a-f]*\)$/\1/p' "$stub_log")
[ "$(git -C "$repo" rev-parse 'HEAD^{tree}')" = "$verified_tree" ] \
  || fail "landed tree should equal the verified merge tree"
marker_head=$(sed -n 's/^LAST_HEAD=//p' "$marker")
[ "$marker_head" = "$(git -C "$repo" rev-parse HEAD)" ] || fail "merge commit should carry re-stamped provenance"
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "three-way success trailer mismatch: $output"
ok "genuine three-way land verifies the merge tree before moving main"

# Prisma preflight placement, merge-tree mode: regeneration must happen AFTER
# the prospective merge-tree construction (the stub records a two-parent HEAD),
# not at the branch tip — otherwise a diverged branch generates from a tree
# other than the merged schema verify checks.
[ "$(grep -c '^prisma-generate:' "$stub_log")" -eq 1 ] \
  || fail "three-way land should regenerate the Prisma client exactly once: $(cat "$stub_log")"
generate_tree=$(sed -n 's/^prisma-generate:.*:2:\([0-9a-f]*\)$/\1/p' "$stub_log")
[ -n "$generate_tree" ] \
  || fail "prisma generate should run on the constructed merge commit: $(cat "$stub_log")"
[ "$generate_tree" = "$verified_tree" ] \
  || fail "prisma generate must see the settled merge tree verify runs on: $(cat "$stub_log")"
generate_line=$(grep -n '^prisma-generate:' "$stub_log" | head -n1 | cut -d: -f1)
verify_line=$(grep -n '^verify:' "$stub_log" | head -n1 | cut -d: -f1)
[ "$generate_line" -lt "$verify_line" ] \
  || fail "prisma generate must run before the merge-tree verify: $(cat "$stub_log")"
ok "diverged land regenerates the Prisma client from the settled merge tree"

repo=$(new_repo land-branch-three-way)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: branch divergent feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm "test: branch divergent main"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/branch-three-way-bin"
stub_log="$TMP_ROOT/branch-three-way.log"
marker="$TMP_ROOT/branch-three-way.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_EXPECT_FILES="main.txt:feature.txt" 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "branch three-way land should succeed: $output"
[ "$(git -C "$repo" rev-parse HEAD^1)" = "$main_before" ] || fail "branch merge first parent should be frozen main"
git -C "$repo" merge-base --is-ancestor feature main \
  || fail "branch three-way success should preserve feature as an ancestor of main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "branch three-way success should leave main checked out"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "branch three-way success should remove its integration branch"
fi
grep -qF "land: creating integration branch land/feature" <<< "$output" \
  || fail "branch three-way path should announce its integration branch: $output"
[ "$(grep -cF "install:$repo:--frozen-lockfile:<none>" "$stub_log")" -eq 3 ] \
  || fail "branch three-way path should install the preview, restored integration tree, and merged main: $(cat "$stub_log")"
[ "$(tail -n1 "$stub_log")" = "install:$repo:--frozen-lockfile:<none>" ] \
  || fail "successful branch mode must finish with merged-main dependency reconciliation: $(cat "$stub_log")"
verify_line=$(grep -n '^verify:' "$stub_log" | head -n1 | cut -d: -f1)
merged_main_install_line=$(wc -l < "$stub_log")
[ "$verify_line" -lt "$merged_main_install_line" ] \
  || fail "merged-main dependency reconciliation must happen after verify: $(cat "$stub_log")"
grep -qF 'land: reconciling locked dependencies after checkout restoration' <<< "$output" \
  || fail "branch three-way path should reconcile after restoring the merge preview: $output"
grep -qF 'land: reconciling locked dependencies for merged main' <<< "$output" \
  || fail "branch three-way path should reconcile merged main: $output"
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "branch three-way success trailer mismatch: $output"
ok "branch mode reconciles and lands a verified three-way merge tree"

repo=$(new_repo land-merge-verify-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: failing divergent feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm "test: failing divergent main"
git -C "$repo" switch -q feature
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/fail-bin"
stub_log="$TMP_ROOT/fail.log"
marker="$TMP_ROOT/fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_VERIFY_STATUS=42 MUSI_LAND_EXPECT_FILES="main.txt:feature.txt" 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "merge-tree verify failure should exit 2: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "failed merge-tree verify must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "feature" ] || fail "failed merge-tree verify should leave the feature checked out"
grep -qF "merge tree failed verification" <<< "$output" || fail "failure should identify merge-tree verification: $output"
# The preview restore rewrote the checkout (merge tree -> feature tip), so
# the ahead-of-schema client warning applies here.
grep -qF 'land: NOTE: the regenerated Prisma client still matches the abandoned verify tree' <<< "$output" \
  || fail "diverged verify failure should warn about the ahead-of-schema Prisma client: $output"
[ "$(last_line "$output")" = "land: exit: 2 (verify-failed) — inspect $TMP_ROOT/verify-log/<slot>.log, fix the merge-tree verification failure, then re-run land" ] \
  || fail "verify-failure trailer mismatch: $output"
ok "merge-tree verify failure leaves main untouched and gives an actionable trailer"

repo=$(new_repo land-branch-merge-verify-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: branch failing divergent feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm "test: branch failing divergent main"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/branch-fail-bin"
stub_log="$TMP_ROOT/branch-fail.log"
marker="$TMP_ROOT/branch-fail.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_VERIFY_STATUS=42 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 2 ] || fail "branch merge-tree verify failure should exit 2: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "branch verify failure must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "branch verify failure should restore main"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "branch verify failure should remove its integration branch"
fi
[ "$(last_line "$output")" = "land: exit: 2 (verify-failed) — inspect $TMP_ROOT/verify-log/<slot>.log, fix the merge-tree verification failure, then re-run land" ] \
  || fail "branch verify-failure trailer mismatch: $output"
# Branch mode always ends on the restored starting checkout, so the
# ahead-of-schema client warning applies on this path too.
grep -qF 'land: NOTE: the regenerated Prisma client still matches the abandoned verify tree' <<< "$output" \
  || fail "branch verify failure should warn about the ahead-of-schema Prisma client: $output"
ok "branch merge-tree verify failure cleans up without moving main"

repo=$(new_repo land-preview-conflict)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/shared.txt"
git -C "$repo" add shared.txt
git -C "$repo" commit -qm "test: conflicting feature"
git -C "$repo" switch -q main
printf 'main\n' > "$repo/shared.txt"
git -C "$repo" add shared.txt
git -C "$repo" commit -qm "test: conflicting main"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/conflict-bin"
stub_log="$TMP_ROOT/conflict.log"
marker="$TMP_ROOT/conflict.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "preview conflict should exit 1: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "preview conflict must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "preview conflict should restore main"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "preview conflict should remove its integration branch"
fi
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — resolve the branch against current main, then re-run land" ] \
  || fail "preview-conflict trailer mismatch: $output"
ok "preview merge conflict aborts cleanly without moving main"

repo=$(new_repo land-tip-advances)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: feature advances during verify"
target_before=$(git -C "$repo" rev-parse feature)
git -C "$repo" switch -q main
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/tip-advance-bin"
stub_log="$TMP_ROOT/tip-advance.log"
marker="$TMP_ROOT/tip-advance.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature \
    env MUSI_LAND_ADVANCE_REF=feature 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "advanced tip should exit 1: $output"
[ "$(git -C "$repo" rev-parse feature)" != "$target_before" ] || fail "advanced-tip fixture should move feature"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] || fail "advanced tip must not move main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "advanced tip should restore main"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "advanced tip should remove its integration branch"
fi
grep -qF "feature advanced during verification" <<< "$output" || fail "advanced tip diagnostic missing: $output"
ok "branch movement during verify refuses the frozen tip and cleans up"

# The target can still advance in the narrow check-to-merge window. The merge
# remains push-safe because it contains the frozen verified tip, but land must
# say clearly that the newer target commits are not in main.
repo=$(new_repo land-branch-post-merge-move)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: post-merge movement feature"
git -C "$repo" switch -q main
cat > "$repo/.git/hooks/post-merge" <<'HOOK'
#!/usr/bin/env bash
tree=$(git rev-parse feature^{tree})
parent=$(git rev-parse refs/heads/feature)
advanced=$(git commit-tree "$tree" -p "$parent" -m "test: concurrent post-verify advance")
git update-ref refs/heads/feature "$advanced"
HOOK
chmod +x "$repo/.git/hooks/post-merge"
stub_dir="$TMP_ROOT/post-merge-move-bin"
stub_log="$TMP_ROOT/post-merge-move.log"
marker="$TMP_ROOT/post-merge-move.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land_branch "$repo" "$stub_dir" "$stub_log" "$marker" feature env 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "post-merge movement should preserve verified success: $output"
grep -qF "advanced after it was verified" <<< "$output" \
  || fail "post-merge movement warning should identify the advanced target: $output"
grep -qF "does NOT contain the newer commits" <<< "$output" \
  || fail "post-merge movement warning should describe main accurately: $output"
if git -C "$repo" merge-base --is-ancestor feature main; then
  fail "post-merge movement fixture should leave the advanced target outside main"
fi
[ "$(tail -n1 "$stub_log")" = "install:$repo:--frozen-lockfile:<none>" ] \
  || fail "post-merge movement success must still reconcile merged-main dependencies: $(cat "$stub_log")"
ok "branch mode reports target movement after verify and reconciles merged main"

repo=$(new_repo land-main-advances)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: main advances during verify"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/main-advance-bin"
stub_log="$TMP_ROOT/main-advance.log"
marker="$TMP_ROOT/main-advance.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(run_land "$repo" "$stub_dir" "$stub_log" "$marker" env MUSI_LAND_ADVANCE_REF=main 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "advanced main should exit 1: $output"
[ "$(git -C "$repo" rev-parse main)" != "$main_before" ] || fail "main-advance fixture should advance main"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "feature" ] || fail "advanced main should leave feature checked out"
grep -qF "main advanced during verification" <<< "$output" || fail "advanced main diagnostic missing: $output"
ok "main movement during verify refuses stale verified inputs"

# The final merge is post-verify and must still fail immediately for any real
# Git error that is not the narrow index.lock contention signature. Recording
# the invocation count guards against retrying or masking an arbitrary failure.
repo=$(new_repo land-final-merge-non-lock-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: non-lock final merge failure"
main_before=$(git -C "$repo" rev-parse main)
stub_dir="$TMP_ROOT/final-merge-non-lock-bin"
stub_log="$TMP_ROOT/final-merge-non-lock.log"
marker="$TMP_ROOT/final-merge-non-lock.marker"
git_state="$TMP_ROOT/final-merge-non-lock.state"
real_git=$(command -v git)
write_bun_stub "$stub_dir"
write_git_stub "$stub_dir"
: > "$stub_log"
: > "$git_state"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_REAL_GIT="$real_git" MUSI_LAND_GIT_STATE="$git_state" \
    MUSI_LAND_GIT_MODE=final-merge-error 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "non-lock final merge failure should retain exit 1: $output"
[ "$(grep -c '^final-merge-attempt$' "$git_state")" -eq 1 ] \
  || fail "non-lock final merge failure must not be retried: $(cat "$git_state")"
grep -qF 'injected non-lock final merge failure' <<< "$output" \
  || fail "non-lock final merge stderr must remain visible: $output"
[ "$(git -C "$repo" rev-parse main)" = "$main_before" ] \
  || fail "non-lock final merge failure must leave main untouched"
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — inspect the merge failure on main, then re-run land from a clean worktree" ] \
  || fail "non-lock final merge failure trailer mismatch: $output"
ok "non-lock final merge failures retain exit 1 without retry"

# A dev watcher can briefly own the shared index.lock after the post-verify
# switch to main. The exact lock diagnostic is retryable; after two injected
# failures, the identical final merge must run a third time and land normally.
repo=$(new_repo land-final-merge-index-lock-retries)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: transient final merge lock"
stub_dir="$TMP_ROOT/final-merge-index-lock-bin"
stub_log="$TMP_ROOT/final-merge-index-lock.log"
marker="$TMP_ROOT/final-merge-index-lock.marker"
git_state="$TMP_ROOT/final-merge-index-lock.state"
real_git=$(command -v git)
write_bun_stub "$stub_dir"
write_git_stub "$stub_dir"
: > "$stub_log"
: > "$git_state"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_REAL_GIT="$real_git" MUSI_LAND_GIT_STATE="$git_state" \
    MUSI_LAND_GIT_MODE=final-merge-index-lock MUSI_LAND_GIT_FAIL_COUNT=2 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "transient final merge lock should be retried to success: $output"
[ "$(grep -c '^final-merge-attempt$' "$git_state")" -eq 3 ] \
  || fail "transient final merge lock should take three attempts: $(cat "$git_state")"
[ "$(grep -c 'fatal: Unable to create.*index.lock.*File exists' <<< "$output")" -eq 2 ] \
  || fail "each transient lock stderr diagnostic must remain visible: $output"
[ "$(grep -c 'land: git index.lock contention; retrying' <<< "$output")" -eq 2 ] \
  || fail "each transient lock failure should announce its retry: $output"
git -C "$repo" merge-base --is-ancestor feature main \
  || fail "transient final merge lock retry should ultimately land the feature"
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "transient final merge lock success trailer mismatch: $output"
ok "transient final merge index.lock contention retries and lands"

repo=$(new_repo land-tree-mismatch)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: post merge tree mismatch"
stub_dir="$TMP_ROOT/tree-mismatch-bin"
stub_log="$TMP_ROOT/tree-mismatch.log"
marker="$TMP_ROOT/tree-mismatch.marker"
git_state="$TMP_ROOT/tree-mismatch.state"
real_git=$(command -v git)
write_bun_stub "$stub_dir"
write_git_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_REAL_GIT="$real_git" MUSI_LAND_GIT_STATE="$git_state" \
    MUSI_LAND_GIT_MODE=change-merge-tree 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 3 ] || fail "post-merge tree mismatch should exit 3: $output"
grep -qF "created merge tree differs" <<< "$output" || fail "tree-mismatch diagnostic missing: $output"
[ "$(last_line "$output")" = "land: exit: 3 (merged-unverified) — run bun run verify before pushing main" ] \
  || fail "tree-mismatch trailer mismatch: $output"
ok "post-merge tree mismatch reports the surviving merge as unverified"

repo=$(new_repo land-unexpected-post-merge-error)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: unexpected post merge error"
stub_dir="$TMP_ROOT/post-merge-error-bin"
stub_log="$TMP_ROOT/post-merge-error.log"
marker="$TMP_ROOT/post-merge-error.marker"
git_state="$TMP_ROOT/post-merge-error.state"
real_git=$(command -v git)
write_bun_stub "$stub_dir"
write_git_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_REAL_GIT="$real_git" MUSI_LAND_GIT_STATE="$git_state" \
    MUSI_LAND_GIT_MODE=fail-after-merge 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 3 ] || fail "unexpected post-merge error should exit 3: $output"
git -C "$repo" merge-base --is-ancestor feature main || fail "unexpected-error fixture should preserve the merge on main"
[ "$(last_line "$output")" = "land: exit: 3 (merged-unverified) — run bun run verify before pushing main" ] \
  || fail "unexpected post-merge error trailer mismatch: $output"
ok "unexpected errors after main moves retain the merged-unverified state"

repo=$(new_repo land-restamp-fails)
git -C "$repo" switch -qc feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: missing provenance feature"
stub_dir="$TMP_ROOT/restamp-bin"
stub_log="$TMP_ROOT/restamp.log"
marker="$TMP_ROOT/restamp.marker"
write_bun_stub "$stub_dir"
: > "$stub_log"
set +e
output=$(
  run_land "$repo" "$stub_dir" "$stub_log" "$marker" \
    env MUSI_LAND_VERIFY_MARKER= 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 3 ] || fail "merged tree without provenance should exit 3: $output"
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "restamp failure should report the surviving merge on main"
git -C "$repo" merge-base --is-ancestor feature main \
  || fail "restamp failure fixture should contain the merged feature"
[ "$(last_line "$output")" = "land: exit: 3 (merged-unverified) — run bun run verify before pushing main" ] \
  || fail "merged-unverified trailer mismatch: $output"
ok "the surviving merged-but-unverified path has a distinct code and trailer"

printf 'land tests passed (%d)\n' "$PASS"
