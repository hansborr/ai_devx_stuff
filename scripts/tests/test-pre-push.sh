#!/usr/bin/env bash
# smoke-order: 080
# smoke-subjects: .husky/pre-push
# smoke-subjects: .husky/post-commit
# smoke-subjects: scripts/land.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-pre-push.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested

REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
# shellcheck source=../lib/verify-metadata.sh
. "$REPO_ROOT/scripts/lib/verify-metadata.sh"

TMP_ROOT=$(mktemp -d /tmp/musi-pre-push-test.XXXXXX)
trap 'rm -rf "$TMP_ROOT"' EXIT

export MUSI_PATH_POLICY_QUERY="$REPO_ROOT/scripts/path-policy/path-policy-query.ts"
export MUSI_PATH_POLICY_BUN="${MUSI_PATH_POLICY_BUN:-bun}"
unset MUSI_PRE_PUSH_VERIFY_FRESHNESS_SECONDS

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

  mkdir -p "$repo/scripts/lib" "$repo/.husky"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test User"
  cp "$REPO_ROOT/scripts/land.sh" "$repo/scripts/land.sh"
  cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
  cp "$REPO_ROOT/scripts/lib/gate-env.sh" "$repo/scripts/lib/gate-env.sh"
  cp "$REPO_ROOT/.husky/pre-push" "$repo/.husky/pre-push"
  cp "$REPO_ROOT/.husky/post-commit" "$repo/.husky/post-commit"
  chmod +x "$repo/.husky/pre-push"
  chmod +x "$repo/.husky/post-commit"
  printf 'fixture\n' > "$repo/README.md"
  git -C "$repo" add .
  git -C "$repo" commit -qm "initial fixture"
  printf '%s\n' "$repo"
}

write_bun_stub() {
  local stub_dir="$1"

  mkdir -p "$stub_dir"
  cat > "$stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${MUSI_LAND_BUN_LOG:?}"
if [ "$1" = "run" ] && [ "${2:-}" = "harness:check" ]; then
  status="${MUSI_LAND_HARNESS_CHECK_STATUS:-23}"
  if [ "$status" -ne 0 ]; then
    printf 'stub harness:check failure\n' >&2
  fi
  exit "$status"
fi
if [ "$1" = "run" ] && [ "${2:-}" = "verify" ]; then
  status="${MUSI_LAND_VERIFY_STATUS:-99}"
  if [ "$status" -ne 0 ]; then
    printf 'stub verify exit %s\n' "$status" >&2
  fi
  exit "$status"
fi
exit 0
STUB
  chmod +x "$stub_dir/bun"
}

state_root_for() {
  local repo="$1"

  printf '%s/state-%s' "$TMP_ROOT" "$(basename "$repo")"
}

fast_commit_marker() {
  local repo="$1"

  printf '%s/musi-fast-commit' "$(musi_git_common_identity_path "$repo")"
}

fast_commit_log() {
  local repo="$1"

  printf '%s/musi-fast-commit-log' "$(musi_git_common_identity_path "$repo")"
}

fast_commit_pending() {
  local repo="$1"

  printf '%s/musi-fast-commit-pending' "$(musi_git_common_identity_path "$repo")"
}

mark_fast_commit() {
  local repo="$1"

  : > "$(fast_commit_marker "$repo")"
}

record_fast_commit() {
  local repo="$1"
  local sha="${2:-}"

  [ -n "$sha" ] || sha=$(git -C "$repo" rev-parse HEAD)
  mkdir -p "$(dirname "$(fast_commit_log "$repo")")"
  printf '%s\n' "$sha" >> "$(fast_commit_log "$repo")"
}

push_line_for_head() {
  local repo="$1"
  local sha

  sha=$(git -C "$repo" rev-parse HEAD)
  printf 'refs/heads/feature %s refs/heads/feature 0000000000000000000000000000000000000000\n' "$sha"
}

run_pre_push() {
  local repo="$1"
  local input="$2"
  local state_root

  state_root=$(state_root_for "$repo")
  (
    cd "$repo"
    MUSI_VERIFY_STATE_ROOT="$state_root" bash .husky/pre-push <<< "$input"
  )
}

run_pre_push_with_freshness() {
  local repo="$1"
  local input="$2"
  local freshness_seconds="$3"
  local state_root

  state_root=$(state_root_for "$repo")
  (
    cd "$repo"
    MUSI_VERIFY_STATE_ROOT="$state_root" \
      MUSI_PRE_PUSH_VERIFY_FRESHNESS_SECONDS="$freshness_seconds" \
      bash .husky/pre-push <<< "$input"
  )
}

worktree_hash() {
  local repo="$1"

  ai_worktree_fingerprint "$repo"
}

write_full_verify_marker() {
  local repo="$1"
  local age_seconds="${2:-0}"
  local state_root marker head fp ts

  state_root=$(state_root_for "$repo")
  marker=$(MUSI_VERIFY_STATE_ROOT="$state_root" musi_standard_verify_full_marker "$repo")
  head=$(git -C "$repo" rev-parse HEAD)
  fp=$(worktree_hash "$repo")
  ts=$(($(date +%s) - age_seconds))
  [ "$ts" -gt 0 ] || fail "failed to calculate full verify marker timestamp"
  mkdir -p "$(dirname "$marker")"
  {
    printf 'LAST_TS=%s\n' "$ts"
    printf 'LAST_HEAD=%s\n' "$head"
    printf 'LAST_HASH=%s\n' "$fp"
  } > "$marker" || fail "failed to write full verify marker"
}

write_full_verify_wrapper() {
  local repo="$1"
  local state_root log_dir wrapper head fp now now_iso

  state_root=$(state_root_for "$repo")
  log_dir=$(MUSI_VERIFY_STATE_ROOT="$state_root" musi_standard_verify_log_dir "$repo")
  wrapper="$log_dir/meta/wrapper.json"
  head=$(git -C "$repo" rev-parse HEAD)
  fp=$(worktree_hash "$repo")
  now=$(date +%s)
  now_iso=$(date -Iseconds)
  MUSI_VERIFY_STATE_ROOT="$state_root" musi_write_wrapper_meta \
    "$wrapper" serial-verify "$now" "$now_iso" "$now" "$now_iso" 0 \
    "bash scripts/verify.sh" "$head" "$fp"
}

write_changed_verify_wrapper() {
  local repo="$1"
  local state_root log_dir wrapper head fp now now_iso

  state_root=$(state_root_for "$repo")
  log_dir=$(MUSI_VERIFY_STATE_ROOT="$state_root" musi_standard_verify_log_dir "$repo")
  wrapper="$log_dir/meta/wrapper.json"
  head=$(git -C "$repo" rev-parse HEAD)
  fp=$(ai_staged_fingerprint "$repo")
  now=$(date +%s)
  now_iso=$(date -Iseconds)
  MUSI_VERIFY_STATE_ROOT="$state_root" musi_write_wrapper_meta \
    "$wrapper" parallel-verify-changed "$now" "$now_iso" "$now" "$now_iso" 0 \
    "bash scripts/verify.sh --changed" "$head" "$fp"
}

repo=$(new_repo no-fast-marker)
run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null \
  || fail "pre-push should pass when fast-commit marker is absent"
ok "passes when fast-commit marker is absent"

repo=$(new_repo active-marker-no-provenance)
mark_fast_commit "$repo"
run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null \
  || fail "pre-push should pass when current marker is active but no pushed commit used fast-commit"
ok "passes when marker is active but pushed commits have no fast provenance"

repo=$(new_repo fast-marker-no-verify)
mark_fast_commit "$repo"
record_fast_commit "$repo"
set +e
output=$(run_pre_push "$repo" "$(push_line_for_head "$repo")" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "pre-push should fail without full verify evidence"
grep -qF "bash scripts/land.sh" <<< "$output" \
  || fail "failure output should name land.sh: $output"
grep -qF '  bun run verify' <<< "$output" \
  || fail "failure output should name managed full verify command: $output"
grep -qF -- "--no-verify" <<< "$output" \
  || fail "failure output should mention the bypass caveat: $output"
grep -qF "fast-commit provenance" <<< "$output" \
  || fail "failure output should describe provenance, not only current marker state: $output"
ok "fails fast-commit pushes without full verify evidence"

repo=$(new_repo fast-marker-removed)
record_fast_commit "$repo"
rm -f "$(fast_commit_marker "$repo")"
if run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null 2>&1; then
  fail "pre-push should fail when a pushed commit used fast-commit even after marker removal"
fi
ok "fails fast-commit provenance even after marker removal"

repo=$(new_repo fast-marker-success-marker)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo"
run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null \
  || fail "pre-push should accept a matching full verify marker"
[ ! -s "$(fast_commit_log "$repo")" ] \
  || fail "matching full verify marker should clear covered fast-commit log entries"
ok "accepts a matching full verify success marker"

repo=$(new_repo fast-marker-default-window)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo" 1800
run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null \
  || fail "pre-push should accept evidence inside the default one-hour freshness window"
ok "accepts matching full verify evidence inside the default one-hour freshness window"

repo=$(new_repo fast-marker-stale-default-window)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo" 3601
if run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null 2>&1; then
  fail "pre-push should reject evidence older than the default one-hour freshness window"
fi
ok "rejects full verify evidence older than the default freshness window"

repo=$(new_repo fast-marker-override-large-window)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo" 1800
run_pre_push_with_freshness "$repo" "$(push_line_for_head "$repo")" 7200 >/dev/null \
  || fail "pre-push should accept would-be-stale evidence with a larger env override"
ok "honors larger freshness env override"

repo=$(new_repo fast-marker-override-tiny-window)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo" 2
if run_pre_push_with_freshness "$repo" "$(push_line_for_head "$repo")" 1 >/dev/null 2>&1; then
  fail "pre-push should reject otherwise fresh evidence with a tiny env override"
fi
ok "honors tiny freshness env override"

repo=$(new_repo fast-marker-invalid-window)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_marker "$repo" 1800
run_pre_push_with_freshness "$repo" "$(push_line_for_head "$repo")" not-a-number >/dev/null \
  || fail "pre-push should fall back to the default one-hour window for invalid overrides"
ok "falls back to default freshness for invalid env override"

repo=$(new_repo fast-marker-wrapper)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_full_verify_wrapper "$repo"
run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null \
  || fail "pre-push should accept matching full verify wrapper metadata"
ok "accepts matching full verify wrapper metadata"

repo=$(new_repo fast-marker-changed-wrapper)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_changed_verify_wrapper "$repo"
if run_pre_push "$repo" "$(push_line_for_head "$repo")" >/dev/null 2>&1; then
  fail "pre-push should reject changed-verify metadata as a full verify substitute"
fi
ok "rejects changed verify metadata as full verify evidence"

repo=$(new_repo fast-marker-delete)
mark_fast_commit "$repo"
run_pre_push "$repo" \
  "refs/heads/feature 0000000000000000000000000000000000000000 refs/heads/feature $(git -C "$repo" rev-parse HEAD)" \
  >/dev/null \
  || fail "pre-push should not require full verify for branch deletion"
ok "passes branch deletions"

repo=$(new_repo fast-marker-non-head)
git -C "$repo" switch -q -c other
printf 'other\n' > "$repo/other.txt"
git -C "$repo" add other.txt
git -C "$repo" commit -qm "other branch"
other_sha=$(git -C "$repo" rev-parse HEAD)
record_fast_commit "$repo" "$other_sha"
git -C "$repo" switch -q master
if run_pre_push "$repo" \
  "refs/heads/other $other_sha refs/heads/other 0000000000000000000000000000000000000000" \
  >/dev/null 2>&1; then
  fail "pre-push should reject non-HEAD refs when only HEAD evidence is available"
fi
ok "rejects non-HEAD refs under fast-commit mode"

repo=$(new_repo land-harness-check-fails)
git -C "$repo" switch -q -c feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: feature fixture"
stub_dir="$TMP_ROOT/land-stub-bin"
stub_log="$TMP_ROOT/land-bun.log"
write_bun_stub "$stub_dir"
set +e
output=$(
  cd "$repo" \
    && PATH="$stub_dir:$PATH" MUSI_LAND_BUN_LOG="$stub_log" bash scripts/land.sh 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "land.sh should fail when harness:check fails"
grep -qF "land: running harness freshness gate on feature" <<< "$output" \
  || fail "land.sh should announce harness freshness gate before failing: $output"
[ "$(cat "$stub_log")" = "run harness:check" ] \
  || fail "land.sh should stop before verify when harness:check fails: $(cat "$stub_log")"
ok "land.sh gates harness freshness before full verify"

repo=$(new_repo land-harness-check-passes)
git -C "$repo" switch -q -c feature
printf 'feature\n' > "$repo/feature.txt"
git -C "$repo" add feature.txt
git -C "$repo" commit -qm "test: feature fixture"
stub_dir="$TMP_ROOT/land-pass-stub-bin"
stub_log="$TMP_ROOT/land-pass-bun.log"
write_bun_stub "$stub_dir"
set +e
output=$(
  cd "$repo" \
    && PATH="$stub_dir:$PATH" \
      MUSI_LAND_BUN_LOG="$stub_log" \
      MUSI_LAND_HARNESS_CHECK_STATUS=0 \
      MUSI_LAND_VERIFY_STATUS=42 \
      bash scripts/land.sh 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 42 ] || fail "land.sh should propagate verify failure after harness:check passes: $output"
grep -qF "land: running harness freshness gate on feature" <<< "$output" \
  || fail "land.sh should announce harness freshness gate before verify: $output"
grep -qF "land: running full verify on feature" <<< "$output" \
  || fail "land.sh should proceed to full verify after harness:check passes: $output"
[ "$(cat "$stub_log")" = $'run harness:check\nrun verify' ] \
  || fail "land.sh should run harness:check then verify when harness is fresh: $(cat "$stub_log")"
ok "land.sh proceeds to verify after harness freshness passes"

repo=$(new_repo fast-post-commit-finalizes)
: > "$(fast_commit_pending "$repo")"
(
  cd "$repo"
  bash .husky/post-commit
) || fail "post-commit should finalize pending fast-commit provenance"
grep -qxF "$(git -C "$repo" rev-parse HEAD)" "$(fast_commit_log "$repo")" \
  || fail "post-commit should append HEAD to fast-commit provenance log"
[ ! -e "$(fast_commit_pending "$repo")" ] \
  || fail "post-commit should remove pending fast-commit marker"
ok "post-commit finalizes pending fast-commit provenance"

printf 'pre-push tests passed (%d)\n' "$PASS"
