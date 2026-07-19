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
if [ "$1" = "run" ] && [ "${2:-}" = "harness:check" ]; then
  printf 'harness:%s\n' "$(git rev-parse --show-toplevel)" >> "${MUSI_LAND_BUN_LOG:?}"
  exit "${MUSI_LAND_HARNESS_CHECK_STATUS:-0}"
fi
if [ "$1" = "run" ] && [ "${2:-}" = "--filter" ] &&
  [ "${3:-}" = "@musi/server" ] && [ "${4:-}" = "prisma:generate" ]; then
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
if [ "$1" = "run" ] && [ "${2:-}" = "verify" ]; then
  root=$(git rev-parse --show-toplevel)
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
exit 0
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
for arg in "$@"; do
  if [ "$arg" = "merge" ]; then
    is_merge=1
    break
  fi
done

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

documented_contract=$(sed -n 's/^#   \([0-9][0-9]*\) \([^ ]*\) — .*$/\1 \2/p' "$REPO_ROOT/scripts/land.sh")
expected_contract=$'0 landed-verified\n1 not-landed\n2 verify-failed\n3 merged-unverified'
[ "$documented_contract" = "$expected_contract" ] \
  || fail "land.sh documented exit contract drifted: $documented_contract"
ok "land.sh documents the machine-readable exit code and token contract"

repo=$(new_repo land-dirty)
git -C "$repo" switch -qc feature
printf 'dirty\n' >> "$repo/README.md"
set +e
output=$(cd "$repo" && bash scripts/land.sh 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 1 ] || fail "dirty land should exit 1: $output"
[ "$(last_line "$output")" = "land: exit: 1 (not-landed) — commit or stash the worktree changes, then re-run land" ] \
  || fail "dirty land trailer mismatch: $output"
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
[ "$(grep -c '^verify:' "$stub_log")" -eq 1 ] || fail "fast path should verify once: $(cat "$stub_log")"
grep -qF "verify:$repo:1:" "$stub_log" || fail "fast path should verify the feature tip: $(cat "$stub_log")"
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "fast-path success trailer mismatch: $output"
ok "tree-equality fast path verifies once and exits push-ready"

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
[ "$(git -C "$repo" symbolic-ref --short HEAD)" = "main" ] || fail "branch three-way success should leave main checked out"
if git -C "$repo" rev-parse --verify --quiet refs/heads/land/feature >/dev/null; then
  fail "branch three-way success should remove its integration branch"
fi
[ "$(last_line "$output")" = "land: exit: 0 (landed-verified) — push main with: git push origin main" ] \
  || fail "branch three-way success trailer mismatch: $output"
ok "branch mode verifies and lands a genuine three-way merge tree"

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
