#!/usr/bin/env bash
# smoke-order: 080
# smoke-subjects: .husky/pre-push
# smoke-subjects: .husky/post-commit
# smoke-subjects: scripts/git/run-baseline-truth-up.sh
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/test-pre-push.sh
# smoke-subjects: scripts/git/baseline-drivers.sh
# smoke-subjects: scripts/lib/gate-env.sh
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/harness/pre-push-scope-trigger.generated.sh

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

# Sandbox copies of verify-metadata.sh resolve the run-meta codec from the
# source tree.
export MUSI_VERIFY_META_CORE="$REPO_ROOT/scripts/lib/verify-metadata-core.ts"
export MUSI_VERIFY_META_BUN="${MUSI_VERIFY_META_BUN:-$(command -v bun)}"
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

  mkdir -p "$repo/scripts/lib" "$repo/scripts/git" "$repo/scripts/harness" "$repo/.husky"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.com"
  git -C "$repo" config user.name "Test User"
  cp "$REPO_ROOT/scripts/lib/verify-metadata.sh" "$repo/scripts/lib/verify-metadata.sh"
  cp "$REPO_ROOT/scripts/lib/verify-commit-queue.sh" "$repo/scripts/lib/verify-commit-queue.sh"
  cp "$REPO_ROOT/scripts/lib/verify-fast-commit.sh" "$repo/scripts/lib/verify-fast-commit.sh"
  cp "$REPO_ROOT/scripts/lib/verify-markers.sh" "$repo/scripts/lib/verify-markers.sh"
  cp "$REPO_ROOT/scripts/lib/verify-path-policy.sh" "$repo/scripts/lib/verify-path-policy.sh"
  cp "$REPO_ROOT/scripts/lib/verify-run-meta.sh" "$repo/scripts/lib/verify-run-meta.sh"
  cp "$REPO_ROOT/scripts/lib/verify-state-paths.sh" "$repo/scripts/lib/verify-state-paths.sh"
  cp "$REPO_ROOT/scripts/lib/gate-env.sh" "$repo/scripts/lib/gate-env.sh"
  # post-commit's merge-marker sweep sources the shared baseline-drivers registry.
  cp "$REPO_ROOT/scripts/git/baseline-drivers.sh" "$repo/scripts/git/baseline-drivers.sh"
  # The boundary trigger ERE is generated data the hook sources; without it the
  # hook fails closed, so every sandbox repo gets the real fragment.
  cp "$REPO_ROOT/scripts/harness/pre-push-scope-trigger.generated.sh" \
    "$repo/scripts/harness/pre-push-scope-trigger.generated.sh"
  cp "$REPO_ROOT/.husky/pre-push" "$repo/.husky/pre-push"
  cp "$REPO_ROOT/.husky/post-commit" "$repo/.husky/post-commit"
  chmod +x "$repo/.husky/pre-push"
  chmod +x "$repo/.husky/post-commit"
  printf 'fixture\n' > "$repo/README.md"
  git -C "$repo" add .
  git -C "$repo" commit -qm "initial fixture"
  printf '%s\n' "$repo"
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

  musi_fast_commit_pending_marker "$repo"
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

write_raw_full_verify_wrapper() {
  local repo="$1"
  local fingerprint="$2"
  local state_root log_dir wrapper head now_iso

  state_root=$(state_root_for "$repo")
  log_dir=$(MUSI_VERIFY_STATE_ROOT="$state_root" musi_standard_verify_log_dir "$repo")
  wrapper="$log_dir/meta/wrapper.json"
  head=$(git -C "$repo" rev-parse HEAD)
  now_iso=$(date -Iseconds)
  mkdir -p "$(dirname "$wrapper")"
  printf '{"mode":"serial-verify","exit_code":0,"head":"%s","fingerprint":"%s","end_time":"%s"}\n' \
    "$head" "$fingerprint" "$now_iso" > "$wrapper"
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

repo=$(new_repo failed-fingerprint-empty-wrapper)
mark_fast_commit "$repo"
record_fast_commit "$repo"
write_raw_full_verify_wrapper "$repo" ""
mkdir -p "$TMP_ROOT/failing-fingerprint-bin"
cat > "$TMP_ROOT/failing-fingerprint-bin/sha256sum" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  */musi-worktree-fingerprint.*) exit 88 ;;
  *) exec /usr/bin/sha256sum "$@" ;;
esac
STUB
chmod +x "$TMP_ROOT/failing-fingerprint-bin/sha256sum"
set +e
output=$(
  (
    cd "$repo"
    PATH="$TMP_ROOT/failing-fingerprint-bin:$PATH" \
      MUSI_VERIFY_STATE_ROOT="$(state_root_for "$repo")" \
      bash .husky/pre-push <<< "$(push_line_for_head "$repo")"
  ) 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "pre-push accepted empty wrapper provenance after fingerprint failure"
ok "rejects empty wrapper provenance when the current fingerprint fails"

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

# The pending marker is the only record that a fast commit skipped slots, so an
# append failure (disk full, lock error) must not consume it: post-commit keeps
# the marker for a later retry and warns loudly, but still exits 0 — the commit
# already exists and cannot be failed retroactively. A directory squatting on
# the log path forces the append write itself to fail.
repo=$(new_repo fast-post-commit-append-fails)
: > "$(fast_commit_pending "$repo")"
mkdir -p "$(fast_commit_log "$repo")"
set +e
output=$(
  cd "$repo"
  bash .husky/post-commit 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] \
  || fail "post-commit must not fail the commit when the provenance append fails: $output"
grep -qF "post-commit: WARNING: failed to append" <<< "$output" \
  || fail "append failure should emit a loud warning: $output"
[ -e "$(fast_commit_pending "$repo")" ] \
  || fail "append failure must keep the pending marker so the debt stays visible"
rmdir "$(fast_commit_log "$repo")"
(
  cd "$repo"
  bash .husky/post-commit
) || fail "post-commit retry should succeed once the log path is writable"
grep -qxF "$(git -C "$repo" rev-parse HEAD)" "$(fast_commit_log "$repo")" \
  || fail "retry should append HEAD after the append failure clears"
[ ! -e "$(fast_commit_pending "$repo")" ] \
  || fail "retry should remove the pending marker after a successful append"
ok "post-commit keeps the pending marker when the provenance append fails"

# A merge skips pre-commit but still runs post-commit. If an earlier append
# failure left one or more exact HEADs in the marker, post-commit must replay
# all of them before adding the merge HEAD and consuming the marker.
repo=$(new_repo fast-post-commit-merge-replays-pending)
older_failed_head=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" switch -qc merge-side
printf 'side\n' > "$repo/side.txt"
git -C "$repo" add side.txt
git -C "$repo" commit -qm "test: create merge side fixture"
newer_failed_head=$(git -C "$repo" rev-parse HEAD)
{
  printf 'head=%s\n' "$older_failed_head"
  printf 'head=%s\n' "$newer_failed_head"
} > "$(fast_commit_pending "$repo")"
git -C "$repo" switch -q master
git -C "$repo" merge -q --no-ff merge-side -m "test: merge provenance fixture"
merge_head=$(git -C "$repo" rev-parse HEAD)
mkdir -p "$repo/scripts/git"
# post-commit dispatches the baseline truth-up through the shared dispatcher,
# which fans out to every per-metric truth-up script; stub all four so the
# merge-commit path exits cleanly.
cp "$REPO_ROOT/scripts/git/run-baseline-truth-up.sh" "$repo/scripts/git/"
for truth_up in \
  lint-ratchet-post-merge-baseline-truth-up.sh \
  knip-unused-exports-post-merge-baseline-truth-up.sh \
  near-duplicates-post-merge-baseline-truth-up.sh \
  max-lines-exceptions-post-merge-baseline-truth-up.sh; do
  printf '#!/bin/sh\nexit 0\n' > "$repo/scripts/git/$truth_up"
done
(
  cd "$repo"
  bash .husky/post-commit
) || fail "merge post-commit should replay pending fast provenance"
grep -qxF "$older_failed_head" "$(fast_commit_log "$repo")" \
  || fail "merge post-commit lost older failed HEAD $older_failed_head"
grep -qxF "$newer_failed_head" "$(fast_commit_log "$repo")" \
  || fail "merge post-commit lost newer failed HEAD $newer_failed_head"
grep -qxF "$merge_head" "$(fast_commit_log "$repo")" \
  || fail "merge post-commit should also record current merge HEAD $merge_head"
[ ! -e "$(fast_commit_pending "$repo")" ] \
  || fail "merge post-commit should consume marker only after replaying every HEAD"
ok "merge post-commit replays all pending HEADs before consuming marker"

# Two worktrees sharing one Git common dir commit concurrently under fast-commit.
# The pending marker is per-worktree, so one lane's post-commit (and, by the same
# keying, its pre-commit prepare-rm) touches only its own marker — it can never
# consume or delete the sibling lane's in-flight marker and strand that commit
# out of the provenance log.
repo=$(new_repo fast-pending-per-worktree)
sibling="$TMP_ROOT/fast-pending-sibling"
git -C "$repo" worktree add -q -b sibling "$sibling" HEAD
pending_primary=$(fast_commit_pending "$repo")
pending_sibling=$(fast_commit_pending "$sibling")
[ "$pending_primary" != "$pending_sibling" ] \
  || fail "pending marker should be keyed per worktree: $pending_primary"
: > "$pending_primary"
: > "$pending_sibling"
(
  cd "$sibling"
  bash .husky/post-commit
) || fail "sibling post-commit should finalize its own pending fast-commit provenance"
[ ! -e "$pending_sibling" ] \
  || fail "sibling post-commit should remove its own pending marker"
[ -e "$pending_primary" ] \
  || fail "sibling post-commit must not consume the primary worktree's pending marker"
(
  cd "$repo"
  bash .husky/post-commit
) || fail "primary post-commit should still finalize its own pending provenance"
[ ! -e "$pending_primary" ] \
  || fail "primary post-commit should remove its own pending marker"
grep -qxF "$(git -C "$repo" rev-parse HEAD)" "$(fast_commit_log "$repo")" \
  || fail "both lanes' commits should reach the shared provenance log"
ok "concurrent worktrees keep independent fast-commit pending markers"

# --- near-duplicates integration-boundary check (part 1) ---------------------
# pre-push must fail closed on a genuinely stale whole-tree near-duplicates
# baseline, pay no scan when nothing scanned changed, and NOT block when the
# sensor cannot run for environmental reasons. A bun stub returns a controlled
# exit/output for `run sensor:near-duplicates -- --check-baseline` and logs when
# it is invoked, so the scan-or-skip gate is observable.
near_dup_stub_dir="$TMP_ROOT/near-dup-boundary-bin"
mkdir -p "$near_dup_stub_dir"
cat > "$near_dup_stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "sensor:near-duplicates" ]; then
  [ -n "${MUSI_TEST_NEARDUP_LOG:-}" ] && printf 'invoked\n' >> "$MUSI_TEST_NEARDUP_LOG"
  printf '%s\n' "${MUSI_TEST_NEARDUP_OUTPUT:-}"
  exit "${MUSI_TEST_NEARDUP_STATUS:-0}"
fi
exit 0
STUB
chmod +x "$near_dup_stub_dir/bun"

new_boundary_repo() {
  local name="$1"
  local repo
  repo=$(new_repo "$name")
  printf '[]\n' > "$repo/sensor-near-duplicates.baseline.json"
  printf 'export const seed = 1\n' > "$repo/module.ts"
  git -C "$repo" add sensor-near-duplicates.baseline.json module.ts
  git -C "$repo" commit -qm "seed near-duplicates baseline and scanned source"
  printf '%s\n' "$repo"
}

run_pre_push_boundary() {
  local repo="$1" input="$2" status="$3" output="$4" log="$5"
  local state_root
  state_root=$(state_root_for "$repo")
  (
    cd "$repo"
    PATH="$near_dup_stub_dir:$PATH" \
      MUSI_VERIFY_STATE_ROOT="$state_root" \
      MUSI_TEST_NEARDUP_STATUS="$status" \
      MUSI_TEST_NEARDUP_OUTPUT="$output" \
      MUSI_TEST_NEARDUP_LOG="$log" \
      bash .husky/pre-push <<< "$input"
  )
}

# Existing fast-commit fixtures have no baseline file, so the boundary check
# must no-op for them; confirm a plain fast-commit repo still runs the sensor
# zero times (guarding against the boundary check firing where it should not).
repo=$(new_repo boundary-absent-baseline)
mark_fast_commit "$repo"
boundary_absent_log="$TMP_ROOT/boundary-absent.log"
: > "$boundary_absent_log"
(
  cd "$repo"
  PATH="$near_dup_stub_dir:$PATH" \
    MUSI_VERIFY_STATE_ROOT="$(state_root_for "$repo")" \
    MUSI_TEST_NEARDUP_LOG="$boundary_absent_log" \
    bash .husky/pre-push <<< "$(push_line_for_head "$repo")"
) >/dev/null || fail "pre-push should pass when there is no baseline to check"
[ ! -s "$boundary_absent_log" ] \
  || fail "the boundary scan must not run when no near-duplicates baseline exists"
ok "boundary check no-ops when the repo has no near-duplicates baseline"

# A two-lane integration assembles a branch whose committed baseline is stale.
repo=$(new_boundary_repo boundary-two-lane-stale)
remote_before=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" checkout -q -b lane-a
printf 'export const dupA = () => 1\n' > "$repo/dup-a.ts"
git -C "$repo" add dup-a.ts
git -C "$repo" commit -qm "lane a adds near-duplicate scanned source"
git -C "$repo" checkout -q master
git -C "$repo" checkout -q -b lane-b
printf 'export const dupB = () => 2\n' > "$repo/dup-b.ts"
git -C "$repo" add dup-b.ts
git -C "$repo" commit -qm "lane b adds near-duplicate scanned source"
git -C "$repo" checkout -q master
git -C "$repo" merge -q --no-ff lane-a -m "integrate lane a into the boundary fixture"
git -C "$repo" merge -q --no-ff lane-b -m "integrate lane b into the boundary fixture"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_stale_log="$TMP_ROOT/boundary-two-lane-stale.log"
: > "$boundary_stale_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  3 "presentation text is not the verdict contract" \
  "$boundary_stale_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "pre-push must block a stale near-duplicates baseline at the boundary: $output"
grep -qF "STALE at the integration boundary" <<< "$output" \
  || fail "stale boundary failure should name the boundary: $output"
grep -qF -- "--restore-merge-truth" <<< "$output" \
  || fail "stale boundary failure should offer the restore recipe: $output"
grep -qF -- "--admit" <<< "$output" \
  || fail "stale boundary failure should offer the reviewed-admission path: $output"
[ -s "$boundary_stale_log" ] \
  || fail "a source-touching push must run the whole-tree scan"
ok "pre-push blocks a stale near-duplicates baseline assembled across lanes"

# A dirty worktree can propose unreviewed baseline growth over HEAD before the
# whole-tree comparison runs. That deliberate verdict has its own code (6) and
# must remain blocking without consulting its human-facing text.
repo=$(new_boundary_repo boundary-unreviewed-growth)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const grown = 3\n' >> "$repo/module.ts"
git -C "$repo" add module.ts
git -C "$repo" commit -qm "touch scanned source before dirty baseline growth"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_growth_log="$TMP_ROOT/boundary-unreviewed-growth.log"
: > "$boundary_growth_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  6 "presentation text is not the verdict contract" \
  "$boundary_growth_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "pre-push must block unreviewed working-tree baseline growth: $output"
grep -qF "proposes unreviewed growth over HEAD" <<< "$output" \
  || fail "exit 6 should identify unreviewed working-tree baseline growth: $output"
[ -s "$boundary_growth_log" ] \
  || fail "the boundary scan must run before classifying unreviewed growth"
ok "pre-push blocks unreviewed working-tree baseline growth by exit code"

# A push that changes neither scanned source nor the baseline pays no scan.
repo=$(new_boundary_repo boundary-docs-only)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf '# notes\n' > "$repo/NOTES.md"
git -C "$repo" add NOTES.md
git -C "$repo" commit -qm "docs-only change with no scanned-source or baseline edit"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_docs_log="$TMP_ROOT/boundary-docs-only.log"
: > "$boundary_docs_log"
run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  1 "FAIL: this stub output must never be consulted" "$boundary_docs_log" >/dev/null 2>&1 \
  || fail "a docs-only push must pass pre-push"
[ ! -s "$boundary_docs_log" ] \
  || fail "a push with no scanned-source or baseline change must not run the whole-tree scan"
ok "pre-push skips the whole-tree scan when no scanned source or baseline changed"

# The sensor cannot run (environment failure): surface it, do not block.
repo=$(new_boundary_repo boundary-env-fail)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const more = 3\n' >> "$repo/module.ts"
git -C "$repo" add module.ts
git -C "$repo" commit -qm "touch scanned source so the boundary scan is attempted"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_env_log="$TMP_ROOT/boundary-env-fail.log"
: > "$boundary_env_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  2 "ERROR: collectNearDuplicates failed: similarity-ts engine unavailable" \
  "$boundary_env_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] \
  || fail "an environment failure must not block the push: $output"
[ -s "$boundary_env_log" ] \
  || fail "the scan should have been attempted before classifying the failure"
grep -qF "ERROR: collectNearDuplicates failed" <<< "$output" \
  || fail "an environment failure should surface the sensor's real output: $output"
grep -qF "environment failure" <<< "$output" \
  || fail "an environment failure should be labelled as such: $output"
if grep -qF "STALE at the integration boundary" <<< "$output"; then
  fail "an environment failure must not be misreported as a stale baseline: $output"
fi
ok "pre-push does not block when the near-duplicates sensor cannot run"

# A truthful whole-tree baseline passes.
repo=$(new_boundary_repo boundary-truthful)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const good = 4\n' >> "$repo/module.ts"
git -C "$repo" add module.ts
git -C "$repo" commit -qm "touch scanned source with a truthful committed baseline"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_ok_log="$TMP_ROOT/boundary-truthful.log"
: > "$boundary_ok_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  0 "OK: whole-repo near-duplicate baseline matches 4 identities" "$boundary_ok_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] \
  || fail "a truthful baseline must pass pre-push: $output"
[ -s "$boundary_ok_log" ] \
  || fail "a source-touching push should run the whole-tree scan"
grep -qF "verified truthful" <<< "$output" \
  || fail "a truthful baseline should be reported verified: $output"
ok "pre-push passes when the whole-tree near-duplicates baseline is truthful"

# A JavaScript-only push must trigger the scan: the sensor walks .js/.jsx/.mjs/
# .cjs (BUILT_IN_SOURCE_EXTENSIONS), so a .js-only change alters detector truth
# even though it touches no .ts file. The old \.tsx?$ trigger missed this.
repo=$(new_boundary_repo boundary-js-only)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const helper = () => 5\n' > "$repo/helper.js"
git -C "$repo" add helper.js
git -C "$repo" commit -qm "add JavaScript source the sensor scans but .tsx? missed"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_js_log="$TMP_ROOT/boundary-js-only.log"
: > "$boundary_js_log"
run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  0 "OK: whole-repo near-duplicate baseline matches 4 identities" "$boundary_js_log" >/dev/null 2>&1 \
  || fail "a JavaScript-only push must pass when the baseline is truthful"
[ -s "$boundary_js_log" ] \
  || fail "a JavaScript-only push must run the whole-tree scan (the sensor walks .js)"
ok "pre-push runs the whole-tree scan for a JavaScript-only push"

# A drift-ai.config.json-only push must trigger the scan: the config feeds the
# detector's thresholds and exclusions, so it changes truth with no source edit.
repo=$(new_boundary_repo boundary-config-only)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf '{ "roots": ["."] }\n' > "$repo/drift-ai.config.json"
git -C "$repo" add drift-ai.config.json
git -C "$repo" commit -qm "change drift-ai config thresholds without touching source"
local_after=$(git -C "$repo" rev-parse HEAD)
boundary_config_log="$TMP_ROOT/boundary-config-only.log"
: > "$boundary_config_log"
run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  0 "OK: whole-repo near-duplicate baseline matches 4 identities" "$boundary_config_log" >/dev/null 2>&1 \
  || fail "a config-only push must pass when the baseline is truthful"
[ -s "$boundary_config_log" ] \
  || fail "a drift-ai.config.json-only push must run the whole-tree scan"
ok "pre-push runs the whole-tree scan for a drift-ai.config.json-only push"

# Pushing a branch that is NOT the checked-out HEAD: the worktree scan can only
# speak for HEAD, so the boundary check must fail closed and never run the scan
# against the wrong tree.
repo=$(new_boundary_repo boundary-non-head)
remote_before=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" checkout -q -b other
printf 'export const dupC = () => 6\n' > "$repo/dup-c.ts"
git -C "$repo" add dup-c.ts
git -C "$repo" commit -qm "other branch adds scanned source while master stays HEAD"
other_sha=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" checkout -q master
boundary_non_head_log="$TMP_ROOT/boundary-non-head.log"
: > "$boundary_non_head_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/other $other_sha refs/heads/other $remote_before" \
  0 "OK: this stub output must never be consulted" "$boundary_non_head_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "pre-push must fail closed when the pushed tip is not HEAD: $output"
grep -qF "can only validate the checked-out worktree" <<< "$output" \
  || fail "a non-HEAD push should be told the worktree only validates HEAD: $output"
[ ! -s "$boundary_non_head_log" ] \
  || fail "the boundary scan must not run against the worktree for a non-HEAD push"
ok "pre-push fails closed and skips the scan when pushing a non-HEAD branch"

# The boundary trigger ERE is generated data the hook sources. A missing or
# empty fragment leaves the hook unable to decide whether the pushed range
# touches scanned source, so it must fail closed with the regeneration command
# rather than silently skipping the whole-tree scan.
repo=$(new_boundary_repo boundary-missing-trigger)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const dupD = () => 7\n' > "$repo/dup-d.ts"
git -C "$repo" add dup-d.ts
git -C "$repo" commit -qm "add scanned source that would need the boundary scan"
local_after=$(git -C "$repo" rev-parse HEAD)
rm "$repo/scripts/harness/pre-push-scope-trigger.generated.sh"
boundary_missing_trigger_log="$TMP_ROOT/boundary-missing-trigger.log"
: > "$boundary_missing_trigger_log"
set +e
output=$(run_pre_push_boundary "$repo" \
  "refs/heads/master $local_after refs/heads/master $remote_before" \
  0 "OK: this stub output must never be consulted" "$boundary_missing_trigger_log" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "pre-push must fail closed when the generated boundary trigger is missing: $output"
grep -qF "bun run harness:pre-push-trigger" <<< "$output" \
  || fail "a missing boundary trigger should name the regeneration command: $output"
[ ! -s "$boundary_missing_trigger_log" ] \
  || fail "the boundary scan must not run without a boundary trigger"
ok "pre-push fails closed when the generated boundary trigger is missing"

# An inherited export of the trigger variable must not stand in for the
# generated fragment: a stale value in the environment would satisfy the
# non-empty guard and hand the scan an obsolete ERE, which is exactly the
# silent skip the fail-closed contract exists to stop.
repo=$(new_boundary_repo boundary-inherited-trigger)
remote_before=$(git -C "$repo" rev-parse HEAD)
printf 'export const dupE = () => 8\n' > "$repo/dup-e.ts"
git -C "$repo" add dup-e.ts
git -C "$repo" commit -qm "add scanned source that would need the boundary scan"
local_after=$(git -C "$repo" rev-parse HEAD)
rm "$repo/scripts/harness/pre-push-scope-trigger.generated.sh"
boundary_inherited_trigger_log="$TMP_ROOT/boundary-inherited-trigger.log"
: > "$boundary_inherited_trigger_log"
set +e
output=$(
  cd "$repo"
  PATH="$near_dup_stub_dir:$PATH" \
    MUSI_VERIFY_STATE_ROOT="$(state_root_for "$repo")" \
    MUSI_TEST_NEARDUP_STATUS=0 \
    MUSI_TEST_NEARDUP_OUTPUT="OK: this stub output must never be consulted" \
    MUSI_TEST_NEARDUP_LOG="$boundary_inherited_trigger_log" \
    MUSI_PRE_PUSH_NEAR_DUPLICATES_TRIGGER='\.(ts)$' \
    bash .husky/pre-push \
    <<< "refs/heads/master $local_after refs/heads/master $remote_before" 2>&1
)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] \
  || fail "an inherited trigger must not substitute for the generated fragment: $output"
grep -qF "bun run harness:pre-push-trigger" <<< "$output" \
  || fail "an inherited trigger should still name the regeneration command: $output"
[ ! -s "$boundary_inherited_trigger_log" ] \
  || fail "the boundary scan must not run on an inherited trigger value"
ok "pre-push ignores an inherited boundary trigger and still fails closed"

# The same fail-closed rule must not fire where the boundary check does not
# apply: a repo with no committed baseline still returns before the trigger is
# needed, so a missing fragment cannot block an unrelated push.
repo=$(new_repo boundary-missing-trigger-no-baseline)
mark_fast_commit "$repo"
rm "$repo/scripts/harness/pre-push-scope-trigger.generated.sh"
(
  cd "$repo"
  PATH="$near_dup_stub_dir:$PATH" \
    MUSI_VERIFY_STATE_ROOT="$(state_root_for "$repo")" \
    bash .husky/pre-push <<< "$(push_line_for_head "$repo")"
) >/dev/null 2>&1 \
  || fail "a repo with no near-duplicates baseline must not need the boundary trigger"
ok "a missing boundary trigger does not block repos with no near-duplicates baseline"

printf 'pre-push tests passed (%d)\n' "$PASS"
