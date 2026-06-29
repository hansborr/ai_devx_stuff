#!/usr/bin/env bash
# test-verify-metadata.sh — pure-shell smoke tests for scripts/lib/verify-metadata.sh.
#
# Exercises the pure helper functions (marker read/write/match, fingerprinting,
# changed-gate) directly, using small git fixture repos for the fingerprint and
# gate cases. Run via `bash scripts/tests/test-verify-metadata.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/test-git-env.sh
. "$SCRIPT_DIR/lib/test-git-env.sh"
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested
VERIFY_METADATA="$SCRIPT_DIR/../lib/verify-metadata.sh"

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

SANDBOX="$(mktemp -d /tmp/musi-test-verify-metadata.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

# shellcheck source=../lib/verify-metadata.sh
source "$VERIFY_METADATA"

# --- syntax check ------------------------------------------------------------
bash -n "$VERIFY_METADATA" || fail "verify-metadata.sh fails bash -n"
ok "verify-metadata.sh passes bash -n"

# --- valid marker constants ---------------------------------------------------
VALID_HASH="$(printf 'test' | sha256sum | awk '{print $1}')"
ZERO_HASH="0000000000000000000000000000000000000000000000000000000000000000"

# =============================================================================
# musi_read_success_marker
# =============================================================================

# --- accepts valid marker with LAST_TS, LAST_HEAD, LAST_HASH -----------------
now=$(date +%s)
cat > "$SANDBOX/marker-ok" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
musi_read_success_marker "$SANDBOX/marker-ok" \
  || fail "musi_read_success_marker rejected valid marker"
[ "$MUSI_MARKER_LAST_TS" = "$now" ] || fail "LAST_TS mismatch: $MUSI_MARKER_LAST_TS"
[ "$MUSI_MARKER_LAST_HEAD" = "abc123" ] || fail "LAST_HEAD mismatch: $MUSI_MARKER_LAST_HEAD"
[ "$MUSI_MARKER_LAST_HASH" = "$VALID_HASH" ] || fail "LAST_HASH mismatch: $MUSI_MARKER_LAST_HASH"
ok "musi_read_success_marker accepts exactly LAST_TS, LAST_HEAD, LAST_HASH"

unset MUSI_MARKER_LAST_TS MUSI_MARKER_LAST_HEAD MUSI_MARKER_LAST_HASH

# --- rejects missing LAST_TS -------------------------------------------------
cat > "$SANDBOX/marker-no-ts" <<EOF
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-no-ts" 2>/dev/null; then
  fail "should reject marker missing LAST_TS"
fi
ok "musi_read_success_marker rejects missing LAST_TS"

# --- rejects missing LAST_HEAD ------------------------------------------------
cat > "$SANDBOX/marker-no-head" <<EOF
LAST_TS=$now
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-no-head" 2>/dev/null; then
  fail "should reject marker missing LAST_HEAD"
fi
ok "musi_read_success_marker rejects missing LAST_HEAD"

# --- rejects missing LAST_HASH ------------------------------------------------
cat > "$SANDBOX/marker-no-hash" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
EOF
if musi_read_success_marker "$SANDBOX/marker-no-hash" 2>/dev/null; then
  fail "should reject marker missing LAST_HASH"
fi
ok "musi_read_success_marker rejects missing LAST_HASH"

# --- rejects duplicate fields -------------------------------------------------
cat > "$SANDBOX/marker-dup-ts" <<EOF
LAST_TS=$now
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-dup-ts" 2>/dev/null; then
  fail "should reject marker with duplicate LAST_TS"
fi
ok "musi_read_success_marker rejects duplicate fields"

# --- rejects unknown keys -----------------------------------------------------
cat > "$SANDBOX/marker-unknown" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EXTRA=foo
EOF
if musi_read_success_marker "$SANDBOX/marker-unknown" 2>/dev/null; then
  fail "should reject marker with unknown key"
fi
ok "musi_read_success_marker rejects unknown keys"

# --- rejects malformed timestamp (non-numeric) --------------------------------
cat > "$SANDBOX/marker-bad-ts" <<EOF
LAST_TS=abc
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-bad-ts" 2>/dev/null; then
  fail "should reject non-numeric timestamp"
fi
ok "musi_read_success_marker rejects malformed timestamps"

# --- rejects zero timestamp ---------------------------------------------------
cat > "$SANDBOX/marker-zero-ts" <<EOF
LAST_TS=0
LAST_HEAD=abc123
LAST_HASH=$VALID_HASH
EOF
if musi_read_success_marker "$SANDBOX/marker-zero-ts" 2>/dev/null; then
  fail "should reject zero timestamp"
fi
ok "musi_read_success_marker rejects zero timestamp"

# --- rejects malformed hash (wrong length) ------------------------------------
cat > "$SANDBOX/marker-short-hash" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=abcdef0123456789
EOF
if musi_read_success_marker "$SANDBOX/marker-short-hash" 2>/dev/null; then
  fail "should reject hash with wrong length"
fi
ok "musi_read_success_marker rejects malformed hashes (wrong length)"

# --- rejects malformed hash (non-hex characters) ------------------------------
bad_hash="$(printf 'x%.0s' {1..64})"
cat > "$SANDBOX/marker-nonhex" <<EOF
LAST_TS=$now
LAST_HEAD=abc123
LAST_HASH=$bad_hash
EOF
if musi_read_success_marker "$SANDBOX/marker-nonhex" 2>/dev/null; then
  fail "should reject hash with non-hex characters"
fi
ok "musi_read_success_marker rejects malformed hashes (non-hex)"

# --- rejects nonexistent marker file ------------------------------------------
if musi_read_success_marker "$SANDBOX/marker-does-not-exist" 2>/dev/null; then
  fail "should reject nonexistent marker file"
fi
ok "musi_read_success_marker rejects nonexistent file"

# =============================================================================
# musi_success_marker_matches
# =============================================================================

now=$(date +%s)
cat > "$SANDBOX/marker-match" <<EOF
LAST_TS=$now
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF

# --- enforces head ------------------------------------------------------------
if musi_success_marker_matches "$SANDBOX/marker-match" "wrong-head" "$VALID_HASH" 120; then
  fail "should reject mismatched head"
fi
ok "musi_success_marker_matches enforces head"

# --- enforces hash ------------------------------------------------------------
if musi_success_marker_matches "$SANDBOX/marker-match" "correct-head" "$ZERO_HASH" 120; then
  fail "should reject mismatched hash"
fi
ok "musi_success_marker_matches enforces hash"

# --- enforces freshness (stale marker) ----------------------------------------
stale_ts=$((now - 200))
cat > "$SANDBOX/marker-stale" <<EOF
LAST_TS=$stale_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
if musi_success_marker_matches "$SANDBOX/marker-stale" "correct-head" "$VALID_HASH" 120; then
  fail "should reject stale marker beyond freshness window"
fi
ok "musi_success_marker_matches enforces freshness"

# --- accepts fresh matching marker --------------------------------------------
musi_success_marker_matches "$SANDBOX/marker-match" "correct-head" "$VALID_HASH" 120 \
  || fail "should accept fresh marker with matching head and hash"
ok "musi_success_marker_matches accepts fresh matching marker"

# --- rejects future timestamp (negative age) ----------------------------------
future_ts=$((now + 100))
cat > "$SANDBOX/marker-future" <<EOF
LAST_TS=$future_ts
LAST_HEAD=correct-head
LAST_HASH=$VALID_HASH
EOF
if musi_success_marker_matches "$SANDBOX/marker-future" "correct-head" "$VALID_HASH" 120; then
  fail "should reject marker with future timestamp"
fi
ok "musi_success_marker_matches rejects future timestamp (negative age)"

# =============================================================================
# musi_write_success_marker
# =============================================================================

MARKER_WRITE="$SANDBOX/write-subdir/marker"
musi_write_success_marker "$MARKER_WRITE" "my-head" "$VALID_HASH" \
  || fail "musi_write_success_marker failed"
[ -f "$MARKER_WRITE" ] || fail "marker file not created"
grep -q '^LAST_TS=[0-9]\+$' "$MARKER_WRITE" || fail "marker missing valid LAST_TS line"
grep -q '^LAST_HEAD=my-head$' "$MARKER_WRITE" || fail "marker missing LAST_HEAD line"
grep -q "^LAST_HASH=${VALID_HASH}$" "$MARKER_WRITE" || fail "marker missing LAST_HASH line"
line_count=$(wc -l < "$MARKER_WRITE" | tr -d ' ')
[ "$line_count" -eq 3 ] || fail "marker should have exactly 3 lines, got $line_count"
musi_read_success_marker "$MARKER_WRITE" \
  || fail "written marker should pass musi_read_success_marker validation"
ok "musi_write_success_marker writes atomically shaped marker content"

# =============================================================================
# Fingerprinting — git fixture repos
# =============================================================================

new_repo() {
  local name="$1"
  local repo="$SANDBOX/$name"
  mkdir -p "$repo"
  git -C "$SANDBOX" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name Test
  printf 'initial\n' > "$repo/file.txt"
  git -C "$repo" add file.txt
  git -C "$repo" commit -qm init
  printf '%s\n' "$repo"
}

# --- standard state paths are scoped per worktree -----------------------------
repo="$(new_repo state-path-primary)"
sibling="$SANDBOX/state-path-sibling"
git -C "$repo" worktree add -q -b state-path-sibling "$sibling" HEAD
for helper in \
  musi_standard_precommit_marker \
  musi_standard_verify_changed_marker \
  musi_standard_verify_full_marker \
  musi_standard_verify_log_dir \
  musi_standard_verify_history_dir \
  musi_standard_verify_lock \
  musi_standard_bun_log_dir \
  musi_standard_bun_lock \
  musi_standard_git_commit_lock
do
  primary_path=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" "$helper" "$repo")
  sibling_path=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" "$helper" "$sibling")
  [ -n "$primary_path" ] || fail "$helper returned an empty path for primary worktree"
  [ -n "$sibling_path" ] || fail "$helper returned an empty path for sibling worktree"
  [ "$primary_path" != "$sibling_path" ] \
    || fail "$helper should differ for same-HEAD sibling worktrees: $primary_path"
done
ok "standard verification state paths are worktree-scoped"

# --- commit queue state path is scoped per Git common dir ---------------------
primary_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$repo")
sibling_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$sibling")
[ -n "$primary_queue" ] || fail "musi_standard_commit_queue_lock returned an empty path for primary worktree"
[ "$primary_queue" = "$sibling_queue" ] \
  || fail "commit queue lock should match for sibling worktrees: $primary_queue != $sibling_queue"
case "$primary_queue" in
  "$SANDBOX/default-state"/musi-commit-queue.lock.*) ;;
  *) fail "commit queue lock should honor MUSI_VERIFY_STATE_ROOT: $primary_queue" ;;
esac

unrelated_repo="$(new_repo state-path-unrelated)"
unrelated_queue=$(MUSI_VERIFY_STATE_ROOT="$SANDBOX/default-state" musi_standard_commit_queue_lock "$unrelated_repo")
[ "$primary_queue" != "$unrelated_queue" ] \
  || fail "commit queue lock should differ for unrelated repositories: $primary_queue"

override_queue=$(MUSI_STANDARD_COMMIT_QUEUE_LOCK="$SANDBOX/override/commit-queue.lock" musi_standard_commit_queue_lock "$repo")
[ "$override_queue" = "$SANDBOX/override/commit-queue.lock" ] \
  || fail "commit queue lock should honor MUSI_STANDARD_COMMIT_QUEUE_LOCK: $override_queue"
ok "commit queue state path is Git-common-dir scoped"

# --- ai_staged_fingerprint changes when staged content changes ----------------
repo="$(new_repo staged-fp-change)"
fp1=$(ai_staged_fingerprint "$repo")
printf 'modified\n' > "$repo/file.txt"
git -C "$repo" add file.txt
fp2=$(ai_staged_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "staged fingerprint should change after staging new content"
ok "ai_staged_fingerprint changes when staged content changes"

# --- ai_staged_fingerprint stable for unstaged unrelated edits ----------------
repo="$(new_repo staged-fp-unstaged)"
fp1=$(ai_staged_fingerprint "$repo")
printf 'unstaged edit\n' > "$repo/file.txt"
fp2=$(ai_staged_fingerprint "$repo")
[ "$fp1" = "$fp2" ] || fail "staged fingerprint should not change for unstaged edits"
ok "ai_staged_fingerprint does not change for unstaged unrelated edits"

# --- ai_worktree_fingerprint changes for tracked edits ------------------------
repo="$(new_repo worktree-fp-tracked)"
fp1=$(ai_worktree_fingerprint "$repo")
printf 'edited\n' > "$repo/file.txt"
fp2=$(ai_worktree_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "worktree fingerprint should change for tracked edits"
ok "ai_worktree_fingerprint changes for tracked edits"

# --- ai_worktree_fingerprint changes for untracked file contents --------------
repo="$(new_repo worktree-fp-untracked)"
fp1=$(ai_worktree_fingerprint "$repo")
printf 'new file\n' > "$repo/untracked.txt"
fp2=$(ai_worktree_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "worktree fingerprint should change for untracked files"
ok "ai_worktree_fingerprint changes for untracked file contents"

# --- ai_precommit_fingerprint includes staged diff ----------------------------
repo="$(new_repo precommit-staged)"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'staged change\n' > "$repo/file.txt"
git -C "$repo" add file.txt
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] || fail "precommit fingerprint should change for staged diffs"
ok "ai_precommit_fingerprint includes staged diff"

# --- ai_precommit_fingerprint includes relevant unstaged/untracked paths ------
repo="$(new_repo precommit-relevant)"
fp1=$(ai_precommit_fingerprint "$repo")
mkdir -p "$repo/scripts"
printf 'new script\n' > "$repo/scripts/helper.sh"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should change for relevant untracked paths (scripts/*)"
ok "ai_precommit_fingerprint includes relevant unstaged/untracked paths"

# --- ai_precommit_fingerprint includes tracked .codex/.claude extras ----------
repo="$(new_repo precommit-tracked-agent-extra)"
mkdir -p "$repo/.codex"
printf 'committed\n' > "$repo/.codex/local-note.md"
git -C "$repo" add .codex/local-note.md
git -C "$repo" commit -qm "add tracked codex note"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'tracked edit\n' > "$repo/.codex/local-note.md"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" != "$fp2" ] \
  || fail "precommit fingerprint should include tracked .codex/.claude extra paths"
ok "ai_precommit_fingerprint includes tracked .codex/.claude extra paths"

# --- ai_precommit_fingerprint ignores irrelevant untracked paths --------------
repo="$(new_repo precommit-irrelevant)"
fp1=$(ai_precommit_fingerprint "$repo")
printf 'random notes\n' > "$repo/notes.txt"
fp2=$(ai_precommit_fingerprint "$repo")
[ "$fp1" = "$fp2" ] \
  || fail "precommit fingerprint should ignore irrelevant untracked paths (notes.txt)"
ok "ai_precommit_fingerprint ignores irrelevant untracked paths"

# --- ai_precommit_fingerprint diverges only when fast-commit marker present ---
# The fast-commit toggle skips slow pre-commit test slots. Folding its presence
# into the fingerprint stops a partial (fast) run's success marker from
# short-circuiting a later full pre-commit at the same HEAD/diff. The marker
# lives in the Git common dir so it is byte-identical to today when absent.
repo="$(new_repo precommit-fast-commit-toggle)"
fast_marker="$(musi_git_common_identity_path "$repo")/musi-fast-commit"
fp_off=$(ai_precommit_fingerprint "$repo")
: > "$fast_marker"
fp_on=$(ai_precommit_fingerprint "$repo")
[ "$fp_off" != "$fp_on" ] \
  || fail "precommit fingerprint should change when the fast-commit marker is present"
rm -f "$fast_marker"
fp_off_again=$(ai_precommit_fingerprint "$repo")
[ "$fp_off" = "$fp_off_again" ] \
  || fail "precommit fingerprint should match the legacy value once the marker is removed"
ok "ai_precommit_fingerprint diverges only when fast-commit marker is present"

# =============================================================================
# musi_changed_gate_fail_if_unstaged
# =============================================================================

# --- reports source-relevant unstaged files -----------------------------------
repo="$(new_repo gate-relevant-unstaged)"
mkdir -p "$repo/scripts"
printf 'committed\n' > "$repo/scripts/test.sh"
git -C "$repo" add scripts/test.sh
git -C "$repo" commit -qm "add script"
printf 'staged\n' > "$repo/scripts/test.sh"
git -C "$repo" add scripts/test.sh
printf 'unstaged\n' > "$repo/scripts/test.sh"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "gate should reject unstaged source-relevant files"
grep -qF 'gate-test:   - scripts/test.sh' <<< "$output" \
  || fail "gate should report unstaged file: $output"
ok "musi_changed_gate_fail_if_unstaged reports source-relevant unstaged files"

# --- reports source-relevant untracked files ----------------------------------
repo="$(new_repo gate-relevant-untracked)"
mkdir -p "$repo/packages/server"
printf 'new file\n' > "$repo/packages/server/newfile.ts"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -ne 0 ] || fail "gate should reject untracked source-relevant files"
grep -qF 'gate-test:   - packages/server/newfile.ts' <<< "$output" \
  || fail "gate should report untracked source-relevant file: $output"
ok "musi_changed_gate_fail_if_unstaged reports source-relevant untracked files"

# --- ignores irrelevant paths -------------------------------------------------
repo="$(new_repo gate-irrelevant)"
printf 'committed\n' > "$repo/notes.txt"
git -C "$repo" add notes.txt
git -C "$repo" commit -qm "add notes"
printf 'unstaged\n' > "$repo/notes.txt"
set +e
output=$(musi_changed_gate_fail_if_unstaged "$repo" "gate-test" 2>&1)
exit_code=$?
set -e
[ "$exit_code" -eq 0 ] || fail "gate should accept irrelevant unstaged files: $output"
ok "musi_changed_gate_fail_if_unstaged ignores irrelevant paths"

# --- staged script deletion classifier uses shared deletion policy ------------
repo="$(new_repo script-deletion-classifier)"
mkdir -p "$repo/scripts"
printf '#!/usr/bin/env bash\n' > "$repo/scripts/delete-me.sh"
git -C "$repo" add scripts/delete-me.sh
git -C "$repo" commit -qm "add script"
git -C "$repo" rm -q scripts/delete-me.sh
set +e
(
  cd "$repo" || exit 2
  musi_classify_staged_script_input
)
classifier_rc=$?
set -e
[ "$classifier_rc" -eq 1 ] \
  || fail "staged script deletion should request full script-smoke fallback, got $classifier_rc"
ok "musi_classify_staged_script_input detects script-smoke-sensitive deletions"

printf 'verify-metadata tests passed (%d)\n' "$PASS"
